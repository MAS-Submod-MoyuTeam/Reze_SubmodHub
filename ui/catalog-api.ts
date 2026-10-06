export interface CatalogMod {
  id: string;
  title: string;
  summary?: string;
  description?: string;
  author?: { id: string; display_name: string };
  category?: 'submod' | 'spritepack';
  tags?: string[];
  supported_platforms?: Array<'windows' | 'android'>;
  mas_version_range?: string;
  recommended_priority?: number;
  latest_version_id: string;
  latest_version?: string;
  size_bytes?: number;
  sha256?: string;
}

export interface CatalogVersion {
  id: string;
  mod_id: string;
  version: string;
  created_at?: string;
  state: 'published';
  size_bytes: number;
  sha256: string;
  release_notes?: string;
  dependencies?: Array<{ mod_id: string; mod_title?: string; linked_mod_id?: string; version_range: string; required: boolean }>;
  scan_report_id?: string;
  deprecated?: boolean;
  deprecation_reason?: string;
}

export interface CatalogEntry {
  mod: CatalogMod;
  version: CatalogVersion;
}

export interface ArchiveDescriptor {
  url: string;
  expires_at: string;
  sha256: string;
  size_bytes: number;
}

async function readJSON(response: Response): Promise<unknown> {
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { code?: string } | null;
    throw new Error(error?.code || `http_${response.status}`);
  }
  return response.json();
}

export async function fetchPublishedCatalog(base = '/api/v1', fetcher: typeof fetch = fetch): Promise<CatalogEntry[]> {
  const root = base.replace(/\/$/, '');
  const mods: CatalogMod[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const path: string = `${root}/mods${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
    const page = await readJSON(await fetcher(path)) as { items?: CatalogMod[]; next_cursor?: string | null };
    if (!Array.isArray(page?.items) || (page.next_cursor != null && typeof page.next_cursor !== 'string')) {
      throw new Error('invalid_catalog_response');
    }
    mods.push(...page.items);
    cursor = page.next_cursor || null;
    if (cursor) {
      if (seen.has(cursor) || page.items.length === 0) throw new Error('invalid_catalog_response');
      seen.add(cursor);
    }
  } while (cursor);
  return Promise.all(mods.map(async (mod) => {
    if (!mod.id || !mod.latest_version_id) throw new Error('invalid_catalog_response');
    const path = `${root}/mods/${encodeURIComponent(mod.id)}/versions/${encodeURIComponent(mod.latest_version_id)}`;
    const version = await readJSON(await fetcher(path)) as CatalogVersion;
    if (version?.state !== 'published' || version.id !== mod.latest_version_id || version.mod_id !== mod.id) {
      throw new Error('invalid_version_response');
    }
    return { mod, version };
  }));
}

export async function fetchPublishedVersions(modID: string, base = '/api/v1', fetcher: typeof fetch = fetch): Promise<CatalogVersion[]> {
  const result = await readJSON(await fetcher(`${base.replace(/\/$/, '')}/mods/${encodeURIComponent(modID)}/versions`)) as { items?: CatalogVersion[] };
  if (!Array.isArray(result.items)) throw new Error('invalid_versions_response');
  return result.items;
}

export async function fetchDownloadDescriptor(versionID: string, base = '/api/v1', fetcher: typeof fetch = fetch): Promise<ArchiveDescriptor> {
  const root = base.replace(/\/$/, '');
  const path = `${root}/versions/${encodeURIComponent(versionID)}/download`;
  const descriptor = await readJSON(await fetcher(path)) as ArchiveDescriptor;
  if (!descriptor?.url || !/^[0-9a-f]{64}$/.test(descriptor.sha256) || !Number.isSafeInteger(descriptor.size_bytes)) {
    throw new Error('invalid_download_response');
  }
  return descriptor;
}

export async function fetchVerifiedArchive(versionID: string, base = '/api/v1', fetcher: typeof fetch = fetch): Promise<{ blob: Blob; sha256: string; size_bytes: number }> {
  const descriptor = await fetchDownloadDescriptor(versionID, base, fetcher);
  if (descriptor.size_bytes < 1 || descriptor.size_bytes > 64 * 1024 * 1024) throw new Error('download_too_large');
  if (descriptor.url.startsWith('//') || (!descriptor.url.startsWith('/') && !descriptor.url.startsWith('https://'))) {
    throw new Error('invalid_download_response');
  }
  const expiry = Date.parse(descriptor.expires_at);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('download_expired');
  if (!globalThis.crypto?.subtle) throw new Error('crypto_unavailable');
  const serviceURL = new URL(base, typeof window === 'undefined' ? 'http://localhost/' : window.location.href);
  const archiveURL = new URL(descriptor.url, serviceURL);
  const response = await fetcher(archiveURL.href);
  if (!response.ok) throw new Error(`http_${response.status}`);
  if (!response.body) throw new Error('invalid_download_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > descriptor.size_bytes) {
      await reader.cancel();
      throw new Error('download_size_mismatch');
    }
    chunks.push(value);
  }
  if (size !== descriptor.size_bytes) throw new Error('download_size_mismatch');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== descriptor.sha256) throw new Error('download_hash_mismatch');
  return { blob: new Blob([bytes], { type: 'application/zip' }), sha256: hash, size_bytes: size };
}
