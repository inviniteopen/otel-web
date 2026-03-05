import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createQueryPlugin } from "../../src/plugins/tanstack-query";
import {
  createTestProvider,
  type TestProvider,
} from "../helpers/create-test-provider";
import { clearSpans, getAttr, waitForSpans } from "../test-utils";

interface MockQueryCacheEvent {
  type: string;
  query: {
    queryKey: ReadonlyArray<unknown>;
    queryHash: string;
  };
  action?: { type: string; error?: unknown };
}

interface MockMutationCacheEvent {
  type: string;
  mutation?: {
    mutationId: number;
    options: { mutationKey?: ReadonlyArray<unknown> };
  };
  action?: { type: string; error?: unknown };
}

const createMockQueryClient = () => {
  const queryListeners: Array<(event: MockQueryCacheEvent) => void> = [];
  const mutationListeners: Array<(event: MockMutationCacheEvent) => void> = [];

  return {
    client: {
      getQueryCache: () => ({
        subscribe: (fn: (event: MockQueryCacheEvent) => void) => {
          queryListeners.push(fn);
          return () => {
            const idx = queryListeners.indexOf(fn);
            if (idx >= 0) queryListeners.splice(idx, 1);
          };
        },
      }),
      getMutationCache: () => ({
        subscribe: (fn: (event: MockMutationCacheEvent) => void) => {
          mutationListeners.push(fn);
          return () => {
            const idx = mutationListeners.indexOf(fn);
            if (idx >= 0) mutationListeners.splice(idx, 1);
          };
        },
      }),
    },
    emitQuery: (event: MockQueryCacheEvent) => {
      for (const fn of queryListeners) fn(event);
    },
    emitMutation: (event: MockMutationCacheEvent) => {
      for (const fn of mutationListeners) fn(event);
    },
  };
};

