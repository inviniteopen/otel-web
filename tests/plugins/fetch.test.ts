import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createFetchPlugin,
  type FetchPluginConfig,
} from "../../src/plugins/fetch";
import { initialize } from "../../src/provider";
import {
  createTestProvider,
  type TestProvider,
} from "../helpers/create-test-provider";
import { clearSpans, collectorUrl, getAttr, waitForSpans } from "../test-utils";

const createPlugin = (config?: FetchPluginConfig) => {
  const plugin = createFetchPlugin(config);
  return plugin;
};

describe("createFetchPlugin", () => {
  let tp: TestProvider;

  beforeEach(async () => {
    await clearSpans();
    tp = createTestProvider();
  });

  afterEach(async () => {
    await tp.shutdown();
  });

  describe("fetch patching", () => {
    let plugin: ReturnType<typeof createFetchPlugin>;

    beforeEach(() => {
      plugin = createPlugin();
      plugin.setup(tp.tracer);
    });

    afterEach(() => {
      plugin.teardown();
    });

    it("traces successful fetch requests", async () => {
      // Fetch something that returns 200 — use the collector's GET /spans endpoint
      await fetch(`${collectorUrl()}/spans`);
      await tp.flush();

      const spans = await waitForSpans((s) =>
        s.some((sp) => sp.name === "HTTP GET"),
      );
      const span = spans.find(
        (s) =>
          s.name === "HTTP GET" &&
          getAttr(s, "http.url") === `${collectorUrl()}/spans`,
      );
      expect(span).toBeDefined();
      expect(getAttr(span!, "http.method")).toBe("GET");
      expect(getAttr(span!, "http.status_code")).toBe(200);
    });

    it("traces fetch errors", async () => {
      try {
        await fetch("http://localhost:1/nonexistent");
      } catch {
        // expected
      }
      await tp.flush();

      const spans = await waitForSpans((s) =>
        s.some((sp) => sp.name === "HTTP GET" && sp.status?.code === 2),
      );
      const span = spans.find(
        (s) => s.name === "HTTP GET" && s.status?.code === 2,
      );
      expect(span).toBeDefined();
    });
  });

  describe("ignoreUrls", () => {
    let plugin: ReturnType<typeof createFetchPlugin>;

    beforeEach(() => {
      plugin = createPlugin({ ignoreUrls: [/\/spans$/] });
      plugin.setup(tp.tracer);
    });

    afterEach(() => {
      plugin.teardown();
    });

    it("does not trace ignored URLs", async () => {
      await fetch(`${collectorUrl()}/spans`);
      await tp.flush();
      await new Promise((r) => setTimeout(r, 200));

      const spans = await waitForSpans(() => true, { timeout: 500 });
      const matching = spans.filter(
        (s) =>
          s.name === "HTTP GET" &&
          getAttr(s, "http.url") === `${collectorUrl()}/spans`,
      );
      expect(matching).toHaveLength(0);
    });
  });

  describe("XHR patching", () => {
    let plugin: ReturnType<typeof createFetchPlugin>;

    beforeEach(() => {
      plugin = createPlugin();
      plugin.setup(tp.tracer);
    });

    afterEach(() => {
      plugin.teardown();
    });

    it("traces successful XHR requests", async () => {
      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", `${collectorUrl()}/spans`);
        xhr.onloadend = () => resolve();
        xhr.send();
      });
      await tp.flush();

      const spans = await waitForSpans((s) =>
        s.some(
          (sp) =>
            sp.name === "HTTP GET" &&
            getAttr(sp, "http.url") === `${collectorUrl()}/spans`,
        ),
      );
      const span = spans.find(
        (s) =>
          s.name === "HTTP GET" &&
          getAttr(s, "http.url") === `${collectorUrl()}/spans`,
      );
      expect(span).toBeDefined();
      expect(getAttr(span!, "http.status_code")).toBe(200);
    });

    it("traces XHR abort", async () => {
      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", `${collectorUrl()}/spans`);
        xhr.onabort = () => resolve();
        xhr.send();
        xhr.abort();
      });
      await tp.flush();

      const spans = await waitForSpans((s) =>
        s.some((sp) => sp.status?.message === "XHR request aborted"),
      );
      const span = spans.find(
        (s) => s.status?.message === "XHR request aborted",
      );
      expect(span).toBeDefined();
      expect(span!.status?.code).toBe(2);
    });
  });

  describe("propagateToUrls", () => {
    let teardown: () => void;

    beforeEach(async () => {
      teardown = initialize({
        collectorUrl: collectorUrl(),
        serviceName: "test-fetch-propagation",
        plugins: [createPlugin({ propagateToUrls: [/\/echo/] })],
      });
    });

    afterEach(() => {
      teardown();
    });

    it("injects traceparent header into matching fetch requests", async () => {
      const res = await fetch(`${collectorUrl()}/echo`);
      const data = (await res.json()) as {
        headers: Record<string, string>;
      };
      expect(data.headers["traceparent"]).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/,
      );
    });

    it("injects traceparent header into matching XHR requests", async () => {
      const data = await new Promise<{ headers: Record<string, string> }>(
        (resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", `${collectorUrl()}/echo`);
          xhr.onload = () => resolve(JSON.parse(xhr.responseText));
          xhr.send();
        },
      );
      expect(data.headers["traceparent"]).toMatch(
        /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/,
      );
    });
  });

  describe("teardown", () => {
    it("restores original fetch and XHR", () => {
      const origFetch = globalThis.fetch;
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;

      const plugin = createPlugin();
      plugin.setup(tp.tracer);

      // After setup, the originals should be replaced
      expect(globalThis.fetch).not.toBe(origFetch);

      plugin.teardown();

      // After teardown, originals should be restored
      expect(globalThis.fetch).toBe(origFetch);
      expect(XMLHttpRequest.prototype.open).toBe(origOpen);
      expect(XMLHttpRequest.prototype.send).toBe(origSend);
    });
  });
});
