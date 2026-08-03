import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDocumentLoadPlugin } from "../../src/plugins/document-load";
import { initialize } from "../../src/provider";
import {
  createTestProvider,
  type TestProvider,
} from "../helpers/create-test-provider";
import { clearSpans, getAttr, waitForSpans } from "../test-utils";
import { collectorUrl } from "../test-utils";

describe("createDocumentLoadPlugin", () => {
  let tp: TestProvider;

  beforeEach(async () => {
    await clearSpans();
    tp = createTestProvider();
  });

  afterEach(async () => {
    await tp.shutdown();
  });

  it("emits a document.load span with timing attributes", async () => {
    const plugin = createDocumentLoadPlugin();
    plugin.setup(tp.tracer);

    await tp.flush();

    const spans = await waitForSpans((s) =>
      s.some((sp) => sp.name === "document.load"),
    );
    const span = spans.find((s) => s.name === "document.load");
    expect(span).toBeDefined();
    expect(getAttr(span!, "document.url")).toBeTruthy();
    expect(getAttr(span!, "document.type")).toBeTruthy();
    expect(getAttr(span!, "timing.ttfb_ms")).toBeDefined();
    expect(getAttr(span!, "transfer.size")).toBeDefined();

    plugin.teardown();
  });

  describe("SSR trace context", () => {
    const TEST_TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
    const TEST_SPAN_ID = "b7ad6b7169203331";
    // Reassigned to a no-op once called, so the test can tear down early to
    // flush spans without afterEach shutting the same provider down twice.
    let teardown = () => {};

    afterEach(() => {
      teardown();
      teardown = () => {};
      document
        .querySelectorAll('meta[name="traceparent"], meta[name="tracestate"]')
        .forEach((el) => el.remove());
    });

    it("inherits traceId from <meta name='traceparent'>", async () => {
      const meta = document.createElement("meta");
      meta.name = "traceparent";
      meta.content = `00-${TEST_TRACE_ID}-${TEST_SPAN_ID}-01`;
      document.head.appendChild(meta);

      teardown = initialize({
        collectorUrl: collectorUrl(),
        serviceName: "test-ssr-propagation",
        plugins: [createDocumentLoadPlugin()],
      });

      // The plugin emits document.load synchronously during setup (readyState is
      // already "complete" here), but initialize() wires a BatchSpanProcessor
      // whose default 5s flush interval is exactly waitForSpans' default
      // timeout — waiting on that timer was a coin flip. Tearing down shuts the
      // provider down, which force-flushes, matching how the rest of the suite
      // flushes explicitly before asserting on collected spans.
      teardown();
      teardown = () => {};

      const spans = await waitForSpans((s) =>
        s.some((sp) => sp.name === "document.load"),
      );
      const span = spans.find((s) => s.name === "document.load");
      expect(span).toBeDefined();
      expect(span!.traceId).toBe(TEST_TRACE_ID);
    });
  });
});
