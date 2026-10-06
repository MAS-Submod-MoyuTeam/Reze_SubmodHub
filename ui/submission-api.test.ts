import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listAuthorWorkspace, clearVersionDeprecation, updateAuthorMod } from './submission-api';

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
