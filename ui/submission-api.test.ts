import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listAuthorWorkspace, clearVersionDeprecation, updateAuthorMod, createAuthorMod, reorderModImages, uploadModImages } from './submission-api';

test('loads the authenticated author workspace', async () => {
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), '/api/v1/author/mods');
    assert.equal(init?.credentials, 'same-origin');
    return new Response(JSON.stringify({ items: [{ mod: { id: 'mine' }, versions: [{ id: 'draft', state: 'draft' }] }] }), { status: 200 });
  }) as typeof fetch;
  const result = await listAuthorWorkspace('/api/v1', fetcher);
  assert.equal(result[0].versions[0].id, 'draft');
});

test('clears a version deprecation with the authenticated endpoint', async () => {
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), '/api/v1/versions/ver_1/deprecate');
    assert.equal(init?.method, 'DELETE');
    assert.equal(init?.credentials, 'same-origin');
    return new Response(JSON.stringify({ id: 'ver_1', deprecated: false, deprecation_reason: '' }), { status: 200 });
  }) as typeof fetch;
  const result = await clearVersionDeprecation('/api/v1', 'ver_1', fetcher);
  assert.equal(result.deprecated, false);
});

test('updates mod metadata through the authenticated author endpoint', async () => {
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), '/api/v1/author/mods/mod_1');
    assert.equal(init?.method, 'PATCH');
    assert.equal(init?.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(String(init?.body)), { title: 'Updated', summary: 'Short', description: '## Details', category: 'submod', tags: ['dialogue'], supported_platforms: ['windows'], mas_version_range: '>=0.12.14', recommended_priority: 20 });
    return new Response(JSON.stringify({ id: 'mod_1', title: 'Updated', summary: 'Short', description: '## Details', category: 'submod', author: { id: 'u1', display_name: 'Author' } }), { status: 200 });
  }) as typeof fetch;
  const result = await updateAuthorMod('/api/v1', 'mod_1', { title: 'Updated', summary: 'Short', description: '## Details', category: 'submod', tags: ['dialogue'], supported_platforms: ['windows'], mas_version_range: '>=0.12.14', recommended_priority: 20 }, fetcher);
  assert.equal(result.description, '## Details');
});

test('persists the author-selected detail image order', async () => {
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), '/api/v1/author/mods/mod_1/images');
    assert.equal(init?.method, 'PATCH');
    assert.equal(init?.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(String(init?.body)), { filenames: ['02.jpg', '00.png', '01.webp'] });
    return new Response(JSON.stringify({ mod_id: 'mod_1', count: 3 }), { status: 200 });
  }) as typeof fetch;
  const result = await reorderModImages('/api/v1', 'mod_1', ['02.jpg', '00.png', '01.webp'], fetcher);
  assert.equal(result.count, 3);
});

test('appends detail images without replacing existing images', async () => {
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), '/api/v1/author/mods/mod_1/images?append=true');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'same-origin');
    assert.ok(init?.body instanceof FormData);
    return new Response(JSON.stringify({ mod_id: 'mod_1', count: 2, items: [{ url: '/api/v1/images/mod_1/old.png' }, { url: '/api/v1/images/mod_1/new.png' }] }), { status: 200 });
  }) as typeof fetch;
  const result = await uploadModImages('/api/v1', 'mod_1', [new File(['new'], 'new.png')], true, fetcher);
  assert.equal(result.count, 2);
  assert.equal(result.items?.[1].url, '/api/v1/images/mod_1/new.png');
});

test('creates a mod with github source configuration', async () => {
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), '/api/v1/author/mods');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'same-origin');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.source_type, 'github_releases');
    assert.equal(body.github_owner, 'octocat');
    assert.equal(body.github_repo, 'hello-world');
    assert.equal(body.github_asset_regex, '^MyMod.*\\.zip$');
    assert.equal(body.github_source_code, true);
    return new Response(JSON.stringify({
      id: 'mod_gh',
      title: 'GH Mod',
      summary: 'Summary',
      category: 'submod',
      author: { id: 'u1', display_name: 'Author' },
      source_type: 'github_releases',
      github_owner: 'octocat',
      github_repo: 'hello-world',
      github_asset_regex: '^MyMod.*\\.zip$',
      github_source_code: true,
    }), { status: 201 });
  }) as typeof fetch;
  const result = await createAuthorMod('/api/v1', {
    title: 'GH Mod',
    summary: 'Summary',
    category: 'submod',
    source_type: 'github_releases',
    github_owner: 'octocat',
    github_repo: 'hello-world',
    github_asset_regex: '^MyMod.*\\.zip$',
    github_source_code: true,
  }, fetcher);
  assert.equal(result.source_type, 'github_releases');
  assert.equal(result.github_owner, 'octocat');
  assert.equal(result.github_repo, 'hello-world');
});
