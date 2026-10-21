import { useCallback, useEffect, useState } from 'react';

// One request per query: abort obsolete requests, ignore completions after
// cleanup, and hide rows only when the query itself changed. `queryKey` is the
// query's identity, so reloading the same key (a mutation, a periodic refresh)
// keeps the previous page visible as `refreshing` instead of collapsing into a
// loading state. A caller that passes no key falls back to the loader identity —
// every reload creates a new loader, so that keeps the old hide-while-loading
// behaviour and is only right for pages without a stable identity.
export function useReviewPage<T>(loader: (signal: AbortSignal) => Promise<T>, enabled: boolean, queryKey?: unknown) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: unknown; loader: typeof loader; revision: number; data?: T; error?: string }>();
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const key = queryKey === undefined ? loader : queryKey;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    loader(controller.signal).then(
      (data) => { if (!controller.signal.aborted) setResult({ key, loader, revision, data }); },
      (error) => { if (!controller.signal.aborted) setResult({ key, loader, revision, error: error instanceof Error ? error.message : 'unknown_error' }); },
    );
    return () => controller.abort();
  }, [loader, enabled, revision, key]);
  const sameQuery = enabled && result !== undefined && Object.is(result.key, key);
  const fresh = sameQuery && result!.loader === loader && result!.revision === revision;
  const data = sameQuery ? result!.data : undefined;
  return {
    data,
    error: fresh ? result!.error : undefined,
    loading: enabled && (!sameQuery || (!fresh && data === undefined)),
    refreshing: enabled && sameQuery && !fresh && data !== undefined,
    reload,
  };
}
