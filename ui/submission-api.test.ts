import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listAuthorWorkspace, clearVersionDeprecation, updateAuthorMod, createAuthorMod, reorderModImages, uploadModImages, updateAuthorModSource, syncAuthorModGitHub, unpublishAuthorMod, uploadAuthorArchive } from './submission-api';

test('loads one authenticated author mod window without nested versions', async () => {
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), '/api/v1/author/mods?page_size=10&cursor=next-window');
    assert.equal(init?.credentials, 'same-origin');
    return Response.json({ items: [{ mod: { id: 'mine' }, is_published: false }], total: 11, page_size: 10, start: 10, cursor: 'next-window', next_cursor: null, prev_cursor: 'first-window' });
  }) as typeof fetch;
  const result = await listAuthorWorkspace('/api/v1', { pageSize: 10, cursor: 'next-window' }, undefined, fetcher);
  assert.equal(result.items[0].mod.id, 'mine');
  assert.equal(result.total, 11);
  assert.equal(result.start, 10);
  assert.equal(result.prev_cursor, 'first-window');
});

test('asks the author window endpoint to focus one owned mod', async () => {
  const fetcher = (async (input: RequestInfo | URL) => {
    assert.equal(String(input), '/api/v1/author/mods?page_size=10&focus_mod_id=mod_new');
    return Response.json({ items: [], total: 0, page_size: 10, start: 0, cursor: null, next_cursor: null, prev_cursor: null });
  }) as typeof fetch;
  const result = await listAuthorWorkspace('/api/v1', { pageSize: 10, focusModId: 'mod_new' }, undefined, fetcher);
  assert.equal(result.total, 0);
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

test('passes manifest discovery mode through to the server', async () => {
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), '/api/v1/author/mods');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.github_manifest, true);
    // Manifest mode needs no asset regex.
    assert.equal(body.github_asset_regex, '');
    return new Response(JSON.stringify({
      id: 'mod_manifest',
      title: 'Manifest Mod',
      summary: 'Summary',
      category: 'submod',
      author: { id: 'u1', display_name: 'Author' },
      source_type: 'github_releases',
      github_owner: 'octocat',
      github_repo: 'hello-world',
      github_manifest: true,
    }), { status: 201 });
  }) as typeof fetch;
  const result = await createAuthorMod('/api/v1', {
    title: 'Manifest Mod',
    summary: 'Summary',
    category: 'submod',
    source_type: 'github_releases',
    github_owner: 'octocat',
    github_repo: 'hello-world',
    github_asset_regex: '',
    github_manifest: true,
  }, fetcher);
  assert.equal(result.github_manifest, true);
});

test('updates mod source configuration through dedicated endpoint', async () => {
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), '/api/v1/author/mods/mod_test/source');
    assert.equal(init?.method, 'PATCH');
    assert.equal(init?.credentials, 'same-origin');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.source_type, 'github_releases');
    assert.equal(body.github_owner, 'octocat');
    assert.equal(body.github_repo, 'hello');
    return new Response(JSON.stringify({
      id: 'mod_test',
      source_type: 'github_releases',
      github_owner: 'octocat',
      github_repo: 'hello',
    }), { status: 200 });
  }) as typeof fetch;
  const result = await updateAuthorModSource('/api/v1', 'mod_test', {
    source_type: 'github_releases',
    github_owner: 'octocat',
    github_repo: 'hello',
  }, fetcher);
  assert.equal(result.source_type, 'github_releases');
});

test('triggers manual github release synchronization', async () => {
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), '/api/v1/author/mods/mod_test/github-sync');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'same-origin');
    return new Response(JSON.stringify({
      mod_id: 'mod_test',
      synced_at: '2026-10-08T12:00:00Z',
      created: 1,
      skipped: 0,
      failed: 0,
      items: [{ release_id: 1, tag: 'v1.0.0', action: 'created' }],
    }), { status: 200 });
  }) as typeof fetch;
  const summary = await syncAuthorModGitHub('/api/v1', 'mod_test', fetcher);
  assert.equal(summary.created, 1);
  assert.equal(summary.items[0].tag, 'v1.0.0');
});

