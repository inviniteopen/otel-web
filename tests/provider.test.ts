import { beforeEach, describe, expect, it } from "vitest";
import type { Tracer } from "@opentelemetry/api";

import { initialize } from "../src/provider";
import type { OtelWebPlugin } from "../src/types";
import { clearSpans, clearLogs, collectorUrl, waitForLogs } from "./test-utils";

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

    const collected = await waitForLogs(
      (records) =>
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
