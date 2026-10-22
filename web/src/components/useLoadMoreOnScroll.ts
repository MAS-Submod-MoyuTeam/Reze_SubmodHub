import { useCallback, useEffect, useRef, useState } from 'react';

export interface LoadMoreOnScrollOptions {
  /** Still more rows to append; when false the observer is not armed at all. */
  hasMore: boolean;
  onLoadMore: () => void;
  /**
   * How many rows are showing now (any change means a page was appended). The
   * observer is re-armed on every change so a sentinel that is still inside the
   * prefetch area after a load keeps filling it, instead of waiting for a scroll
   * the user cannot make on a list shorter than the screen. Required on purpose:
   * without it the sentinel goes dead as soon as one page lands inside the
   * prefetch area.
   */
  loadedCount: number;
}

/** Prefetch distance below the viewport. */
const PREFETCH_MARGIN = '0px 0px 240px 0px';

/**
 * Auto-loads the next page when the returned sentinel scrolls into view.
 * Returns a ref to attach to a node placed right after the last row; the same
 * manual "load more" button can live inside it as a keyboard/observer-less
 * fallback.
 *
 * `root` is the viewport, so the sentinel has to sit in the page scroll: inside
 * an inner scroll container the observer would never fire.
 *
 * The element is held in state rather than in a `useRef` on purpose: the
 * sentinel only mounts once the first page exists (before that the list renders
 * a skeleton), so a ref-based effect would run with a null node and never get a
 * second chance. A change of node re-arms the observer.
 */
export function useLoadMoreOnScroll({ hasMore, onLoadMore, loadedCount }: LoadMoreOnScrollOptions) {
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    if (!hasMore || !sentinel) return;
    // Environments without IntersectionObserver keep the manual button only.
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMoreRef.current();
      },
      { root: null, rootMargin: PREFETCH_MARGIN, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, sentinel, loadedCount]);

  return useCallback((node: HTMLDivElement | null) => setSentinel(node), []);
}
