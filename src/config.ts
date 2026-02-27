import type { SpanAttributes } from "@opentelemetry/api";

import type { OtelWebPlugin } from "./types";

export interface OtelWebConfig {
  /** Full OTLP HTTP URL including signal path (e.g. "https://collector.example.com/v1/traces") */
  url: string;
  serviceName: string;
  headers?: Record<string, string>;
  plugins?: OtelWebPlugin[];
  getSpanAttributes?: () => SpanAttributes;
}
