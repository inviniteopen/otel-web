import type { SpanAttributes } from "@opentelemetry/api";

import type { OtelWebPlugin } from "./types";

export interface OtelWebConfig {
  /** Base OTLP HTTP URL (e.g. "https://collector.example.com"). Signal paths (/v1/traces, /v1/logs) are appended automatically. */
  collectorUrl: string;
  serviceName: string;
  headers?: Record<string, string>;
  plugins?: OtelWebPlugin[];
  getSpanAttributes?: () => SpanAttributes;
  /** Enable experimental logging support. Requires @opentelemetry/api-logs peer dependency. */
  enableLogging?: boolean;
}
