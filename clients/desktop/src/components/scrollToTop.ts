/**
 * 目录「返回顶部」的滚动动作。
 *
 * 单独抽成函数而不是写在组件里，是为了让「滚哪一段」有明确边界：
 * 客户端目录在被 `overflow-y-auto` 裁切的内部面板里滚动，滚窗口没有效果。
 */

/** 只要求滚动接口，jsdom 里的假面板同样可以代入。 */
export type ScrollablePane = Pick<HTMLElement, 'scrollTo'>;

/**
 * 把滚动面板滚回顶部。
 *
 * 目标环境不提供平滑滚动的实现时退回瞬时跳转：用户已经点得很明确，
 * 让按钮静默失效比动画缺失更糟。
 */
export function scrollPaneToTop(pane: ScrollablePane | null, behavior: ScrollBehavior = 'smooth'): void {
  if (!pane) return;
  try {
    pane.scrollTo({ top: 0, behavior });
  } catch {
    // 连瞬时跳转都不可用时只能放弃：这里没有别的回退手段，也不能把异常抛进点击处理里。
    try {
      // 旧签名 scrollTo(x, y)：这里传 (0, 0)，纵轴回到顶部，横轴归零。目录面板不横向滚动，
      // 所以横轴归零无副作用；换成别的容器时不能照抄这一句。
      pane.scrollTo(0, 0);
    } catch {
      /* no-op */
    }
  }
}
