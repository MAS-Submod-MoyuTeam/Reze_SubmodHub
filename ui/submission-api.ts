import type { ServerScanReport } from '../web/src/context/scanReport';

export interface ApiMod { id: string; title: string; summary: string; description?: string; category: 'submod' | 'spritepack'; author: { id: string; display_name: string }; tags?: string[]; supported_platforms?: string[]; mas_version_range?: string; recommended_priority?: number; latest_version_id?: string; created_at?: string; unpublished?: boolean; source_type?: 'local' | 'github_releases'; github_owner?: string; github_repo?: string; github_asset_regex?: string; github_source_code?: boolean; github_manifest?: boolean; github_manifest_digest?: string; github_last_sync_at?: string; github_last_sync_error?: string; github_last_release_id?: number; github_backoff_until?: string }
export interface ApiVersion { id: string; mod_id: string; version: string; state: string; release_notes: string; size_bytes: number; sha256: string; dependencies: unknown[]; created_at?: string; scan_report_id?: string; deprecated?: boolean; deprecation_reason?: string; image_paths?: string[] }
export interface ApiSubmission { id: string; mod_id: string; version_id: string; author_id: string; state: string; mark_latest?: boolean; reason?: string; reviewer_id?: string; created_at?: string; decided_at?: string; published_at?: string; version_snapshot?: ApiVersion; scan_report_snapshot?: ServerScanReport }
export interface ApiPage<T> { items: T[]; total: number; page: number; page_size: number }
// Author mod windows are keyset based: `cursor` reproduces the returned window
// (null on the first one), `next_cursor`/`prev_cursor` step one window at a time.
// `start` is the 0-based index of the first row and is for display only.
export interface ApiCursorPage<T> { items: T[]; total: number; page_size: number; start: number; cursor: string | null; next_cursor: string | null; prev_cursor: string | null }
export interface ReviewPageQuery { page: number; pageSize: number; state?: string }
export interface AuthorModQuery { pageSize: number; cursor?: string; focusModId?: string }
export interface ApiReviewSubmission { id: string; mod_id: string; version_id: string; author_id: string; state: string; created_at: string; mod_title: string; author_name: string; version_str: string; category: 'submod' | 'spritepack' }
export interface ApiReviewDetail { submission: ApiSubmission; mod: ApiMod; version: ApiVersion; scan_report?: ServerScanReport }
export interface ApiReviewAudit { id: string; timestamp: string; actor_id: string; actor_name: string; actor_role: string; action: string; target_type: string; target_id: string; target_label: string; reason: string; details?: Record<string, unknown> }

