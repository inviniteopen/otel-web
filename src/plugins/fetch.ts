import {
  context,
  propagation,
  SpanStatusCode,
  trace,
  type Tracer,
} from "@opentelemetry/api";

import type { OtelWebPlugin, PluginContext } from "../types";

interface XhrMeta {
  method: string;
  url: string;
}

export interface FetchPluginConfig {
  /** URL patterns to exclude from tracing. Matches against the full URL. */
  ignoreUrls?: RegExp[];
  /** URL patterns to propagate trace context headers to (for distributed tracing across CORS boundaries). */
  propagateToUrls?: RegExp[];
}

const matchesAny = (url: string, patterns: RegExp[]): boolean =>
  patterns.some((p) => p.test(url));

export const createFetchPlugin = (
  config: FetchPluginConfig = {},
): OtelWebPlugin => {
  let { ignoreUrls = [] } = config;
  const { propagateToUrls = [] } = config;

  const xhrMeta = new WeakMap<XMLHttpRequest, XhrMeta>();

  let originalFetch: typeof globalThis.fetch | undefined;
  let originalXhrOpen: typeof XMLHttpRequest.prototype.open | undefined;
  let originalXhrSend: typeof XMLHttpRequest.prototype.send | undefined;

  const resolveUrl = (input: RequestInfo | URL): string => {
    if (typeof input === "string") return new URL(input, location.origin).href;
    if (input instanceof URL) return input.href;
    return new URL(input.url, location.origin).href;
  };

  const resolveMethod = (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): string => {
    if (init?.method) return init.method.toUpperCase();
    if (input instanceof Request) return input.method.toUpperCase();
    return "GET";
  };

  const patchFetch = (tracer: Tracer): void => {
    originalFetch = globalThis.fetch;

    globalThis.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = resolveUrl(input);
      if (matchesAny(url, ignoreUrls)) {
        return originalFetch!(input, init);
      }

      const method = resolveMethod(input, init);
      const span = tracer.startSpan(`HTTP ${method}`, {
        attributes: {
          "http.method": method,
          "http.url": url,
        },
      });

      const spanContext = trace.setSpan(context.active(), span);

      let fetchInit = init;
      if (matchesAny(url, propagateToUrls)) {
        const headers = new Headers(init?.headers);
        const carrier: Record<string, string> = {};
        propagation.inject(spanContext, carrier);
        for (const [key, value] of Object.entries(carrier)) {
          headers.set(key, value);
        }
        fetchInit = { ...init, headers };
      }

      try {
        const response = await originalFetch!(input, fetchInit);

        span.setAttributes({
          "http.status_code": response.status,
          "http.response.content_length":
            Number(response.headers.get("content-length")) || 0,
        });

        if (response.ok) {
          span.setStatus({ code: SpanStatusCode.OK });
        } else {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `HTTP ${response.status}`,
          });
        }

        span.end();
        return response;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Fetch failed",
        });
        if (error instanceof Error) {
          span.recordException(error);
        }
        span.end();
        throw error;
      }
    };
  };

  const patchXhr = (tracer: Tracer): void => {
    originalXhrOpen = XMLHttpRequest.prototype.open;
    originalXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- XHR.open has complex overloads, patching requires any
      ...args: any[]
    ) {
      const [method, url] = args as [string, string | URL];
      xhrMeta.set(this, {
        method: method.toUpperCase(),
        url: new URL(String(url), location.origin).href,
      });
      return originalXhrOpen!.apply(
        this,
        args as Parameters<NonNullable<typeof originalXhrOpen>>,
      );
    } as typeof XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.send = function (
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      const meta = xhrMeta.get(this);

      if (!meta || matchesAny(meta.url, ignoreUrls)) {
        return originalXhrSend!.call(this, body);
      }

      const { method, url } = meta;
      const span = tracer.startSpan(`HTTP ${method}`, {
        attributes: {
          "http.method": method,
          "http.url": url,
        },
      });

      if (matchesAny(url, propagateToUrls)) {
        const spanContext = trace.setSpan(context.active(), span);
        const carrier: Record<string, string> = {};
        propagation.inject(spanContext, carrier);
        for (const [key, value] of Object.entries(carrier)) {
          this.setRequestHeader(key, value);
        }
      }

      let ended = false;

      this.addEventListener("loadend", () => {
        if (ended) return;
        ended = true;
        span.setAttribute("http.status_code", this.status);

        if (this.status >= 200 && this.status < 400) {
          span.setStatus({ code: SpanStatusCode.OK });
        } else {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `HTTP ${this.status}`,
          });
        }
        span.end();
      });

      this.addEventListener("error", () => {
        if (ended) return;
        ended = true;
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "XHR request failed",
        });
        span.end();
      });

      this.addEventListener("timeout", () => {
        if (ended) return;
        ended = true;
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "XHR request timed out",
        });
        span.end();
      });

      this.addEventListener("abort", () => {
        if (ended) return;
        ended = true;
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "XHR request aborted",
        });
        span.end();
      });

      return originalXhrSend!.call(this, body);
    };
  };

  return {
    setup(tracer: Tracer, ctx?: PluginContext) {
      if (ctx?.collectorUrl) {
        const escaped = ctx.collectorUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        ignoreUrls = [
          ...ignoreUrls,
          new RegExp(`^${escaped}/v1/(traces|logs|metrics)`),
        ];
      }
      patchFetch(tracer);
      patchXhr(tracer);
    },

    teardown() {
      if (originalFetch) {
        globalThis.fetch = originalFetch;
        originalFetch = undefined;
      }
      if (originalXhrOpen) {
        XMLHttpRequest.prototype.open = originalXhrOpen;
        originalXhrOpen = undefined;
      }
      if (originalXhrSend) {
        XMLHttpRequest.prototype.send = originalXhrSend;
        originalXhrSend = undefined;
      }
    },
  };
};
