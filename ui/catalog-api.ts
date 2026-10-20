import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

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
  downloads_count?: number;
  client_reported_downloads?: number;
  download_attempts?: number;
  latest_version?: string;
  size_bytes?: number;
  sha256?: string;
  detail_images?: string[];
}

export async function fetchModImages(modID: string, base = '/api/v1', fetcher: typeof fetch = fetch): Promise<string[]> {
  const result = await readJSON(await fetcher(`${base.replace(/\/$/, '')}/mods/${encodeURIComponent(modID)}/images`)) as { items?: Array<{ url?: string }> };
  return (result.items || []).flatMap((item) => typeof item.url === 'string' ? [item.url] : []);
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
  dependencies?: Array<{ mod_id: string; mod_title?: string; linked_mod_id?: string; linked_mod_ids?: string[]; version_range: string; required: boolean }>;
  scan_report_id?: string;
  deprecated?: boolean;
  deprecation_reason?: string;
}

export interface CatalogEntry {
  mod: CatalogMod;
  version: CatalogVersion;
}

export interface ArchiveDescriptor {
  delivery_type?: 'builtin' | 'cloudreve' | 'github_relay';
  node_id?: string;
  allowed_download_origins?: string[];
  completion_token?: string;
  url: string;
  expires_at: string;
  sha256: string;
  size_bytes: number;
}

export interface SpriteSet {
  id: string;
  name: string;
  items: Array<{ display_name: string; preview_url?: string }>;
}

export interface SpriteManifestResponse {
  sets: SpriteSet[];
  version_id?: string;
}

export type DownloadProgress = { received: number; total: number; stage: 'connecting' | 'downloading' | 'verifying' };
export type DownloadProgressCallback = (progress: DownloadProgress) => void;

export async function fetchSpriteManifest(
  modID: string,
  base = '/api/v1',
  fetcher: typeof fetch = fetch,
  versionID?: string,
): Promise<SpriteManifestResponse> {
  let path = `${base.replace(/\/$/, '')}/spritepacks/${encodeURIComponent(modID)}`;
  if (versionID) {
    path += `?version_id=${encodeURIComponent(versionID)}`;
  }
  const result = await readJSON(await fetcher(path)) as { sets?: SpriteSet[]; version_id?: string };
  if (!Array.isArray(result.sets) || result.sets.some((set) => !set.id || !Array.isArray(set.items))) throw new Error('invalid_spritepack_response');
  return { sets: result.sets, version_id: result.version_id };
}

export async function fetchSpriteSets(modID: string, base = '/api/v1', fetcher: typeof fetch = fetch): Promise<SpriteSet[]> {
  const manifest = await fetchSpriteManifest(modID, base, fetcher);
  return manifest.sets;
}

export async function fetchVerifiedSpriteSelection(
  modID: string,
  setIDs: string[],
  base = '/api/v1',
  fetcher: typeof fetch = fetch,
  onProgress?: DownloadProgressCallback,
  signal?: AbortSignal,
  versionID?: string,
): Promise<{ blob: Blob; sha256: string; size_bytes: number; version_id?: string }> {
  if (setIDs.length === 0) throw new Error('empty_sprite_selection');
  onProgress?.({ received: 0, total: 0, stage: 'connecting' });
  const serviceURL = new URL(base, typeof window === 'undefined' ? 'http://localhost/' : window.location.href);
  const url = new URL(`${serviceURL.pathname.replace(/\/$/, '')}/spritepacks/${encodeURIComponent(modID)}/download`, serviceURL);
  url.searchParams.set('sets', setIDs.join(','));
  if (versionID) {
    url.searchParams.set('version_id', versionID);
  }
  const response = await fetcher(url.href, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { code?: string } | null;
    throw new Error(body?.code || `http_${response.status}`);
  }
  const responseVersionID = response.headers.get('X-Version-ID') || undefined;
  if (versionID && responseVersionID && responseVersionID !== versionID) {
    throw new Error('sprite_version_changed');
  }
  const expectedHash = response.headers.get('X-Archive-SHA256') || '';
  const expectedSize = Number(response.headers.get('Content-Length'));
  if (!/^[0-9a-f]{64}$/.test(expectedHash) || !Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > 128 * 1024 * 1024 || !response.body) throw new Error('invalid_download_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let lastProgressTime = 0;
  onProgress?.({ received: 0, total: expectedSize, stage: 'downloading' });
  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      throw new Error('download_aborted');
    }
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > expectedSize) { await reader.cancel(); throw new Error('download_size_mismatch'); }
    chunks.push(value);
    const now = Date.now();
    if (now - lastProgressTime >= 50 || size === expectedSize) {
      lastProgressTime = now;
      onProgress?.({ received: size, total: expectedSize, stage: 'downloading' });
    }
  }
  if (size !== expectedSize) throw new Error('download_size_mismatch');
  onProgress?.({ received: size, total: expectedSize, stage: 'verifying' });
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const hash = bytesToHex(sha256(bytes));
  if (hash !== expectedHash) throw new Error('download_hash_mismatch');
  return { blob: new Blob([bytes], { type: 'application/zip' }), sha256: hash, size_bytes: size, version_id: responseVersionID };
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
    const version = await fetchModVersion(mod.id, mod.latest_version_id, base, fetcher);
    return { mod, version };
  }));
}

