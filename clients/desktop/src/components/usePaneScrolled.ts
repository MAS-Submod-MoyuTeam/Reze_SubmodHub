import { useEffect, useState } from 'react';

/** 超过这个滚动距离才认为「离开顶部」，避免 1px 抖动就让按钮闪烁。 */
const SHOW_AFTER_PX = 240;

/**
 * 滚动面板是否已经离开顶部。
 *
 * 用于「返回顶部」这类只在需要时出现的控件：监听面板自身的 `scroll` 事件，
 * 而不是窗口——客户端目录在被裁切的内部面板里滚动，窗口不会有滚动事件。
 * 未提供面板时恒为 false，控件不出现。
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
