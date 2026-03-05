import type { SpanAttributes } from "@opentelemetry/api";

import type { OtelWebPlugin } from "./types";

export interface OtelWebConfig {
  /** Base OTLP HTTP URL (e.g. "https://collector.example.com"). Signal paths (/v1/traces, /v1/logs) are appended automatically. */
  collectorUrl: string;
  serviceName: string;
  /** Service version, added as a resource attribute. */
  serviceVersion?: string;
  /** Deployment environment name (e.g. "production", "staging"), added as a resource attribute. */
  environment?: string;
  /** Trace sampling rate between 0 and 1. Defaults to 1 (sample everything). */
  sampleRate?: number;
  headers?: Record<string, string>;
  plugins?: OtelWebPlugin[];
  getSpanAttributes?: () => SpanAttributes;
  /** Enable experimental logging support. Requires @opentelemetry/api-logs peer dependency. */
  enableLogging?: boolean;
}
