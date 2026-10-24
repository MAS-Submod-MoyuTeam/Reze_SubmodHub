/**
 * 目录续页与页脚的纯状态计算。
 *
 * 客户端目录一次性拿到全部条目，续页只是把已拿到的结果逐页渲染出来，
 * 因此页脚只能报「已渲染 xx / 共 yy」，不能声称「正在加载」——磁盘和网络都没有在等的东西。
 */

/**
 * 已渲染条数。
 *
 * @param page 当前页数（每次续页 +1）
 * @param pageSize 每页条数
 * @param filteredCount 过滤后的总条数
 */
export function visibleSubmodCount(page: number, pageSize: number, filteredCount: number): number {
  if (filteredCount <= 0) return 0;
  return Math.min(Math.max(page, 1) * pageSize, filteredCount);
}

/** 是否还有未渲染的子模组。 */
export function hasMoreSubmods(visibleCount: number, filteredCount: number): boolean {
  return visibleCount < filteredCount;
}

/**
 * 收敛页数到命中总数能覆盖的范围。
 *
 * 页数只许往下收敛、不许往上补齐：筛选放宽后凭空恢复旧页数，等于把用户从没滚动加载过的
 * 条目一次塞回首屏。上限也要夹住，否则下一页一旦让结果变多，多出来的页会被悄悄全部渲染。
 *
 * @param page 当前页数
 * @param pageSize 每页条数
 * @param filteredCount 过滤后的总条数
 */
export function clampLoadedPage(page: number, pageSize: number, filteredCount: number): number {
  if (filteredCount <= 0) return 1;
  return Math.min(Math.max(page, 1), Math.max(1, Math.ceil(filteredCount / pageSize)));
}

/**
 * 页脚文案。
 *
 * 没有可续的内容时只报总数；仍有未渲染条目时补一句操作提示，让用户知道剩下的是滚动出来的，
 * 而不是加载失败或过滤掉了。
 */
export function loadFooterLabel(visibleCount: number, filteredCount: number, unit: string): string {
  const total = `共 ${filteredCount} 个${unit}`;
  if (!hasMoreSubmods(visibleCount, filteredCount)) return total;
  return `已渲染 ${visibleCount} / ${total}，滚动查看更多`;
}

/** 目录里的「子模组」含功能模组与外观礼包；统一用一个量词，避免同一条页脚混用两种单位。 */
export const submodUnit = '子模组';
