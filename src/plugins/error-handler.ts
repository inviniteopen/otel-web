import { SpanStatusCode, type Tracer } from "@opentelemetry/api";

import type { OtelWebPlugin } from "../types";

export const createErrorHandlerPlugin = (): OtelWebPlugin => {
  let errorHandler: ((event: ErrorEvent) => void) | undefined;
  let rejectionHandler: ((event: PromiseRejectionEvent) => void) | undefined;

  return {
    setup(tracer: Tracer) {
      errorHandler = (event: ErrorEvent) => {
        const span = tracer.startSpan("error", {
          attributes: {
            "error.type": event.error?.name ?? "Error",
            "error.message": event.message,
            "error.stack": event.error?.stack ?? "",
          },
        });
        if (event.error instanceof Error) {
          span.recordException(event.error);
        }
        span.setStatus({ code: SpanStatusCode.ERROR, message: event.message });
        span.end();
      };

      rejectionHandler = (event: PromiseRejectionEvent) => {
        const reason = event.reason;
        const message =
          reason instanceof Error ? reason.message : String(reason);

        const span = tracer.startSpan("unhandled-rejection", {
          attributes: {
            "error.type":
              reason instanceof Error ? reason.name : "UnhandledRejection",
            "error.message": message,
            "error.stack": reason instanceof Error ? (reason.stack ?? "") : "",
          },
        });
        if (reason instanceof Error) {
          span.recordException(reason);
        }
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        span.end();
      };

      window.addEventListener("error", errorHandler);
      window.addEventListener("unhandledrejection", rejectionHandler);
    },

    teardown() {
      if (errorHandler) {
        window.removeEventListener("error", errorHandler);
        errorHandler = undefined;
      }
      if (rejectionHandler) {
        window.removeEventListener("unhandledrejection", rejectionHandler);
        rejectionHandler = undefined;
      }
    },
  };
};
