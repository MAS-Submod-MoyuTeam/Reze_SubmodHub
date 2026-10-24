import { useCallback, useEffect, useRef, useState } from 'react';

export interface LoadMoreOnScrollOptions {
  /** Still more rows to append; when false the observer is not armed at all. */
  hasMore: boolean;
  onLoadMore: () => void;
  /**
   * 当前已渲染的行数。行数变化说明刚刚追加了一页；观察器必须重新挂载，
   * 否则加载后仍落在预取区内的哨兵会立刻死掉——列表比屏幕短时用户无法再滚动触发。
   */
  loadedCount: number;
  /**
   * 真正滚动的容器。桌面客户端的目录是一个内部滚动面板而不是页面视口，
   * 以视口为 root 的观察器在内部容器里永远不会回调。
   */
  scrollRoot: HTMLElement | null;
}

/** Prefetch distance below the scroll viewport. */
const PREFETCH_MARGIN = '0px 0px 240px 0px';

/**
 * 哨兵滚入预取区时自动加载下一页，返回挂到「最后一行之后」节点的 ref。
 * 同一个手动按钮可以放在哨兵里，作为键盘可达与无 IntersectionObserver 环境的兜底。
 *
 * 元素存在 state 而不是 `useRef`：首屏渲染骨架时哨兵还不存在，ref-only 的 effect
 * 只会拿到 null 且不会再跑一次。节点变化会重新挂载观察器。
 */
export function useLoadMoreOnScroll({ hasMore, onLoadMore, loadedCount, scrollRoot }: LoadMoreOnScrollOptions) {
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const onLoadMoreRef = useRef(onLoadMore);
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    if (!hasMore || !sentinel || !scrollRoot) return;
    // 没有 IntersectionObserver 的环境只保留手动按钮。
    if (typeof IntersectionObserver === 'undefined') return;
    let released = false;
    const observer = new IntersectionObserver(
      (entries) => {
        // 重挂之后旧观察器已排队的回调仍可能跑起来，必须按自己的释放状态丢弃，
        // 否则一次滚动就能叠出好几页。
        if (released) return;
        if (entries.some((entry) => entry.isIntersecting)) onLoadMoreRef.current();
      },
      { root: scrollRoot, rootMargin: PREFETCH_MARGIN, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => {
      released = true;
      observer.disconnect();
    };
  }, [hasMore, sentinel, loadedCount, scrollRoot]);

  return useCallback((node: HTMLDivElement | null) => setSentinel(node), []);
}
