import type { SpanAttributes } from "@opentelemetry/api";
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from "@opentelemetry/sdk-trace-base";

export const createAttributeSpanProcessor = (
  getAttributes: () => SpanAttributes,
): SpanProcessor => ({
  onStart: (span: Span) => span.setAttributes(getAttributes()),
  onEnd: (_span: ReadableSpan) => {},
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
});
