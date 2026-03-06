import type { Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { beforeEach, describe, expect, it } from "vitest";

import { createFetchPlugin } from "../src/plugins/fetch";
import { initialize } from "../src/provider";
import type { OtelWebPlugin } from "../src/types";
import {
  clearLogs,
  clearSpans,
  collectorUrl,
  getResourceAttr,
  waitForLogs,
  waitForSpans,
} from "./test-utils";

describe("initialize", () => {
  beforeEach(async () => {
    await clearSpans();
    await clearLogs();
  });

  it("returns a teardown function", () => {
    const teardown = initialize({
      collectorUrl: collectorUrl(),
      serviceName: "test-provider",
    });
    expect(typeof teardown).toBe("function");
    teardown();
  });

  it("sets up plugins and calls teardown on them", () => {
    let setupCalled = false;
    let teardownCalled = false;

    const mockPlugin: OtelWebPlugin = {
      setup: (_tracer: Tracer) => {
        setupCalled = true;
      },
      teardown: () => {
        teardownCalled = true;
      },
    };

    const teardown = initialize({
      collectorUrl: collectorUrl(),
      serviceName: "test-plugins",
      plugins: [mockPlugin],
    });

    expect(setupCalled).toBe(true);
    expect(teardownCalled).toBe(false);

    teardown();

    expect(teardownCalled).toBe(true);
  });

  it("includes serviceVersion and environment as resource attributes", async () => {
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "test-resource-attrs",
      [ATTR_SERVICE_VERSION]: "1.2.3",
      "deployment.environment.name": "staging",
    });

    const exporter = new OTLPTraceExporter({
      url: `${collectorUrl()}/v1/traces`,
      headers: {},
    });

    const processor = new SimpleSpanProcessor(exporter);
    const provider = new WebTracerProvider({
      resource,
      spanProcessors: [processor],
    });

    const tracer = provider.getTracer("test-resource-attrs");
    const span = tracer.startSpan("resource-attr-span");
    span.end();

    await processor.forceFlush();

    const spans = await waitForSpans((s) =>
      s.some((sp) => sp.name === "resource-attr-span"),
    );
    const collected = spans.find((s) => s.name === "resource-attr-span");
    expect(collected).toBeDefined();
    expect(getResourceAttr(collected!, "service.version")).toBe("1.2.3");
    expect(getResourceAttr(collected!, "deployment.environment.name")).toBe(
      "staging",
    );

    await provider.shutdown();
  });

  it("applies sampleRate to control trace sampling", async () => {
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "test-sampling",
    });

    const exporter = new OTLPTraceExporter({
      url: `${collectorUrl()}/v1/traces`,
      headers: {},
    });

    const processor = new SimpleSpanProcessor(exporter);
    const provider = new WebTracerProvider({
      resource,
      spanProcessors: [processor],
      sampler: new TraceIdRatioBasedSampler(0),
    });

    const tracer = provider.getTracer("test-sampling");
    for (let i = 0; i < 10; i++) {
      const span = tracer.startSpan(`sampled-span-${i}`);
      span.end();
    }

    await processor.forceFlush();

    // Give some time for spans to potentially arrive
    await new Promise((r) => setTimeout(r, 500));

    const spans = await waitForSpans(() => true, { timeout: 1000 });
    const sampledSpans = spans.filter((s) =>
      s.name.startsWith("sampled-span-"),
    );
    expect(sampledSpans.length).toBe(0);

    await provider.shutdown();
  });

  it("propagates traceparent header via fetch plugin", async () => {
    const teardown = initialize({
      collectorUrl: collectorUrl(),
      serviceName: "test-propagation",
      plugins: [
        createFetchPlugin({ propagateToUrls: [/\/echo/] }),
      ],
    });

    const res = await fetch(`${collectorUrl()}/echo`);

    const data = (await res.json()) as {
      headers: Record<string, string>;
    };
    expect(data.headers["traceparent"]).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/,
    );

    teardown();
  });

  it("sends log records to the collector when enableLogging is true", async () => {
    // Pass headers to ensure the OTLP exporter uses fetch (not sendBeacon,
    // which doesn't work reliably in Playwright).
    const teardown = initialize({
      collectorUrl: collectorUrl(),
      serviceName: "test-logging",
      enableLogging: true,
      headers: {},
    });

    // Wait for the async logging init (dynamic imports in initLogging)
    const { logs } = await import("@opentelemetry/api-logs");
    const { LoggerProvider } = await import("@opentelemetry/sdk-logs");
    const start = Date.now();
    while (Date.now() - start < 5000) {
      if (logs.getLoggerProvider() instanceof LoggerProvider) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const loggerProvider = logs.getLoggerProvider();
    expect(loggerProvider).toBeInstanceOf(LoggerProvider);

    const logger = logs.getLogger("test-logger");
    logger.emit({ body: "test log message" });

    await (loggerProvider as InstanceType<typeof LoggerProvider>).forceFlush();

    const collected = await waitForLogs((records) =>
      records.some((r) => r.body?.stringValue === "test log message"),
    );

    expect(collected.length).toBeGreaterThanOrEqual(1);
    const logRecord = collected.find(
      (r) => r.body?.stringValue === "test log message",
    );
    expect(logRecord).toBeDefined();
    expect(logRecord!.body?.stringValue).toBe("test log message");

    teardown();
  });
});
