import type { TagGroup } from '../../../ui/tags-api';

/** 与服务端 maxModTags 保持一致：自动补入的主标签也占名额。 */
export const MAX_MOD_TAGS = 8;

/** 子标签 → 主标签。目录内名称全局唯一，所以这张表没有歧义。 */
export function tagParentMap(groups: TagGroup[]): Map<string, string> {
  const parents = new Map<string, string>();
  for (const group of groups) {
    for (const child of group.children ?? []) parents.set(child, group.name);
  }
  return parents;
}

function groupMembers(groups: TagGroup[], parent: string): string[] {
  const group = groups.find((entry) => entry.name === parent);
  if (!group) return [];
  return [group.name, ...(group.children ?? [])];
}

function addWithinCap(selected: string[], additions: string[], max: number): string[] {
  const next = [...selected];
  for (const name of additions) if (!next.includes(name)) next.push(name);
  return next.length > max ? selected : next;
}

/**
 * 点击一个标签后的新选择：
 * - 点子标签：切换该子标签，选中时自动带上主标签，取消时保留主标签本身。
 * - 点主标签：分组内已有任何选择时清空整组（含子标签），否则只选中主标签本身。
 * - 达到上限时新增无效，返回值保持引用不变，调用方可以直接比较。
 * - 目录外的名称永远不会进入选择。
 */
export function toggleTagSelection(groups: TagGroup[], selected: string[], name: string, max = MAX_MOD_TAGS): string[] {
  const parents = new Set(groups.map((group) => group.name));
  const parent = parents.has(name) ? name : tagParentMap(groups).get(name);
  if (!parent) return selected;
  const members = groupMembers(groups, parent);

  if (name === parent) {
    const hasMember = selected.some((tag) => members.includes(tag));
    return hasMember ? selected.filter((tag) => !members.includes(tag)) : addWithinCap(selected, [parent], max);
  }
  if (selected.includes(name)) return selected.filter((tag) => tag !== name);
  return addWithinCap(selected, selected.includes(parent) ? [name] : [parent, name], max);
}

/** 按目录顺序排列（主标签在其子标签之前），并丢弃目录外的名称。 */
export function orderByCatalog(groups: TagGroup[], selected: string[]): string[] {
  const order = new Map<string, number>();
  groups.forEach((group, groupIndex) => {
    order.set(group.name, groupIndex * 100);
    (group.children ?? []).forEach((child, childIndex) => order.set(child, groupIndex * 100 + childIndex + 1));
  });
  return selected
    .filter((name, index) => order.has(name) && selected.indexOf(name) === index)
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/** 每个模组至少一个标签：空选择不能保存。 */
export function isValidTagSelection(selected: string[]): boolean {
  return selected.some((name) => name.trim() !== '');
}

/** 该标签所属分组当前是否已有选择，用于 chip 的高亮状态。 */
export function groupHasSelection(groups: TagGroup[], selected: string[], parent: string): boolean {
  const members = groupMembers(groups, parent);
  return selected.some((tag) => members.includes(tag));
}
