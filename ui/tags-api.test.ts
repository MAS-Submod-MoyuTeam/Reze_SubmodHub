import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchTagCatalog,
  tagCatalogNames,
  tagChildNames,
  tagDescriptions,
  type TagCatalog,
} from './tags-api.js';

test('fetchTagCatalog reads the public catalog with its hierarchy and descriptions', async () => {
  let requested: { url: string; method: string | undefined } | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    requested = { url: String(input), method: init?.method };
    return Response.json({
      groups: [
        {
          name: '工具',
          description: '自动修复与诊断类模组',
          children: [{ name: '绘图', description: '生成与编辑图片' }, { name: '脚本' }],
        },
        { name: '音乐' },
      ],
      revision: 7,
    });
  };

  const catalog: TagCatalog = await fetchTagCatalog('http://127.0.0.1:8080/api/v1', fetcher);
  assert.equal(requested?.url, 'http://127.0.0.1:8080/api/v1/tags');
  assert.deepEqual(catalog.groups, [
    {
      name: '工具',
      description: '自动修复与诊断类模组',
      children: [{ name: '绘图', description: '生成与编辑图片' }, { name: '脚本' }],
    },
    { name: '音乐' },
  ]);
  assert.equal(catalog.revision, 7);
});

test('a description is optional and never required to parse', async () => {
  const fetcher: typeof fetch = async () => Response.json({ groups: [{ name: '音乐', children: [{ name: '轻音乐' }] }] });
  const catalog = await fetchTagCatalog('/api/v1', fetcher);
  assert.deepEqual(catalog.groups, [{ name: '音乐', children: [{ name: '轻音乐' }] }]);
});

test('blank descriptions collapse to absent so callers do not render empty lines', async () => {
  const fetcher: typeof fetch = async () => Response.json({
    groups: [{ name: '工具', description: '   ', children: [{ name: '绘图', description: '  ' }] }],
  });
  const catalog = await fetchTagCatalog('/api/v1', fetcher);
  assert.equal(catalog.groups[0].description, undefined);
  assert.equal(catalog.groups[0].children![0].description, undefined);
});

test('legacy bare-string children still parse as name-only tags', async () => {
  const fetcher: typeof fetch = async () => Response.json({ groups: [{ name: '工具', children: ['绘图', '脚本'] }] });
  const catalog = await fetchTagCatalog('/api/v1', fetcher);
  assert.deepEqual(catalog.groups[0].children, [{ name: '绘图' }, { name: '脚本' }]);
});

test('fetchTagCatalog rejects a payload without groups', async () => {
  const fetcher: typeof fetch = async () => Response.json({ revision: 1 });
  await assert.rejects(async () => fetchTagCatalog('/api/v1', fetcher), /invalid_tag_catalog_response/);
});

test('fetchTagCatalog rejects malformed children', async () => {
  const badNumber: typeof fetch = async () => Response.json({ groups: [{ name: '工具', children: [{ name: 42 }] }], revision: 1 });
  await assert.rejects(async () => fetchTagCatalog('/api/v1', badNumber), /invalid_tag_catalog_response/);

  const notArray: typeof fetch = async () => Response.json({ groups: [{ name: '工具', children: '绘图' }], revision: 1 });
  await assert.rejects(async () => fetchTagCatalog('/api/v1', notArray), /invalid_tag_catalog_response/);

  const badDescription: typeof fetch = async () => Response.json({ groups: [{ name: '工具', description: 7 }], revision: 1 });
  await assert.rejects(async () => fetchTagCatalog('/api/v1', badDescription), /invalid_tag_catalog_response/);
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

test('name and description helpers flatten both levels', () => {
  const groups = [
    { name: '工具', description: '自动修复', children: [{ name: '绘图', description: '生成图片' }, { name: '脚本' }] },
    { name: '音乐' },
  ];
  assert.deepEqual([...tagCatalogNames(groups)].sort(), ['工具', '绘图', '脚本', '音乐'].sort());
  assert.deepEqual(tagChildNames(groups[0]), ['绘图', '脚本']);
  assert.deepEqual(tagChildNames(groups[1]), []);

  const descriptions = tagDescriptions(groups);
  assert.equal(descriptions.get('工具'), '自动修复');
  assert.equal(descriptions.get('绘图'), '生成图片');
  // 没有描述的名称不占位，调用方据此决定是否渲染第二行。
  assert.equal(descriptions.has('脚本'), false);
});
