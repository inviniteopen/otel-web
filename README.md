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
  url: "https://otel-collector.example.com/v1/traces",
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
  /** Full OTLP HTTP URL including signal path (e.g. "https://collector.example.com/v1/traces") */
  url: string;
  /** Service name reported in spans */
  serviceName: string;
  /** Optional headers sent with every export request */
  headers?: Record<string, string>;
  /** Plugins to activate */
  plugins?: OtelWebPlugin[];
  /** Called on every span start — return attributes to attach */
  getSpanAttributes?: () => SpanAttributes;
}
```

### Dynamic Span Attributes

`getSpanAttributes` is called at span creation time, so it can return values that change over the session (e.g., user identity after login):

```ts
initialize({
  url: "https://otel-collector.example.com/v1/traces",
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
