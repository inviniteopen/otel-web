import { type Span, SpanStatusCode, type Tracer } from "@opentelemetry/api";

import type { OtelWebPlugin } from "../types";

interface NavigationEvent {
  type: string;
  fromLocation?: { pathname: string };
  toLocation: { pathname: string };
  pathChanged: boolean;
}

interface RouterLike {
  subscribe: <T extends "onBeforeNavigate" | "onResolved">(
    eventType: T,
    fn: (event: NavigationEvent) => void,
  ) => () => void;
}

export const createRouterPlugin = (router: RouterLike): OtelWebPlugin => {
  let unsubBeforeNavigate: (() => void) | undefined;
  let unsubResolved: (() => void) | undefined;
  let activeSpan: Span | undefined;

  return {
    setup(tracer: Tracer) {
      unsubBeforeNavigate = router.subscribe("onBeforeNavigate", (event) => {
        if (activeSpan) {
          activeSpan.end();
        }

        activeSpan = tracer.startSpan(`navigate ${event.toLocation.pathname}`, {
          attributes: {
            "router.from": event.fromLocation?.pathname ?? "",
            "router.to": event.toLocation.pathname,
            "router.path_changed": event.pathChanged,
          },
        });
      });

      unsubResolved = router.subscribe("onResolved", () => {
        if (activeSpan) {
          activeSpan.setStatus({ code: SpanStatusCode.OK });
          activeSpan.end();
          activeSpan = undefined;
        }
      });
    },

    teardown() {
      unsubBeforeNavigate?.();
      unsubResolved?.();
      if (activeSpan) {
        activeSpan.end();
        activeSpan = undefined;
      }
    },
  };
};
