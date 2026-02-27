import { type Span, SpanStatusCode, type Tracer } from "@opentelemetry/api";

import type { OtelWebPlugin } from "../types";

interface QueryLike {
  queryKey: ReadonlyArray<unknown>;
  queryHash: string;
}

interface MutationLike {
  mutationId: number;
  options: { mutationKey?: ReadonlyArray<unknown> };
}

interface CacheLike<TEvent> {
  subscribe: (listener: (event: TEvent) => void) => () => void;
}

interface QueryCacheEvent {
  type: string;
  query: QueryLike;
  action?: { type: string; error?: unknown };
}

interface MutationCacheEvent {
  type: string;
  mutation?: MutationLike;
  action?: { type: string; error?: unknown };
}

interface QueryClientLike {
  getQueryCache: () => CacheLike<QueryCacheEvent>;
  getMutationCache: () => CacheLike<MutationCacheEvent>;
}

export const createQueryPlugin = (
  queryClient: QueryClientLike,
): OtelWebPlugin => {
  let unsubQueryCache: (() => void) | undefined;
  let unsubMutationCache: (() => void) | undefined;
  const querySpans = new Map<string, Span>();
  const mutationSpans = new Map<number, Span>();

  return {
    setup(tracer: Tracer) {
      unsubQueryCache = queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== "updated" || !event.action) return;

        const { queryHash, queryKey } = event.query;
        const actionType = event.action.type;

        if (actionType === "fetch" && !querySpans.has(queryHash)) {
          const span = tracer.startSpan(`query ${JSON.stringify(queryKey)}`, {
            attributes: {
              "query.hash": queryHash,
              "query.key": JSON.stringify(queryKey),
            },
          });
          querySpans.set(queryHash, span);
        } else if (actionType === "success") {
          const span = querySpans.get(queryHash);
          if (span) {
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            querySpans.delete(queryHash);
          }
        } else if (actionType === "error") {
          const span = querySpans.get(queryHash);
          if (span) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message:
                event.action.error instanceof Error
                  ? event.action.error.message
                  : "Unknown error",
            });
            if (event.action.error instanceof Error) {
              span.recordException(event.action.error);
            }
            span.end();
            querySpans.delete(queryHash);
          }
        }
      });

      unsubMutationCache = queryClient.getMutationCache().subscribe((event) => {
        if (event.type !== "updated" || !event.action || !event.mutation)
          return;

        const { mutationId } = event.mutation;
        const mutationKey = event.mutation.options.mutationKey;
        const actionType = event.action.type;

        if (actionType === "pending" && !mutationSpans.has(mutationId)) {
          const span = tracer.startSpan(
            `mutation ${mutationKey ? JSON.stringify(mutationKey) : mutationId}`,
            {
              attributes: {
                "mutation.id": mutationId,
                "mutation.key": mutationKey ? JSON.stringify(mutationKey) : "",
              },
            },
          );
          mutationSpans.set(mutationId, span);
        } else if (actionType === "success") {
          const span = mutationSpans.get(mutationId);
          if (span) {
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            mutationSpans.delete(mutationId);
          }
        } else if (actionType === "error") {
          const span = mutationSpans.get(mutationId);
          if (span) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message:
                event.action.error instanceof Error
                  ? event.action.error.message
                  : "Unknown error",
            });
            if (event.action.error instanceof Error) {
              span.recordException(event.action.error);
            }
            span.end();
            mutationSpans.delete(mutationId);
          }
        }
      });
    },

    teardown() {
      unsubQueryCache?.();
      unsubMutationCache?.();

      for (const span of querySpans.values()) {
        span.end();
      }
      querySpans.clear();

      for (const span of mutationSpans.values()) {
        span.end();
      }
      mutationSpans.clear();
    },
  };
};
