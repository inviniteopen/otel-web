import type { Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

import { collectorUrl } from "../test-utils";

export interface TestProvider {
  provider: WebTracerProvider;
  tracer: Tracer;
  flush: () => Promise<void>;
  shutdown: () => Promise<void>;
}

export const createTestProvider = (
  serviceName = "test-service",
): TestProvider => {
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
  });

  const exporter = new OTLPTraceExporter({
    url: `${collectorUrl()}/v1/traces`,
    // Pass headers to force fetch transport instead of sendBeacon
    headers: {},
  });

  const processor = new SimpleSpanProcessor(exporter);

  const provider = new WebTracerProvider({
    resource,
    spanProcessors: [processor],
  });

  // Use provider.getTracer() directly instead of registering globally.
  // This avoids global state conflicts between tests.
  const tracer = provider.getTracer(serviceName);

  return {
    provider,
    tracer,
    flush: () => processor.forceFlush(),
    shutdown: async () => {
      await processor.forceFlush();
      await provider.shutdown();
    },
  };
};
