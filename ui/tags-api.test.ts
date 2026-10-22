import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchTagCatalog, type TagCatalog } from './tags-api.js';

test('fetchTagCatalog reads the public catalog with its hierarchy', async () => {
  let requested: { url: string; method: string | undefined } | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    requested = { url: String(input), method: init?.method };
    return Response.json({ groups: [{ name: '工具', children: ['绘图', '脚本'] }, { name: '音乐' }], revision: 7 });
  };

  const catalog: TagCatalog = await fetchTagCatalog('http://127.0.0.1:8080/api/v1', fetcher);
  assert.equal(requested?.url, 'http://127.0.0.1:8080/api/v1/tags');
  assert.deepEqual(catalog.groups, [{ name: '工具', children: ['绘图', '脚本'] }, { name: '音乐' }]);
  assert.equal(catalog.revision, 7);
});

test('fetchTagCatalog rejects a payload without groups', async () => {
  const fetcher: typeof fetch = async () => Response.json({ revision: 1 });
  await assert.rejects(async () => fetchTagCatalog('/api/v1', fetcher), /invalid_tag_catalog_response/);
});

test('fetchTagCatalog rejects non-string children', async () => {
  const fetcher: typeof fetch = async () => Response.json({ groups: [{ name: '工具', children: ['绘图', 42] }], revision: 1 });
  await assert.rejects(async () => fetchTagCatalog('/api/v1', fetcher), /invalid_tag_catalog_response/);
});

test('fetchTagCatalog surfaces the server error code', async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ code: 'storage_error' }), { status: 500 });
  await assert.rejects(async () => fetchTagCatalog('/api/v1', fetcher), /storage_error/);
});

test('fetchTagCatalog tolerates a missing revision', async () => {
  const fetcher: typeof fetch = async () => Response.json({ groups: [{ name: '工具' }] });
  const catalog = await fetchTagCatalog('/api/v1', fetcher);
  assert.equal(catalog.revision, 0);
});
