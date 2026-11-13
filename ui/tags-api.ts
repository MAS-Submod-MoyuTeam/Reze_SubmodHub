/**
 * 站点标签目录的读取与形状。
 *
 * 目录是标签的唯一来源：作者只能从里面多选，用户筛选也按同一份顺序与层级渲染。
 * 每个标签都带一句描述——管理员写一次，作者选择器与目录筛选读到的是同一句，
 * 这样「杂项」这种名字才不会只剩名字可判断。
 *
 * 名称与描述都可以有多种语言：
 * - `name` 是**存储键**，全目录唯一，模组只保存它，筛选与校验也只认它。
 * - `displayName` 是给某一种语言的读者看的名字；缺译文时回退到 `name`。
 * - `description` 同样按语言存放，回退链见 ui/localized-text.ts。
 */

import { localizedTextOf, primarySubtag, type LocalizedText } from './localized-text';

/** 子标签：与主标签一样是「名称 + 描述」，不是裸字符串。 */
export interface TagChild {
  name: string;
  displayName?: LocalizedText;
  description?: LocalizedText;
}

/** 主标签与它的子标签。目录里名称全局唯一，因此模组可以只存扁平名称。 */
export interface TagGroup {
  name: string;
  displayName?: LocalizedText;
  description?: LocalizedText;
  children?: TagChild[];
}

export interface TagCatalog {
  groups: TagGroup[];
  /** settings revision，客户端据此判断管理员是否改过目录。 */
  revision: number;
}

/** 描述上限（按每种语言分别计算），与服务端 maxTagDescriptionRunes 一致。 */
export const MAX_TAG_DESCRIPTION_LENGTH = 60;
/** 显示名上限，与服务端 maxTagNameRunes 同一预算。 */
export const MAX_TAG_NAME_LENGTH = 24;

async function readJSON(response: Response): Promise<unknown> {
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { code?: string } | null;
    throw new Error(error?.code || `http_${response.status}`);
  }
  return response.json();
}

function normalizeName(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') throw new Error('invalid_tag_catalog_response');
  return raw.trim();
}

/** 名称与描述现在都是多语言对象；只发单条字符串的旧形状按中文接收。 */
function normalizeText(raw: unknown): LocalizedText | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string' && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new Error('invalid_tag_catalog_response');
  }
  const text = localizedTextOf(raw);
  return Object.keys(text).length > 0 ? text : undefined;
}

function normalizeChildren(raw: unknown): TagChild[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error('invalid_tag_catalog_response');
  return raw.map((entry) => {
    // 目录曾经把子标签存成裸字符串；读到这种形状时按「只有名称」处理，
    // 免得一次目录迁移就让作者端与筛选一起报错。
    if (typeof entry === 'string') return { name: entry };
    const child = entry as { name?: unknown; display_name?: unknown; description?: unknown };
    const normalized: TagChild = { name: normalizeName(child?.name) };
    const displayName = normalizeText(child.display_name);
    if (displayName) normalized.displayName = displayName;
    const description = normalizeText(child?.description);
    if (description) normalized.description = description;
    return normalized;
  });
}

function normalizeGroups(raw: unknown): TagGroup[] {
  if (!Array.isArray(raw)) throw new Error('invalid_tag_catalog_response');
  return raw.map((entry) => {
    const group = entry as { name?: unknown; display_name?: unknown; description?: unknown; children?: unknown };
    const normalized: TagGroup = { name: normalizeName(group?.name) };
    const displayName = normalizeText(group.display_name);
    if (displayName) normalized.displayName = displayName;
    const description = normalizeText(group?.description);
    if (description) normalized.description = description;
    const children = normalizeChildren(group?.children);
    if (children) normalized.children = children;
    return normalized;
  });
}

/**
 * 读取站点标签目录。作者端选择器与目录筛选共用这一份权威数据，
 * 不在前端硬编码任何标签名称。
 */
export async function fetchTagCatalog(base = '/api/v1', fetcher: typeof fetch = fetch): Promise<TagCatalog> {
  const url = `${base.replace(/\/$/, '')}/tags`;
  const payload = (await readJSON(await fetcher(url, { headers: { Accept: 'application/json' } }))) as {
    groups?: unknown;
    revision?: unknown;
  };
  const revision = typeof payload?.revision === 'number' ? payload.revision : 0;
  return { groups: normalizeGroups(payload?.groups), revision };
}

/** 目录里的全部名称（主标签在前、子标签随后），用于判断某个名称是否还存在。 */
export function tagCatalogNames(groups: readonly TagGroup[]): Set<string> {
  const names = new Set<string>();
  for (const group of groups) {
    names.add(group.name);
    for (const child of group.children ?? []) names.add(child.name);
  }
  return names;
}

/**
 * 名称 → 描述。主标签与子标签名称在目录内全局唯一，所以一张扁平表就够，
 * 调用方不必先判断某个名称属于哪一层。
 */
export function tagDescriptions(groups: readonly TagGroup[]): Map<string, LocalizedText> {
  const descriptions = new Map<string, LocalizedText>();
  for (const group of groups) {
    if (group.description) descriptions.set(group.name, group.description);
    for (const child of group.children ?? []) {
      if (child.description) descriptions.set(child.name, child.description);
    }
  }
  return descriptions;
}

/** 名称 → 显示名（多语言）。没有 display_name 的标签不在表里。 */
export function tagDisplayNames(groups: readonly TagGroup[]): Map<string, LocalizedText> {
  const displayNames = new Map<string, LocalizedText>();
  for (const group of groups) {
    if (group.displayName) displayNames.set(group.name, group.displayName);
    for (const child of group.children ?? []) {
      if (child.displayName) displayNames.set(child.name, child.displayName);
    }
  }
  return displayNames;
}

/**
 * 一个标签该显示成什么名字。
 *
 * 显示名是可选译文，请求语言没有译文时回落到存储名——存储名同时也是中文名，
 * 所以中文读者永远看得到名字，英文读者只有在管理员补了英文名时才看到英文。
 */
export function resolveTagName(name: string, displayNames: ReadonlyMap<string, LocalizedText>, lang: string): string {
  const localized = displayNames.get(name);
  if (!localized) return name;
  // 这里只认「请求语言自己的译文」，不走通用回退链：只有英文名的标签，中文
  // 读者应该看到中文存储名「音乐」，而不是被回退链换成英文的 Music。
  const primary = primarySubtag(lang);
  const exact = primary ? localized[primary] : undefined;
  return exact || name;
}

/** 子标签名称列表，扁平存储与校验用。 */
export function tagChildNames(group: TagGroup): string[] {
  return (group.children ?? []).map((child) => child.name);
}
