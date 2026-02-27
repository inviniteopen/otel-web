import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

import { createAttributeSpanProcessor } from "./attribute-span-processor";
import type { OtelWebConfig } from "./config";

export const initialize = (config: OtelWebConfig): (() => void) => {
  const resource = new Resource({
    [ATTR_SERVICE_NAME]: config.serviceName,
  });

  const exporter = new OTLPTraceExporter({
    url: config.url,
    headers: config.headers,
  });

  const spanProcessors: SpanProcessor[] = [];
  if (config.getSpanAttributes) {
    spanProcessors.push(createAttributeSpanProcessor(config.getSpanAttributes));
  }
  spanProcessors.push(new BatchSpanProcessor(exporter));

  const provider = new WebTracerProvider({
    resource,
    spanProcessors,
  });

  provider.register();

  const tracer = trace.getTracer(config.serviceName);

  const plugins = config.plugins ?? [];
  for (const plugin of plugins) {
    plugin.setup(tracer);
  }

  return () => {
    for (const plugin of plugins) {
      plugin.teardown();
    }
    provider.shutdown();
  };
};
