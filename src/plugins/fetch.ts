import {
  context,
  propagation,
  SpanStatusCode,
  type Tracer,
} from "@opentelemetry/api";

import type { OtelWebPlugin } from "../types";

declare global {
  interface XMLHttpRequest {
    __otel_method?: string;
    __otel_url?: string;
  }
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
  const { ignoreUrls = [], propagateToUrls = [] } = config;

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

  const injectTraceHeaders = (headers: Headers): void => {
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    for (const [key, value] of Object.entries(carrier)) {
      headers.set(key, value);
    }
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

      const headers = new Headers(init?.headers);
      if (matchesAny(url, propagateToUrls)) {
        injectTraceHeaders(headers);
      }

      try {
        const response = await originalFetch!(input, {
          ...init,
          headers,
        });

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
      this.__otel_method = method.toUpperCase();
      this.__otel_url = new URL(String(url), location.origin).href;
      return originalXhrOpen!.apply(
        this,
        args as Parameters<NonNullable<typeof originalXhrOpen>>,
      );
    } as typeof XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.send = function (
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      const url = this.__otel_url as string | undefined;
      const method = this.__otel_method as string | undefined;

      if (!url || !method || matchesAny(url, ignoreUrls)) {
        return originalXhrSend!.call(this, body);
      }

      const span = tracer.startSpan(`HTTP ${method}`, {
        attributes: {
          "http.method": method,
          "http.url": url,
        },
      });

      if (matchesAny(url, propagateToUrls)) {
        const carrier: Record<string, string> = {};
        propagation.inject(context.active(), carrier);
        for (const [key, value] of Object.entries(carrier)) {
          this.setRequestHeader(key, value);
        }
      }

      this.addEventListener("loadend", () => {
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
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "XHR request failed",
        });
        span.end();
      });

      return originalXhrSend!.call(this, body);
    };
  };

  return {
    setup(tracer: Tracer) {
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
