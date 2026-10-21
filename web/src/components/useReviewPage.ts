import { useCallback, useEffect, useState } from 'react';

// The loader identity represents the query. Hide old data immediately when it
// changes, abort obsolete requests, and ignore completions after cleanup.
export function useReviewPage<T>(loader: (signal: AbortSignal) => Promise<T>, enabled: boolean) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ loader: typeof loader; revision: number; data?: T; error?: string }>();
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    loader(controller.signal).then(
      (data) => { if (!controller.signal.aborted) setResult({ loader, revision, data }); },
      (error) => { if (!controller.signal.aborted) setResult({ loader, revision, error: error instanceof Error ? error.message : 'unknown_error' }); },
    );
    return () => controller.abort();
  }, [loader, enabled, revision]);
  const current = enabled && result?.loader === loader && result.revision === revision ? result : undefined;
  return { data: current?.data, error: current?.error, loading: enabled && !current, reload };
}
