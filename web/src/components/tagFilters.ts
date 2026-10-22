import type { TagGroup } from '../../../ui/tags-api';

export interface TagFilterModel {
  /** 第一行展示的主标签（目录顺序；目录不可用时退回模组聚合值）。 */
  mains: string[];
  /** 主标签 → 子标签，按目录顺序。 */
  children: Record<string, string[]>;
  /** 仍在使用、但已不在目录里的历史标签，追加在主标签之后。 */
  stale: string[];
}

/**
 * 目录是筛选区的第一来源：目录决定顺序与层级；读取失败时退回从已发布模组
 * 聚合出的扁平标签，保证筛选仍然可用。
 */
export function buildTagFilterModel(groups: TagGroup[], usedTags: string[]): TagFilterModel {
  if (groups.length === 0) {
    return { mains: [...usedTags], children: {}, stale: [] };
  }
  const known = new Set<string>();
  const mains: string[] = [];
  const children: Record<string, string[]> = {};
  for (const group of groups) {
    mains.push(group.name);
    known.add(group.name);
    const kids = group.children ?? [];
    if (kids.length > 0) children[group.name] = [...kids];
    for (const child of kids) known.add(child);
  }
  return { mains, children, stale: usedTags.filter((tag) => !known.has(tag)) };
}

/** 当前选中项所属的主标签；选中的是主标签本身时返回它自己。 */
export function activeGroupOf(model: TagFilterModel, selected: string): string | null {
  if (!selected || selected === 'all') return null;
  if (model.mains.includes(selected)) return selected;
  for (const [main, kids] of Object.entries(model.children)) {
    if (kids.includes(selected)) return main;
  }
  return null;
}

/** 子标签行：只有选中了某个带子标签的主标签（或它的子标签）时才展开。 */
export function childTagsFor(model: TagFilterModel, selected: string): string[] {
  const group = activeGroupOf(model, selected);
  if (!group) return [];
  return model.children[group] ?? [];
}
