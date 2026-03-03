import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

import { createAttributeSpanProcessor } from "./attribute-span-processor";
import type { OtelWebConfig } from "./config";

const stripTrailingSlash = (url: string) => url.replace(/\/+$/, "");

const initLogging = async (
  resource: ReturnType<typeof resourceFromAttributes>,
  collectorUrl: string,
  headers?: Record<string, string>,
) => {
  const { logs } = await import("@opentelemetry/api-logs");
  const { LoggerProvider, BatchLogRecordProcessor } =
    await import("@opentelemetry/sdk-logs");
  const { OTLPLogExporter } =
    await import("@opentelemetry/exporter-logs-otlp-http");

  const logExporter = new OTLPLogExporter({
    url: `${collectorUrl}/v1/logs`,
    headers,
  });
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor(logExporter)],
  });
  logs.setGlobalLoggerProvider(loggerProvider);

  return () => {
    loggerProvider.shutdown();
  };
};

export const initialize = (config: OtelWebConfig): (() => void) => {
  const collectorUrl = stripTrailingSlash(config.collectorUrl);

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName,
  });

  const exporter = new OTLPTraceExporter({
    url: `${collectorUrl}/v1/traces`,
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

  let loggingCleanup: (() => void) | undefined;
  if (config.enableLogging) {
    initLogging(resource, collectorUrl, config.headers).then((cleanup) => {
      loggingCleanup = cleanup;
    });
  }

  return () => {
    for (const plugin of plugins) {
      plugin.teardown();
    }
    loggingCleanup?.();
    provider.shutdown();
  };
};
