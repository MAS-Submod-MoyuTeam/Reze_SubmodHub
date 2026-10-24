import { useEffect, useState } from 'react';

/** 超过这个滚动距离才认为「离开顶部」，避免 1px 抖动就让按钮闪烁。 */
export const SHOW_AFTER_PX = 240;

/**
 * 滚动面板是否已经离开顶部。
 *
 * 用于「返回顶部」这类只在需要时出现的控件：监听容器自身的 `scroll` 事件，
 * 而不是窗口——整页滚动时由 `pageScrollPane()` 交出转发对象，内部面板滚动时
 * 直接传容器本身。未提供面板时恒为 false，控件不出现。
 */
export function usePaneScrolled(pane: HTMLElement | null, threshold = SHOW_AFTER_PX): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!pane) {
      setScrolled(false);
      return;
    }
    const sync = () => {
      // 面板被换掉/卸载后读到的 0 不能当作「回到顶部之后再滚下去」，直接按顶部处理。
      setScrolled(pane.scrollTop > threshold);
    };
    sync();
    pane.addEventListener('scroll', sync, { passive: true });
    return () => pane.removeEventListener('scroll', sync);
  }, [pane, threshold]);

  return scrolled;
}

/**
 * 整页滚动时，`usePaneScrolled` 该观察、`scrollPaneToTop` 该推动的对象。
 *
 * 整页滚动有两半，分别挂在两个对象上，缺一半就静默失效：
 * - 滚动**位置**与滚动**动作**在 `documentElement` 上。`document` 自己既没有
 *   `scrollTop` 也没有 `scrollTo`，拿文档代替它只会永远读到 0，控件永不出现；
 * - 滚动**事件**派发在 `document` 上，`documentElement` 收不到，只监听它会永不触发。
 *
 * 所以这里返回一个转发对象：事件借用文档的，位置与动作仍走 `documentElement`。
 */
export function pageScrollPane(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.documentElement) return null;
  const root = document.documentElement;
  return {
    get scrollTop() {
      return root.scrollTop;
    },
    addEventListener: (type: string, listener: EventListener, options?: AddEventListenerOptions) => {
      document.addEventListener(type, listener, options);
    },
    removeEventListener: (type: string, listener: EventListener, options?: EventListenerOptions) => {
      document.removeEventListener(type, listener, options);
    },
    scrollTo: (...args: unknown[]) => {
      (root.scrollTo as (...rest: unknown[]) => void)(...args);
    },
  } as unknown as HTMLElement;
}
