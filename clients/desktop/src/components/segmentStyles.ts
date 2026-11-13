/**
 * 深色主题下分段控件的选中态口径。
 *
 * 之前选中项写成 `bg-neutral-800`，直接铺在 `bg-neutral-900` 的分段条上：两块深灰
 * 只差一级，扫一眼分不出哪一项是当前值（目录分类、已安装子页签都踩过）。现在选中项
 * 补一圈 inset 描边，把「浮起来」这件事画出来，不靠文字灰度去猜。
 *
 * 浅色 Web 端对应口径见 `web/src/components/selectionStyles.ts`，两边语义一致：
 * 选中态必须改变底色或描边，不能只改文字颜色。
 */

const DARK_SELECTED = 'bg-neutral-800 text-white shadow-xs ring-1 ring-inset ring-neutral-600';
const DARK_IDLE = 'text-neutral-400 hover:text-neutral-200';

/** 分段控件的选中态（深色主题）。 */
export const darkSegmentState = (selected: boolean): string => (selected ? DARK_SELECTED : DARK_IDLE);

/** 分段控件：默认盒子是目录/已安装顶部那种胶囊按钮。 */
export const darkSegmentClass = (
  selected: boolean,
  box = 'px-3 py-1 font-medium rounded-md',
): string => `${box} transition-colors ${darkSegmentState(selected)}`;
