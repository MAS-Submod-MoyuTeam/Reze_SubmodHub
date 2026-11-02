/**
 * 目录标签筛选的共享状态与判定。
 *
 * Web 与客户端都只保留「一个标签对应一个状态」：未选 → 包含 → 排除 → 未选。
 * 包含之间是 AND（必须同时带齐每一个包含标签），任一带上排除标签就不显示。
 * 之所以两个包含标签是 AND：多选本来就该收窄结果；OR 会让「点了更多反而更多」
 * 与排除的直觉相反。
 *
 * 这里只做纯数据转换，不碰 React，也不认识目录顺序——目录顺序由各端渲染时决定。
 */

/** 一个标签在筛选里的状态。`off` 不作为记录出现，省掉无意义的历史。 */
export type TagFilterState = 'include' | 'exclude';

/** 标签名 → 状态；标签名在目录内全局唯一，所以扁平表没有歧义。 */
export type TagFilterStates = Readonly<Record<string, TagFilterState>>;

export const EMPTY_TAG_FILTER: TagFilterStates = {};

/**
 * 点一次标签后的新状态：
 * - 未选 → 包含；
 * - 包含 → 排除；
 * - 排除 → 未选（键被删掉，而不是留一个 `off`）。
 *
 * 返回新对象，调用方可以直接比较引用判断有没有变化。
 */
export function nextTagFilterState(current: TagFilterState | undefined): TagFilterState | undefined {
  if (current === 'include') return 'exclude';
  if (current === 'exclude') return undefined;
  return 'include';
}

/** 应用一次点击；标签名重复点击会按「包含 → 排除 → 未选」循环。 */
export function toggleTagFilter(states: TagFilterStates, name: string): TagFilterStates {
  const next = nextTagFilterState(states[name]);
  if (next === undefined) {
    if (!(name in states)) return states;
    const copy = { ...states };
    delete copy[name];
    return copy;
  }
  return { ...states, [name]: next };
}

/** 清空全部标签筛选；本来就是空的时候返回原引用，避免无意义的重渲染。 */
export function clearTagFilter(states: TagFilterStates): TagFilterStates {
  return Object.keys(states).length === 0 ? states : EMPTY_TAG_FILTER;
}

export function includedTags(states: TagFilterStates): string[] {
  return Object.keys(states).filter((name) => states[name] === 'include');
}

export function excludedTags(states: TagFilterStates): string[] {
  return Object.keys(states).filter((name) => states[name] === 'exclude');
}

/** 正在生效的标签总数（排除空的 tab 状态）。 */
export function activeTagFilterCount(states: TagFilterStates): number {
  return Object.keys(states).length;
}

/**
 * 一个模组的标签是否通过筛选：
 * - 每个包含标签都必须在（AND）；
 * - 任一排除标签在，就不通过。
 */
export function matchesTagFilter(tags: readonly string[], states: TagFilterStates): boolean {
  const present = new Set(tags);
  for (const name of Object.keys(states)) {
    const state = states[name];
    if (state === 'include' && !present.has(name)) return false;
    if (state === 'exclude' && present.has(name)) return false;
  }
  return true;
}

/**
 * 筛选说明：`包含 #A #B · 排除 #C`。
 * 有筛选时各端用它做可访问名与错误空状态的说明；没有筛选时返回空串。
 */
export function describeTagFilter(states: TagFilterStates): string {
  const parts: string[] = [];
  const include = includedTags(states);
  const exclude = excludedTags(states);
  if (include.length > 0) parts.push(`包含 ${include.map((name) => `#${name}`).join(' ')}`);
  if (exclude.length > 0) parts.push(`排除 ${exclude.map((name) => `#${name}`).join(' ')}`);
  return parts.join(' · ');
}

/**
 * 折叠目录后得到抽屉里要渲染的条目。
 *
 * 目录仍是第一来源（顺序与层级），但它之外还有两类名称必须能被选：
 * 模组上还在用、目录里已经删掉的历史标签。把这些名称追加在目录之后，
 * 否则用户会看到「模组带着 #某标签，抽屉里却没有它」。
 */

/** 一个可被选中、并可能带一句说明的标签。 */
export interface TagFilterEntry {
  name: string;
  /** 管理员写的描述；没有就是空串，调用方不该渲染空行。 */
  description: string;
}

export interface TagFilterRow {
  /** 主标签；没有目录时的历史标签也作为独立条目出现。 */
  main: TagFilterEntry;
  /** 子标签（按目录顺序）；历史标签没有子标签。 */
  children: TagFilterEntry[];
  /** 该条目是否已不在目录里（只影响样式与提示，不影响可选）。 */
  stale: boolean;
}

export function buildTagFilterRows(
  groups: readonly {
    name: string;
    description?: string;
    children?: readonly { name: string; description?: string }[];
  }[],
  usedTags: readonly string[],
): TagFilterRow[] {
  const rows: TagFilterRow[] = groups.map((group) => ({
    main: { name: group.name, description: group.description ?? '' },
    children: (group.children ?? []).map((child) => ({
      name: child.name,
      description: child.description ?? '',
    })),
    stale: false,
  }));
  const known = new Set<string>();
  for (const group of groups) {
    known.add(group.name);
    for (const child of group.children ?? []) known.add(child.name);
  }
  const seen = new Set<string>();
  for (const tag of usedTags) {
    if (known.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    rows.push({ main: { name: tag, description: '' }, children: [], stale: true });
  }
  return rows;
}

/**
 * 折叠状态：主标签名 → 是否展开。
 *
 * 默认折叠——一个主标签下最多 6 个子标签，全展开会把抽屉撑成一长条，
 * 用户找标签反而要滚更久。没有子标签的主标签不参与（也就没有折叠按钮）。
 */
export type TagGroupCollapse = Readonly<Record<string, boolean>>;

export function hasChildTags(row: TagFilterRow): boolean {
  return row.children.length > 0;
}

export function isTagRowExpanded(collapse: TagGroupCollapse, row: TagFilterRow): boolean {
  // 没有子标签时「展开」没有意义，恒为收起（调用方据此隐藏折叠按钮）。
  return hasChildTags(row) && collapse[row.main.name] === true;
}

export function toggleTagRowExpanded(collapse: TagGroupCollapse, main: string): TagGroupCollapse {
  return { ...collapse, [main]: collapse[main] !== true };
}

/**
 * 某一组里已经生效的标签数：折叠时用它提示「这一组里有筛选」，
 * 免得用户以为筛选没生效。
 */
export function rowActiveCount(row: TagFilterRow, states: TagFilterStates): number {
  let count = 0;
  if (states[row.main.name] !== undefined) count += 1;
  for (const child of row.children) if (states[child.name] !== undefined) count += 1;
  return count;
}
