/**
 * 分段控件的选中态只有两条口径，别再各写一份。
 *
 * 以前「内容与版本来源 / 发行平台 / 版本发现方式」和作者工作台的视图切换都是
 * 「白底叠浅灰底 + shadow-xs」，选中项与未选中项几乎同色，作者看不出点没点中。
 * 现在统一成：
 * - 选一个值（来源、平台、语言、分发方式、上传形态）→ 选中项实心主色；
 * - 切一个视图（Tab）→ 选中项白底浮起，靠 inset 描边 + 阴影与浅灰底分开，
 *   不抢主色（导航本来就不是主操作）。
 *
 * `...SegmentClass` 只拼「盒子 + 状态」，调用方按需传入自己的 padding 与字号。
 */

const VALUE_SELECTED = 'bg-emerald-700 text-white shadow-xs';
const VALUE_IDLE = 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100';
const TAB_SELECTED = 'bg-white text-neutral-900 shadow-sm ring-1 ring-inset ring-neutral-300';
const TAB_IDLE = 'text-neutral-600 hover:text-neutral-900 hover:bg-white/60';

/** 选值类分段项的选中态。 */
export const valueStateClass = (selected: boolean): string => (selected ? VALUE_SELECTED : VALUE_IDLE);

/** 视图切换 Tab 的选中态。 */
export const tabStateClass = (selected: boolean): string => (selected ? TAB_SELECTED : TAB_IDLE);

/** 选值类分段项：默认盒子就是表单里那种整行按钮。 */
export const valueSegmentClass = (
  selected: boolean,
  box = 'py-1.5 text-xs font-medium rounded',
): string => `${box} transition-colors ${valueStateClass(selected)}`;

/** 视图切换 Tab：默认盒子是工作台/审核台顶部那种胶囊按钮。 */
export const tabSegmentClass = (
  selected: boolean,
  box = 'px-3 py-1.5 rounded',
): string => `${box} transition-colors ${tabStateClass(selected)}`;