export async function fetchModVersion(
  modID: string,
  versionID: string,
  base = '/api/v1',
  fetcher: typeof fetch = fetch,
): Promise<CatalogVersion> {
  const root = base.replace(/\/$/, '');
  const path = `${root}/mods/${encodeURIComponent(modID)}/versions/${encodeURIComponent(versionID)}`;
  const version = await readJSON(await fetcher(path)) as CatalogVersion;
  if (!version || version.state !== 'published' || version.id !== versionID || version.mod_id !== modID) {
    throw new Error('invalid_version_response');
  }
  return version;
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

export async function fetchVerifiedArchive(
  versionID: string,
  base = '/api/v1',
  fetcher: typeof fetch = fetch,
  onProgress?: DownloadProgressCallback,
  signal?: AbortSignal,
): Promise<{ blob: Blob; sha256: string; size_bytes: number }> {
  onProgress?.({ received: 0, total: 0, stage: 'connecting' });
  const descriptor = await fetchDownloadDescriptor(versionID, base, fetcher);
  if (descriptor.size_bytes < 1 || descriptor.size_bytes > 128 * 1024 * 1024) throw new Error('download_too_large');
  if (descriptor.url.startsWith('//') || (!descriptor.url.startsWith('/') && !descriptor.url.startsWith('https://'))) {
    throw new Error('invalid_download_response');
  }
  const expiry = Date.parse(descriptor.expires_at);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('download_expired');

  onProgress?.({ received: 0, total: descriptor.size_bytes, stage: 'connecting' });
  const serviceURL = new URL(base, typeof window === 'undefined' ? 'http://localhost/' : window.location.href);
  const archiveURL = new URL(descriptor.url, serviceURL);
  const external = archiveURL.origin !== serviceURL.origin;
  if (archiveURL.username || archiveURL.password || archiveURL.hash) throw new Error('download_origin_forbidden');
  if (external && (archiveURL.protocol !== 'https:' || !descriptor.allowed_download_origins?.includes(archiveURL.origin) || /^(localhost(?:\.|$)|.*\.localhost$|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\[)/i.test(archiveURL.hostname))) throw new Error('download_origin_forbidden');
  const response = await fetcher(archiveURL.href, { signal, credentials: external ? 'omit' : 'same-origin', redirect: 'error', referrerPolicy: 'no-referrer' });
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null) as { code?: string } | null;
    throw new Error(errorBody?.code || `http_${response.status}`);
  }
  if (!response.body) throw new Error('invalid_download_response');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let lastProgressTime = 0;
  onProgress?.({ received: 0, total: descriptor.size_bytes, stage: 'downloading' });
  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      throw new Error('download_aborted');
    }
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > descriptor.size_bytes) {
      await reader.cancel();
      throw new Error('download_size_mismatch');
    }
    chunks.push(value);
    const now = Date.now();
    if (now - lastProgressTime >= 50 || size === descriptor.size_bytes) {
      lastProgressTime = now;
      onProgress?.({ received: size, total: descriptor.size_bytes, stage: 'downloading' });
    }
  }
  if (size !== descriptor.size_bytes) throw new Error('download_size_mismatch');
  onProgress?.({ received: size, total: descriptor.size_bytes, stage: 'verifying' });
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const hash = bytesToHex(sha256(bytes));
  if (hash !== descriptor.sha256) throw new Error('download_hash_mismatch');
  return { blob: new Blob([bytes], { type: 'application/zip' }), sha256: hash, size_bytes: size };
}
