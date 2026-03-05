import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRouterPlugin } from "../../src/plugins/tanstack-router";
import {
  createTestProvider,
  type TestProvider,
} from "../helpers/create-test-provider";
import { clearSpans, getAttr, waitForSpans } from "../test-utils";

interface NavigationEvent {
  type: string;
  fromLocation?: { pathname: string };
  toLocation: { pathname: string };
  pathChanged: boolean;
}

const createMockRouter = () => {
  const listeners: Record<string, Array<(event: NavigationEvent) => void>> = {};

  return {
    router: {
      subscribe: (eventType: string, fn: (event: NavigationEvent) => void) => {
        if (!listeners[eventType]) listeners[eventType] = [];
        listeners[eventType].push(fn);
        return () => {
          const arr = listeners[eventType];
          const idx = arr.indexOf(fn);
          if (idx >= 0) arr.splice(idx, 1);
        };
      },
    },
    emit: (eventType: string, event: NavigationEvent) => {
      for (const fn of listeners[eventType] ?? []) fn(event);
    },
  };
};

describe("createRouterPlugin", () => {
  let tp: TestProvider;

  beforeEach(async () => {
    await clearSpans();
    tp = createTestProvider();
  });

  afterEach(async () => {
    await tp.shutdown();
  });

  it("traces a navigation", async () => {
    const mock = createMockRouter();
    const plugin = createRouterPlugin(mock.router);
    plugin.setup(tp.tracer);

    mock.emit("onBeforeNavigate", {
      type: "onBeforeNavigate",
      fromLocation: { pathname: "/home" },
      toLocation: { pathname: "/about" },
      pathChanged: true,
    });

    mock.emit("onResolved", {
      type: "onResolved",
      toLocation: { pathname: "/about" },
      pathChanged: true,
    });

    await tp.flush();

    const spans = await waitForSpans((s) =>
      s.some((sp) => sp.name === "navigate /about"),
    );
    const span = spans.find((s) => s.name === "navigate /about");
    expect(span).toBeDefined();
    expect(getAttr(span!, "router.from")).toBe("/home");
    expect(getAttr(span!, "router.to")).toBe("/about");
    expect(getAttr(span!, "router.path_changed")).toBe(true);
    expect(span!.status?.code).toBe(1); // OK

    plugin.teardown();
  });

  it("ends previous span on new navigation", async () => {
    const mock = createMockRouter();
    const plugin = createRouterPlugin(mock.router);
    plugin.setup(tp.tracer);

    // Start first navigation
    mock.emit("onBeforeNavigate", {
      type: "onBeforeNavigate",
      toLocation: { pathname: "/page1" },
      pathChanged: true,
    });

    // Start second navigation before first resolves
    mock.emit("onBeforeNavigate", {
      type: "onBeforeNavigate",
      fromLocation: { pathname: "/page1" },
      toLocation: { pathname: "/page2" },
      pathChanged: true,
    });

    mock.emit("onResolved", {
      type: "onResolved",
      toLocation: { pathname: "/page2" },
      pathChanged: true,
    });

    await tp.flush();

    const spans = await waitForSpans((s) => s.length >= 2);
    expect(spans.some((s) => s.name === "navigate /page1")).toBe(true);
    expect(spans.some((s) => s.name === "navigate /page2")).toBe(true);

    plugin.teardown();
  });

  it("ignores navigations matching ignoreRoutes patterns", async () => {
    const mock = createMockRouter();
    const plugin = createRouterPlugin(mock.router, {
      ignoreRoutes: [/\/health/],
    });
    plugin.setup(tp.tracer);

    // This navigation should be ignored
    mock.emit("onBeforeNavigate", {
      type: "onBeforeNavigate",
      toLocation: { pathname: "/health" },
      pathChanged: true,
    });

    mock.emit("onResolved", {
      type: "onResolved",
      toLocation: { pathname: "/health" },
      pathChanged: true,
    });

    // This navigation should be traced
    mock.emit("onBeforeNavigate", {
      type: "onBeforeNavigate",
      fromLocation: { pathname: "/health" },
      toLocation: { pathname: "/dashboard" },
      pathChanged: true,
    });

    mock.emit("onResolved", {
      type: "onResolved",
      toLocation: { pathname: "/dashboard" },
      pathChanged: true,
    });

    await tp.flush();

    const spans = await waitForSpans((s) =>
      s.some((sp) => sp.name === "navigate /dashboard"),
    );
    expect(spans.some((s) => s.name === "navigate /dashboard")).toBe(true);
    expect(spans.some((s) => s.name === "navigate /health")).toBe(false);

    plugin.teardown();
  });

  it("cleans up on teardown", async () => {
    const mock = createMockRouter();
    const plugin = createRouterPlugin(mock.router);
    plugin.setup(tp.tracer);

    // Start navigation but don't resolve
    mock.emit("onBeforeNavigate", {
      type: "onBeforeNavigate",
      toLocation: { pathname: "/teardown" },
      pathChanged: true,
    });

    plugin.teardown();

    await tp.flush();

    // The active span should have been ended by teardown
    const spans = await waitForSpans((s) =>
      s.some((sp) => sp.name === "navigate /teardown"),
    );
    expect(spans.some((s) => s.name === "navigate /teardown")).toBe(true);
  });
});
