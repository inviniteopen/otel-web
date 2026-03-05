import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createErrorHandlerPlugin } from "../../src/plugins/error-handler";
import {
  createTestProvider,
  TestProvider,
} from "../helpers/create-test-provider";
import { clearSpans, getAttr, waitForSpans } from "../test-utils";

describe("createErrorHandlerPlugin", () => {
  let tp: TestProvider;
  let plugin: ReturnType<typeof createErrorHandlerPlugin>;

  beforeEach(async () => {
    await clearSpans();
    tp = createTestProvider();
    plugin = createErrorHandlerPlugin();
    plugin.setup(tp.tracer);
  });

  afterEach(async () => {
    plugin.teardown();
    await tp.shutdown();
  });

  it("captures window error events", async () => {
    const error = new Error("test window error");
    window.dispatchEvent(
      new ErrorEvent("error", { error, message: error.message }),
    );

    await tp.flush();

    const spans = await waitForSpans((s) =>
      s.some((sp) => sp.name === "error"),
    );
    const span = spans.find((s) => s.name === "error");
    expect(span).toBeDefined();
    expect(getAttr(span!, "error.message")).toBe("test window error");
    expect(getAttr(span!, "error.type")).toBe("Error");
    expect(span!.status?.code).toBe(2);
  });

  it("captures errors without error object", async () => {
    window.dispatchEvent(new ErrorEvent("error", { message: "script error" }));

    await tp.flush();

    const spans = await waitForSpans((s) =>
      s.some((sp) => sp.name === "error"),
    );
    const span = spans.find((s) => s.name === "error");
    expect(span).toBeDefined();
    expect(getAttr(span!, "error.message")).toBe("script error");
    expect(span!.status?.code).toBe(2);
  });

  it("captures unhandled promise rejections", async () => {
    // Dispatch unhandledrejection event - vitest may also catch this,
    // but our handler should still fire since addEventListener receives it
    const rejectionEvent = new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason: new Error("test rejection"),
    });
    // Prevent vitest from treating this as an actual unhandled error
    rejectionEvent.preventDefault();
    window.dispatchEvent(rejectionEvent);

    await tp.flush();

    const spans = await waitForSpans((s) =>
      s.some((sp) => sp.name === "unhandled-rejection"),
    );
    const span = spans.find((s) => s.name === "unhandled-rejection");
    expect(span).toBeDefined();
    expect(getAttr(span!, "error.message")).toBe("test rejection");
    expect(span!.status?.code).toBe(2);
  });

  it("ignores errors matching ignoreErrors patterns", async () => {
    plugin.teardown();

    plugin = createErrorHandlerPlugin({
      ignoreErrors: [/ResizeObserver loop/],
    });
    plugin.setup(tp.tracer);

    // This error should be ignored
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error(
          "ResizeObserver loop completed with undelivered notifications",
        ),
        message: "ResizeObserver loop completed with undelivered notifications",
      }),
    );

    // This error should be traced
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: new Error("real error"),
        message: "real error",
      }),
    );

    await tp.flush();

    const spans = await waitForSpans((s) =>
      s.some((sp) => sp.name === "error"),
    );
    const errorSpans = spans.filter((s) => s.name === "error");
    expect(errorSpans.length).toBe(1);
    expect(getAttr(errorSpans[0], "error.message")).toBe("real error");
  });

  it("ignores unhandled rejections matching ignoreErrors patterns", async () => {
    plugin.teardown();

    plugin = createErrorHandlerPlugin({
      ignoreErrors: [/ignore me/],
    });
    plugin.setup(tp.tracer);

    // This rejection should be ignored
    const ignored = new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason: new Error("ignore me please"),
    });
    ignored.preventDefault();
    window.dispatchEvent(ignored);

    // This rejection should be traced
    const tracked = new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason: new Error("real rejection"),
    });
    tracked.preventDefault();
    window.dispatchEvent(tracked);

    await tp.flush();

    const spans = await waitForSpans((s) =>
      s.some((sp) => sp.name === "unhandled-rejection"),
    );
    const rejectionSpans = spans.filter(
      (s) => s.name === "unhandled-rejection",
    );
    expect(rejectionSpans.length).toBe(1);
    expect(getAttr(rejectionSpans[0], "error.message")).toBe("real rejection");
  });

  it("handles non-Error rejection reasons", async () => {
    const rejectionEvent = new PromiseRejectionEvent("unhandledrejection", {
      promise: Promise.resolve(),
      reason: "string rejection",
    });
    rejectionEvent.preventDefault();
    window.dispatchEvent(rejectionEvent);

    await tp.flush();

    const spans = await waitForSpans((s) =>
      s.some((sp) => sp.name === "unhandled-rejection"),
    );
    const span = spans.find((s) => s.name === "unhandled-rejection");
    expect(span).toBeDefined();
    expect(getAttr(span!, "error.message")).toBe("string rejection");
    expect(getAttr(span!, "error.type")).toBe("UnhandledRejection");
  });
});
