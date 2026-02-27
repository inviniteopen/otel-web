import type { Tracer } from "@opentelemetry/api";

export interface OtelWebPlugin {
  setup: (tracer: Tracer) => void;
  teardown: () => void;
}
