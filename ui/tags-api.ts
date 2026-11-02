/**
 * 站点标签目录的读取与形状。
 *
 * 目录是标签的唯一来源：作者只能从里面多选，用户筛选也按同一份顺序与层级渲染。
 * 每个标签都带一句描述——管理员写一次，作者选择器与目录筛选读到的是同一句，
 * 这样「杂项」这种名字才不会只剩名字可判断。
 */

/** 子标签：与主标签一样是「名称 + 描述」，不是裸字符串。 */
export interface TagChild {
  name: string;
  description?: string;
}

/** 主标签与它的子标签。目录里名称全局唯一，因此模组可以只存扁平名称。 */
export interface TagGroup {
  name: string;
  description?: string;
  children?: TagChild[];
}

export interface TagCatalog {
  groups: TagGroup[];
  /** settings revision，客户端据此判断管理员是否改过目录。 */
  revision: number;
}

/** 描述上限，与服务端 maxTagDescriptionRunes 一致。 */
export const MAX_TAG_DESCRIPTION_LENGTH = 60;

async function readJSON(response: Response): Promise<unknown> {
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { code?: string } | null;
    throw new Error(error?.code || `http_${response.status}`);
  }
  return response.json();
}

/** 描述是可选的：老目录没有这个字段，缺省当作空串而不是错误。 */
function normalizeDescription(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw new Error('invalid_tag_catalog_response');
  return raw.trim();
}

function normalizeChildren(raw: unknown): TagChild[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) throw new Error('invalid_tag_catalog_response');
  return raw.map((entry) => {
    // 目录曾经把子标签存成裸字符串；读到这种形状时按「只有名称」处理，
    // 免得一次目录迁移就让作者端与筛选一起报错。
    if (typeof entry === 'string') return { name: entry };
    const child = entry as { name?: unknown; description?: unknown };
    if (typeof child?.name !== 'string' || child.name.trim() === '') {
      throw new Error('invalid_tag_catalog_response');
    }
    const normalized: TagChild = { name: child.name };
    const description = normalizeDescription(child.description);
    if (description) normalized.description = description;
    return normalized;
  });
}

function normalizeGroups(raw: unknown): TagGroup[] {
  if (!Array.isArray(raw)) throw new Error('invalid_tag_catalog_response');
  return raw.map((entry) => {
    const group = entry as { name?: unknown; description?: unknown; children?: unknown };
    if (typeof group?.name !== 'string' || group.name.trim() === '') {
      throw new Error('invalid_tag_catalog_response');
    }
    const normalized: TagGroup = { name: group.name };
    const description = normalizeDescription(group.description);
    if (description) normalized.description = description;
    const children = normalizeChildren(group.children);
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
export function tagDescriptions(groups: readonly TagGroup[]): Map<string, string> {
  const descriptions = new Map<string, string>();
  for (const group of groups) {
    if (group.description) descriptions.set(group.name, group.description);
    for (const child of group.children ?? []) {
      if (child.description) descriptions.set(child.name, child.description);
    }
  }
  return descriptions;
}

/** 子标签名称列表，扁平存储与校验用。 */
export function tagChildNames(group: TagGroup): string[] {
  return (group.children ?? []).map((child) => child.name);
}
