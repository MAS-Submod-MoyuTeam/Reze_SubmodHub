/** 主标签与它的子标签。目录里名称全局唯一，因此模组可以只存扁平名称。 */
export interface TagGroup {
  name: string;
  children?: string[];
}

export interface TagCatalog {
  groups: TagGroup[];
  /** settings revision，客户端据此判断管理员是否改过目录。 */
  revision: number;
}

async function readJSON(response: Response): Promise<unknown> {
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { code?: string } | null;
    throw new Error(error?.code || `http_${response.status}`);
  }
  return response.json();
}

function normalizeGroups(raw: unknown): TagGroup[] {
  if (!Array.isArray(raw)) throw new Error('invalid_tag_catalog_response');
  return raw.map((entry) => {
    const group = entry as { name?: unknown; children?: unknown };
    if (typeof group?.name !== 'string' || group.name.trim() === '') {
      throw new Error('invalid_tag_catalog_response');
    }
    const children = group.children;
    if (children !== undefined && (!Array.isArray(children) || children.some((child) => typeof child !== 'string'))) {
      throw new Error('invalid_tag_catalog_response');
    }
    const normalized: TagGroup = { name: group.name };
    if (Array.isArray(children)) normalized.children = children as string[];
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
