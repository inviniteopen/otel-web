# @invinite/otel-web

Lightweight OpenTelemetry initialization for browser SPAs. Sets up tracing with a single `initialize()` call and provides a plugin system for framework-specific instrumentation.

## Why

Setting up OpenTelemetry in the browser requires wiring together a provider, exporter, resource, and span processors. This library reduces that to a single function call while keeping full control through a plugin system.

## Install

```bash
npm install @invinite/otel-web @opentelemetry/api
```

`@opentelemetry/api` is a peer dependency — you should have exactly one copy in your app.

## Quick Start

```ts
import { initialize } from "@invinite/otel-web";
import { createDocumentLoadPlugin } from "@invinite/otel-web/plugins/document-load";
import { createFetchPlugin } from "@invinite/otel-web/plugins/fetch";

const cleanup = initialize({
  collectorUrl: "https://otel-collector.example.com",
  serviceName: "my-app",
  plugins: [
    createDocumentLoadPlugin(),
    createFetchPlugin({ ignoreUrls: [/\/v1\/traces/] }),
  ],
});

// Call cleanup() on app teardown
```

## Configuration

```ts
interface OtelWebConfig {
  /** Base OTLP HTTP URL (e.g. "https://collector.example.com"). Signal paths are appended automatically. */
  collectorUrl: string;
  /** Service name reported in spans */
  serviceName: string;
  /** Optional headers sent with every export request */
  headers?: Record<string, string>;
  /** Plugins to activate */
  plugins?: OtelWebPlugin[];
  /** Called on every span start — return attributes to attach */
  getSpanAttributes?: () => SpanAttributes;
  /** Enable experimental logging support (requires @opentelemetry/api-logs) */
  enableLogging?: boolean;
}
```

The `collectorUrl` follows the [OTLP exporter specification](https://opentelemetry.io/docs/specs/otel/protocol/exporter/) — signal paths (`/v1/traces`, `/v1/logs`) are appended automatically. A custom path prefix is preserved: `https://collector.example.com/mycollector` becomes `https://collector.example.com/mycollector/v1/traces`.

### Dynamic Span Attributes

`getSpanAttributes` is called at span creation time, so it can return values that change over the session (e.g., user identity after login):

```ts
initialize({
  collectorUrl: "https://otel-collector.example.com",
  serviceName: "my-app",
  getSpanAttributes: () => ({
    "session.id": sessionId,
    "user.id": auth.currentUser?.id ?? "",
  }),
});
```

## Plugins

### Fetch & XHR

Auto-instruments `fetch()` and `XMLHttpRequest`. Creates a span for every request with method, URL, and status code.

```ts
import { createFetchPlugin } from "@invinite/otel-web/plugins/fetch";

createFetchPlugin({
  // Skip tracing for specific URLs
  ignoreUrls: [/\/v1\/traces/, /\/health/],
  // Propagate W3C trace context headers for distributed tracing
  propagateToUrls: [/api\.example\.com/],
});
```

### Document Load

Emits spans for page load performance metrics from the Performance API.

```ts
import { createDocumentLoadPlugin } from "@invinite/otel-web/plugins/document-load";

createDocumentLoadPlugin();
```

Spans emitted:

| Span | Attributes |
| --- | --- |
| `document.load` | DNS, connect, TLS, TTFB, response, DOM interactive, DOM content loaded, load event, transfer sizes |
| `first-paint` | Time to first paint |
| `first-contentful-paint` | Time to first contentful paint |
| `largest-contentful-paint` | LCP time, element, size |

### TanStack Router

Creates spans for route navigations.

```ts
import { createRouterPlugin } from "@invinite/otel-web/plugins/tanstack-router";

createRouterPlugin(router);
```

### TanStack Query

Creates spans for query fetches and mutations with lifecycle tracking.

```ts
import { createQueryPlugin } from "@invinite/otel-web/plugins/tanstack-query";

createQueryPlugin(queryClient);
```

> **Note:** If your app fetches all data through TanStack Query, prefer the query plugin over the fetch plugin — it produces more meaningful span names (`query ["users"]` vs `HTTP GET`) and avoids duplicate spans.

### Error Handler

Captures uncaught errors and unhandled promise rejections as error spans.

```ts
import { createErrorHandlerPlugin } from "@invinite/otel-web/plugins/error-handler";

createErrorHandlerPlugin();
```

Uses `addEventListener` (not direct assignment) so it won't interfere with existing error handlers.

> **Note:** React and frameworks like TanStack Router catch rendering errors internally via error boundaries, so they never reach `window.onerror`. To report these errors, hook into your framework's error boundary. For example with TanStack Router:
>
> ```tsx
> import { SpanStatusCode, trace } from "@opentelemetry/api";
> import { ErrorComponent, createRootRoute } from "@tanstack/react-router";
> import { useEffect } from "react";
>
> const RootErrorComponent = ({ error }: { error: Error }) => {
>   useEffect(() => {
>     const tracer = trace.getTracer("my-app");
>     const span = tracer.startSpan("error-boundary");
>     span.setAttribute("error.type", error.name);
>     span.setAttribute("error.message", error.message);
>     span.setAttribute("error.stack", error.stack ?? "");
>     span.recordException(error);
>     span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
>     span.end();
>   }, [error]);
>
>   return <ErrorComponent error={error} />;
> };
>
> export const Route = createRootRoute({
>   errorComponent: RootErrorComponent,
> });
> ```

## Logging (Experimental)

> **Note:** OpenTelemetry browser logging is experimental. The API may change in future releases.

To enable logging, set `enableLogging: true` and install the `@opentelemetry/api-logs` peer dependency:

```bash
npm install @opentelemetry/api-logs
```

```ts
const cleanup = initialize({
  collectorUrl: "https://otel-collector.example.com",
  serviceName: "my-app",
  enableLogging: true,
});
```

Logs are exported to `<collectorUrl>/v1/logs`. Once initialized, get a logger anywhere in your app:

```ts
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

const logger = logs.getLogger("my-app");

logger.emit({
  severityNumber: SeverityNumber.INFO,
  severityText: "INFO",
  body: "User completed checkout",
  attributes: { "cart.items": 3 },
});
```

## Custom Spans

After `initialize()` is called, the global `@opentelemetry/api` tracer is available anywhere in your app for manual instrumentation:

```ts
import { trace, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("my-app");

// Track a user action
const span = tracer.startSpan("checkout.submit", {
  attributes: { "cart.items": 3, "cart.total": 99.99 },
});
span.setStatus({ code: SpanStatusCode.OK });
span.end();

// Record an error
const errorSpan = tracer.startSpan("payment.process");
try {
  await processPayment();
  errorSpan.setStatus({ code: SpanStatusCode.OK });
} catch (error) {
  errorSpan.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  errorSpan.recordException(error);
  throw error;
} finally {
  errorSpan.end();
}
```

These spans are exported to the same endpoint and carry any attributes from `getSpanAttributes`.

## Custom Plugins

```ts
import type { OtelWebPlugin } from "@invinite/otel-web";

const myPlugin: OtelWebPlugin = {
  setup(tracer) {
    // Subscribe to events, start spans
  },
  teardown() {
    // Unsubscribe, clean up
  },
};
```

## License

MIT