async function json<T>(response: Response): Promise<T> { if (!response.ok) { const body = await response.json().catch(() => null) as { code?: string } | null; throw new Error(body?.code || `http_${response.status}`); } return response.json() as Promise<T>; }
function endpoint(base: string, path: string) { return `${base.replace(/\/$/, '')}${path}`; }
export interface AuthorModInput { title: string; summary: string; description?: string; author_display_name?: string; category: 'submod' | 'spritepack'; tags?: string[]; supported_platforms?: string[]; mas_version_range?: string; recommended_priority?: number; source_type?: 'local' | 'github_releases'; github_owner?: string; github_repo?: string; github_asset_regex?: string; github_source_code?: boolean; github_manifest?: boolean }
export async function createAuthorMod(base: string, input: AuthorModInput, fetcher: typeof fetch = fetch): Promise<ApiMod> { return json(await fetcher(endpoint(base, '/author/mods'), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })); }
export async function updateAuthorMod(base: string, id: string, input: AuthorModInput, fetcher: typeof fetch = fetch): Promise<ApiMod> { return json(await fetcher(endpoint(base, `/author/mods/${encodeURIComponent(id)}`), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })); }
export interface ApiAuthorModItem { mod: ApiMod; is_published: boolean; has_published_version: boolean; has_archived_version: boolean; has_pending_review: boolean; candidate_version_id?: string }
export interface ApiAuthorSubmission extends ApiSubmission { mod_title: string; author_name: string; version_str: string; category: 'submod' | 'spritepack'; current_version?: ApiVersion }
export async function listAuthorWorkspace(base: string, query: AuthorModQuery, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<ApiCursorPage<ApiAuthorModItem>> {
  const params = new URLSearchParams({ page_size: String(query.pageSize) });
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.focusModId) params.set('focus_mod_id', query.focusModId);
  return json(await fetcher(endpoint(base, `/author/mods?${params}`), { credentials: 'same-origin', signal }));
}
export async function listAuthorVersions(base: string, modId: string, query: ReviewPageQuery, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<ApiPage<ApiVersion> & { scan_reports: Record<string, ServerScanReport> }> {
  const params = new URLSearchParams({ page: String(query.page), page_size: String(query.pageSize) });
  return json(await fetcher(endpoint(base, `/author/mods/${encodeURIComponent(modId)}/versions?${params}`), { credentials: 'same-origin', signal }));
}
export async function createAuthorVersion(base: string, modID: string, version: string, releaseNotes: string, dependencies: unknown[] = [], fetcher: typeof fetch = fetch): Promise<ApiVersion> { return json(await fetcher(endpoint(base, `/author/mods/${encodeURIComponent(modID)}/versions`), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, release_notes: releaseNotes, dependencies }) })); }
export async function submitAuthorVersion(base: string, versionID: string, markLatest = true, fetcher: typeof fetch = fetch): Promise<ApiSubmission> { return json(await fetcher(endpoint(base, `/author/versions/${encodeURIComponent(versionID)}/submit`), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mark_latest: markLatest }) })); }
export async function markPublishedVersionLatest(base: string, versionID: string, fetcher: typeof fetch = fetch): Promise<ApiMod> { return json(await fetcher(endpoint(base, `/versions/${encodeURIComponent(versionID)}/mark-latest`), { method: 'POST', credentials: 'same-origin' })); }
export async function uploadAuthorArchive(base: string, versionID: string, file: File | Blob, filename = 'archive.zip', fetcher: typeof fetch = fetch): Promise<{ version_id: string; version: string; state: string; size_bytes: number; sha256: string; dependencies?: unknown[]; scan_report?: ServerScanReport }> { const body = new FormData(); body.append('archive', file, filename); return json(await fetcher(endpoint(base, `/author/versions/${encodeURIComponent(versionID)}/archive`), { method: 'POST', credentials: 'same-origin', body })); }
export async function uploadModImages(base: string, modID: string, files: File[], append = false, fetcher: typeof fetch = fetch): Promise<{ mod_id: string; count: number; items?: Array<{ url: string }> }> { const body = new FormData(); files.forEach((file) => body.append('images', file, file.name)); const suffix = append ? '?append=true' : ''; return json(await fetcher(endpoint(base, `/author/mods/${encodeURIComponent(modID)}/images${suffix}`), { method: 'POST', credentials: 'same-origin', body })); }
export async function unpublishAuthorMod(base: string, modID: string, fetcher: typeof fetch = fetch): Promise<ApiMod> { return json(await fetcher(endpoint(base, `/author/mods/${encodeURIComponent(modID)}/unpublish`), { method: 'POST', credentials: 'same-origin' })); }
export async function deleteAuthorMod(base: string, modID: string, fetcher: typeof fetch = fetch): Promise<void> { const response = await fetcher(endpoint(base, `/author/mods/${encodeURIComponent(modID)}`), { method: 'DELETE', credentials: 'same-origin' }); if (!response.ok) { const body = await response.json().catch(() => null) as { code?: string } | null; throw new Error(body?.code || `http_${response.status}`); } }
export async function fetchModImages(base: string, modID: string, fetcher: typeof fetch = fetch): Promise<Array<{ url: string }>> { const result = await json<{ items?: Array<{ url?: string }> }>(await fetcher(endpoint(base, `/mods/${encodeURIComponent(modID)}/images`), { credentials: 'same-origin' })); return (result.items || []).filter((item): item is { url: string } => typeof item.url === 'string' && item.url.length > 0); }
export async function clearModImages(base: string, modID: string, fetcher: typeof fetch = fetch): Promise<void> { const response = await fetcher(endpoint(base, `/author/mods/${encodeURIComponent(modID)}/images`), { method: 'DELETE', credentials: 'same-origin' }); if (!response.ok) { const body = await response.json().catch(() => null) as { code?: string } | null; throw new Error(body?.code || `http_${response.status}`); } }
export async function reorderModImages(base: string, modID: string, filenames: string[], fetcher: typeof fetch = fetch): Promise<{ mod_id: string; count: number }> { return json(await fetcher(endpoint(base, `/author/mods/${encodeURIComponent(modID)}/images`), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filenames }) })); }
export async function listReviewSubmissions(base: string, query: ReviewPageQuery, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<ApiPage<ApiReviewSubmission> & { pending_count: number }> {
  const params = new URLSearchParams({ page: String(query.page), page_size: String(query.pageSize) });
  if (query.state && query.state !== 'all') params.set('state', query.state);
  return json(await fetcher(endpoint(base, `/review/submissions?${params}`), { credentials: 'same-origin', signal }));
}
export async function listAuthorSubmissions(base: string, query: ReviewPageQuery, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<ApiPage<ApiAuthorSubmission>> {
  const params = new URLSearchParams({ page: String(query.page), page_size: String(query.pageSize) });
  if (query.state && query.state !== 'all') params.set('state', query.state);
  return json(await fetcher(endpoint(base, `/author/submissions?${params}`), { credentials: 'same-origin', signal }));
}
export async function listReviewAudit(base: string, query: ReviewPageQuery, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<ApiPage<ApiReviewAudit>> {
  const params = new URLSearchParams({ page: String(query.page), page_size: String(query.pageSize) });
  return json(await fetcher(endpoint(base, `/review/audit?${params}`), { credentials: 'same-origin', signal }));
}
export async function getReviewSubmission(base: string, id: string, fetcher: typeof fetch = fetch): Promise<ApiReviewDetail> { return json(await fetcher(endpoint(base, `/review/submissions/${encodeURIComponent(id)}`), { credentials: 'same-origin' })); }
export async function unpublishVersion(base: string, id: string, reason: string, fetcher: typeof fetch = fetch): Promise<ApiVersion> { return json(await fetcher(endpoint(base, `/versions/${encodeURIComponent(id)}/unpublish`), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) })); }
export async function deleteAuthorVersion(base: string, id: string, fetcher: typeof fetch = fetch): Promise<void> { const response = await fetcher(endpoint(base, `/author/versions/${encodeURIComponent(id)}`), { method: 'DELETE', credentials: 'same-origin' }); if (!response.ok) { const body = await response.json().catch(() => null) as { code?: string } | null; throw new Error(body?.code || `http_${response.status}`); } }
export async function deprecateVersion(base: string, id: string, reason: string, fetcher: typeof fetch = fetch): Promise<ApiVersion> { return json(await fetcher(endpoint(base, `/versions/${encodeURIComponent(id)}/deprecate`), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) })); }
export async function clearVersionDeprecation(base: string, id: string, fetcher: typeof fetch = fetch): Promise<ApiVersion> { return json(await fetcher(endpoint(base, `/versions/${encodeURIComponent(id)}/deprecate`), { method: 'DELETE', credentials: 'same-origin' })); }
export async function editAuthorVersion(base: string, id: string, version: string, releaseNotes: string, dependencies: unknown[] = [], fetcher: typeof fetch = fetch): Promise<ApiVersion> { return json(await fetcher(endpoint(base, `/author/versions/${encodeURIComponent(id)}/edit`), { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, release_notes: releaseNotes, dependencies }) })); }
export async function decideReview(base: string, submissionID: string, decision: 'approve' | 'reject', reason: string, fetcher: typeof fetch = fetch): Promise<ApiSubmission> { return json(await fetcher(endpoint(base, `/review/submissions/${encodeURIComponent(submissionID)}/decision`), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, reason }) })); }
export async function publishReview(base: string, submissionID: string, fetcher: typeof fetch = fetch): Promise<ApiSubmission> { return json(await fetcher(endpoint(base, `/review/submissions/${encodeURIComponent(submissionID)}/publish`), { method: 'POST', credentials: 'same-origin' })); }

