import type { Tracer } from "@opentelemetry/api";

import type { OtelWebPlugin } from "../types";

export const createDocumentLoadPlugin = (): OtelWebPlugin => {
  let observer: PerformanceObserver | undefined;

  return {
    setup(tracer: Tracer) {
      const emitNavigationSpan = (): void => {
        const [navigation] = performance.getEntriesByType(
          "navigation",
        ) as PerformanceNavigationTiming[];
        if (!navigation) return;

        const span = tracer.startSpan("document.load", {
          startTime: navigation.startTime,
          attributes: {
            "document.url": location.href,
            "document.type": navigation.type,
            "document.redirect_count": navigation.redirectCount,
            "timing.dns_ms":
              navigation.domainLookupEnd - navigation.domainLookupStart,
            "timing.connect_ms":
              navigation.connectEnd - navigation.connectStart,
            "timing.tls_ms":
              navigation.secureConnectionStart > 0
                ? navigation.connectEnd - navigation.secureConnectionStart
                : 0,
            "timing.ttfb_ms":
              navigation.responseStart - navigation.requestStart,
            "timing.response_ms":
              navigation.responseEnd - navigation.responseStart,
            "timing.dom_interactive_ms": navigation.domInteractive,
            "timing.dom_content_loaded_ms": navigation.domContentLoadedEventEnd,
            "timing.load_ms": navigation.loadEventEnd,
            "transfer.size": navigation.transferSize,
            "transfer.decoded_size": navigation.decodedBodySize,
          },
        });
        span.end(navigation.loadEventEnd);
      };

      const emitPaintSpans = (
        entries: PerformanceEntryList,
        navigationStart: number,
      ): void => {
        for (const entry of entries) {
          if (
            entry.name !== "first-paint" &&
            entry.name !== "first-contentful-paint"
          )
            continue;

          const span = tracer.startSpan(entry.name, {
            startTime: navigationStart,
            attributes: {
              "document.url": location.href,
              "paint.duration_ms": entry.startTime,
            },
          });
          span.end(entry.startTime);
        }
      };

      const emitLcpSpan = (
        entries: PerformanceEntryList,
        navigationStart: number,
      ): void => {
        const last = entries[entries.length - 1];
        if (!last) return;

        const lcp = last as PerformanceEntry & {
          element?: Element;
          size?: number;
        };

        const span = tracer.startSpan("largest-contentful-paint", {
          startTime: navigationStart,
          attributes: {
            "document.url": location.href,
            "lcp.duration_ms": lcp.startTime,
            "lcp.element": lcp.element?.tagName ?? "",
            "lcp.size": lcp.size ?? 0,
          },
        });
        span.end(lcp.startTime);
      };

      if (document.readyState === "complete") {
        emitNavigationSpan();
      } else {
        window.addEventListener("load", () => emitNavigationSpan(), {
          once: true,
        });
      }

      const navigationStart =
        (
          performance.getEntriesByType("navigation")[0] as
            | PerformanceNavigationTiming
            | undefined
        )?.startTime ?? 0;

      // Paint metrics (FP, FCP)
      const existingPaintEntries = performance.getEntriesByType("paint");
      if (existingPaintEntries.length > 0) {
        emitPaintSpans(existingPaintEntries, navigationStart);
      } else {
        try {
          const paintObserver = new PerformanceObserver((list) => {
            emitPaintSpans(list.getEntries(), navigationStart);
            paintObserver.disconnect();
          });
          paintObserver.observe({ type: "paint", buffered: true });
        } catch {
          // PerformanceObserver not supported for paint entries
        }
      }

      // Largest Contentful Paint
      try {
        observer = new PerformanceObserver((list) => {
          emitLcpSpan(list.getEntries(), navigationStart);
        });
        observer.observe({ type: "largest-contentful-paint", buffered: true });
      } catch {
        // LCP not supported
      }
    },

    teardown() {
      observer?.disconnect();
      observer = undefined;
    },
  };
};
