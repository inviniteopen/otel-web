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