describe("createQueryPlugin", () => {
  let tp: TestProvider;

  beforeEach(async () => {
    await clearSpans();
    tp = createTestProvider();
  });

  afterEach(async () => {
    await tp.shutdown();
  });

  it("traces a successful query lifecycle", async () => {
    const mock = createMockQueryClient();
    const plugin = createQueryPlugin(mock.client);
    plugin.setup(tp.tracer);

    // Start fetch
    mock.emitQuery({
      type: "updated",
      query: { queryKey: ["users", 1], queryHash: '["users",1]' },
      action: { type: "fetch" },
    });

    // Complete successfully
    mock.emitQuery({
      type: "updated",
      query: { queryKey: ["users", 1], queryHash: '["users",1]' },
      action: { type: "success" },
    });

    await tp.flush();

    const spans = await waitForSpans((s) =>
      s.some((sp) => sp.name.startsWith("query ")),
    );
    const span = spans.find((s) => s.name.startsWith("query "));
    expect(span).toBeDefined();
    expect(span!.name).toBe('query ["users",1]');
    expect(getAttr(span!, "query.hash")).toBe('["users",1]');
    expect(span!.status?.code).toBe(1); // OK

    plugin.teardown();
  });

  it("traces a failed query", async () => {
    const mock = createMockQueryClient();
    const plugin = createQueryPlugin(mock.client);
    plugin.setup(tp.tracer);

    mock.emitQuery({
      type: "updated",
      query: { queryKey: ["users"], queryHash: '["users"]' },
      action: { type: "fetch" },
    });

    mock.emitQuery({
      type: "updated",
      query: { queryKey: ["users"], queryHash: '["users"]' },
      action: { type: "error", error: new Error("network error") },
    });

    await tp.flush();

    const spans = await waitForSpans((s) =>
      s.some((sp) => sp.status?.code === 2),
    );
    const span = spans.find((s) => s.name.startsWith("query "));
    expect(span).toBeDefined();
    expect(span!.status?.code).toBe(2); // ERROR
    expect(span!.status?.message).toBe("network error");

    plugin.teardown();
  });

  it("traces a successful mutation", async () => {
    const mock = createMockQueryClient();
    const plugin = createQueryPlugin(mock.client);
    plugin.setup(tp.tracer);

    mock.emitMutation({
      type: "updated",
      mutation: {
        mutationId: 1,
        options: { mutationKey: ["updateUser"] },
      },
      action: { type: "pending" },
    });

    mock.emitMutation({
      type: "updated",
      mutation: {
        mutationId: 1,
        options: { mutationKey: ["updateUser"] },
      },
      action: { type: "success" },
    });

    await tp.flush();

    const spans = await waitForSpans((s) =>
      s.some((sp) => sp.name.startsWith("mutation ")),
    );
    const span = spans.find((s) => s.name.startsWith("mutation "));
    expect(span).toBeDefined();
    expect(span!.name).toBe('mutation ["updateUser"]');
    expect(span!.status?.code).toBe(1); // OK

    plugin.teardown();
  });

  it("ignores queries matching ignoreQueries patterns", async () => {
    const mock = createMockQueryClient();
    const plugin = createQueryPlugin(mock.client, {
      ignoreQueries: [/health/],
    });
    plugin.setup(tp.tracer);

    // This query should be ignored
    mock.emitQuery({
      type: "updated",
      query: { queryKey: ["health"], queryHash: '["health"]' },
      action: { type: "fetch" },
    });

    mock.emitQuery({
      type: "updated",
      query: { queryKey: ["health"], queryHash: '["health"]' },
      action: { type: "success" },
    });

    // This query should be traced
    mock.emitQuery({
      type: "updated",
      query: { queryKey: ["users"], queryHash: '["users"]' },
      action: { type: "fetch" },
    });

    mock.emitQuery({
      type: "updated",
      query: { queryKey: ["users"], queryHash: '["users"]' },
      action: { type: "success" },
    });

    await tp.flush();

    const spans = await waitForSpans((s) =>
      s.some((sp) => sp.name.startsWith("query ")),
    );
    expect(spans.filter((s) => s.name.startsWith("query ")).length).toBe(1);
    expect(spans.some((s) => s.name === 'query ["users"]')).toBe(true);
    expect(spans.some((s) => s.name === 'query ["health"]')).toBe(false);

    plugin.teardown();
  });

  it("ignores mutations matching ignoreMutations patterns", async () => {
    const mock = createMockQueryClient();
    const plugin = createQueryPlugin(mock.client, {
      ignoreMutations: [/analytics/],
    });
    plugin.setup(tp.tracer);

    // This mutation should be ignored
    mock.emitMutation({
      type: "updated",
      mutation: {
        mutationId: 1,
        options: { mutationKey: ["analytics", "track"] },
      },
      action: { type: "pending" },
    });

    mock.emitMutation({
      type: "updated",
      mutation: {
        mutationId: 1,
        options: { mutationKey: ["analytics", "track"] },
      },
      action: { type: "success" },
    });

    // This mutation should be traced
    mock.emitMutation({
      type: "updated",
      mutation: {
        mutationId: 2,
        options: { mutationKey: ["updateUser"] },
      },
      action: { type: "pending" },
    });

    mock.emitMutation({
      type: "updated",
      mutation: {
        mutationId: 2,
        options: { mutationKey: ["updateUser"] },
      },
      action: { type: "success" },
    });

    await tp.flush();

    const spans = await waitForSpans((s) =>
      s.some((sp) => sp.name.startsWith("mutation ")),
    );
    expect(spans.filter((s) => s.name.startsWith("mutation ")).length).toBe(1);
    expect(spans.some((s) => s.name === 'mutation ["updateUser"]')).toBe(true);

    plugin.teardown();
  });

  it("truncates long query keys in span names", async () => {
    const mock = createMockQueryClient();
    const plugin = createQueryPlugin(mock.client);
    plugin.setup(tp.tracer);

    const longKey = ["x".repeat(200)];
    const hash = JSON.stringify(longKey);

    mock.emitQuery({
      type: "updated",
      query: { queryKey: longKey, queryHash: hash },
      action: { type: "fetch" },
    });

    mock.emitQuery({
      type: "updated",
      query: { queryKey: longKey, queryHash: hash },
      action: { type: "success" },
    });

    await tp.flush();

    const spans = await waitForSpans((s) =>
      s.some((sp) => sp.name.startsWith("query ")),
    );
    const span = spans.find((s) => s.name.startsWith("query "));
    expect(span).toBeDefined();
    // Span name should be truncated
    expect(span!.name.length).toBeLessThanOrEqual("query ".length + 128 + 3);
    expect(span!.name).toContain("...");

    plugin.teardown();
  });
});