test('retries transient gateway errors without retrying JSON API errors', async () => {
  let attempts = 0;
  const fetcher = (async () => {
    attempts += 1;
    if (attempts < 3) return new Response('<html>gateway unavailable</html>', { status: 503, headers: { 'Content-Type': 'text/html' } });
    return new Response(JSON.stringify({ mod_id: 'mod_test', synced_at: '2026-10-08T12:00:00Z', created: 0, skipped: 1, failed: 0, items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const summary = await syncAuthorModGitHub('/api/v1', 'mod_test', fetcher);
  assert.equal(summary.skipped, 1);
  assert.equal(attempts, 3);
});

test('unpublishes author mod through authenticated endpoint', async () => {
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), '/api/v1/author/mods/mod_test/unpublish');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'same-origin');
    return new Response(JSON.stringify({ id: 'mod_test', unpublished: true }), { status: 200 });
  }) as typeof fetch;
  const result = await unpublishAuthorMod('/api/v1', 'mod_test', fetcher);
  assert.equal(result.id, 'mod_test');
  assert.equal(result.unpublished, true);
});

test('uploads one archive per platform and without a platform for shared versions', async () => {
  const requests: string[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(String(input));
    assert.equal(init?.method, 'POST');
    assert.equal(init?.credentials, 'same-origin');
    const body = init?.body as FormData;
    assert.ok(body instanceof FormData);
    assert.ok(body.get('archive'));
    const url = String(input);
    if (url.endsWith('?platform=android')) {
      return Response.json({
        version_id: 'ver_1',
        version: '1.2.0',
        state: 'scanning',
        platform: 'android',
        size_bytes: 20,
        sha256: 'b'.repeat(64),
        platform_assets: [{ platform: 'android', size_bytes: 20, sha256: 'b'.repeat(64) }],
      });
    }
    assert.equal(url, '/api/v1/author/versions/ver_1/archive');
    return Response.json({ version_id: 'ver_1', version: '1.2.0', state: 'scanning', size_bytes: 10, sha256: 'a'.repeat(64) });
  }) as typeof fetch;

  const shared = await uploadAuthorArchive('/api/v1', 'ver_1', new Blob(['zip']), 'MyMod.zip', undefined, fetcher);
  assert.equal(shared.platform, undefined);

  const android = await uploadAuthorArchive('/api/v1', 'ver_1', new Blob(['zip']), 'MyMod-android.zip', 'android', fetcher);
  assert.equal(android.platform, 'android');
  assert.equal(android.platform_assets?.[0].platform, 'android');
  assert.deepEqual(requests, ['/api/v1/author/versions/ver_1/archive', '/api/v1/author/versions/ver_1/archive?platform=android']);
});

test('sends per-platform release rules and clears them with an empty list', async () => {
  const bodies: unknown[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), '/api/v1/author/mods/mod_test/source');
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ id: 'mod_test', source_type: 'github_releases' });
  }) as typeof fetch;

  await updateAuthorModSource('/api/v1', 'mod_test', {
    source_type: 'github_releases',
    github_owner: 'octocat',
    github_repo: 'hello',
    github_platform_assets: [
      { platform: 'windows', regex: 'MyMod-windows\\.zip$' },
      { platform: 'android', regex: 'MyMod-android\\.zip$' },
    ],
  }, fetcher);
  // An empty list is the explicit "back to one shared regex" instruction; it must
  // survive JSON serialisation instead of being dropped as absent.
  await updateAuthorModSource('/api/v1', 'mod_test', {
    source_type: 'github_releases',
    github_owner: 'octocat',
    github_repo: 'hello',
    github_platform_assets: [],
  }, fetcher);

  assert.deepEqual((bodies[0] as { github_platform_assets?: unknown }).github_platform_assets, [
    { platform: 'windows', regex: 'MyMod-windows\\.zip$' },
    { platform: 'android', regex: 'MyMod-android\\.zip$' },
  ]);
  assert.deepEqual((bodies[1] as { github_platform_assets?: unknown }).github_platform_assets, []);
});