export interface AuthorModSourceInput {
  source_type: 'local' | 'github_releases';
  github_owner?: string;
  github_repo?: string;
  github_asset_regex?: string;
  github_source_code?: boolean;
  github_manifest?: boolean;
}

export interface SyncItemResult {
  release_id: number;
  tag: string;
  action: 'created' | 'skipped' | 'failed';
  reason?: string;
  version_id?: string;
  asset_name?: string;
  sha256?: string;
  size_bytes?: number;
}

export interface SyncSummary {
  mod_id: string;
  synced_at: string;
  created: number;
  skipped: number;
  failed: number;
  items: SyncItemResult[];
  last_error?: string;
}

export async function updateAuthorModSource(
  base: string,
  id: string,
  input: AuthorModSourceInput,
  fetcher: typeof fetch = fetch
): Promise<ApiMod> {
  return json(
    await fetcher(endpoint(base, `/author/mods/${encodeURIComponent(id)}/source`), {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  );
}

export async function syncAuthorModGitHub(
  base: string,
  id: string,
  fetcher: typeof fetch = fetch
): Promise<SyncSummary> {
  const url = endpoint(base, `/author/mods/${encodeURIComponent(id)}/github-sync`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetcher(url, { method: 'POST', credentials: 'same-origin' });
    const contentType = response.headers.get('content-type') || '';
    if (response.ok || ![502, 503, 504].includes(response.status) || contentType.includes('json')) {
      return json(response);
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error('github_sync_gateway_unavailable');
}
