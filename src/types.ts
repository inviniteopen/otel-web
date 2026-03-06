import type { Tracer } from "@opentelemetry/api";

export interface PluginContext {
  collectorUrl: string;
}

export interface OtelWebPlugin {
  setup: (tracer: Tracer, context?: PluginContext) => void;
  teardown: () => void;
}
