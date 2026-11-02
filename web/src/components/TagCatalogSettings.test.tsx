import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MAX_TAG_CHILDREN,
  TagCatalogSettings,
  addChildTag,
  addMainTag,
  duplicateTagName,
  moveMainTag,
  removeChildTag,
  removeMainTag,
  setChildDescription,
  setMainDescription,
  tagCatalogDirty,
  validateTagDescription,
  validateTagName,
} from './TagCatalogSettings';
import type { TagGroup } from '../../../ui/tags-api';

const groups: TagGroup[] = [
  { name: '工具', children: [{ name: '绘图' }] },
  { name: '音乐' },
];

test('validateTagName mirrors the server rules', () => {
  assert.equal(validateTagName('  '), '标签名不能为空');
  assert.equal(validateTagName('工'.repeat(25)), '标签名最多 24 个字符');
  assert.equal(validateTagName('工,具'), '标签名不能包含逗号或井号');
  assert.equal(validateTagName('#工具'), '标签名不能包含逗号或井号');
  assert.equal(validateTagName(' 窗口反应 '), null);
});

test('duplicate names are rejected across both levels', () => {
  assert.match(String(duplicateTagName('工具', groups)), /已存在/);
  assert.match(String(duplicateTagName('绘图', groups)), /已存在/);
  assert.equal(duplicateTagName('新标签', groups), null);
});

test('adding tags trims the name and reports the cap', () => {
  const added = addMainTag(groups, ' 浪漫 ');
  assert.equal(added.error, null);
  assert.deepEqual(added.groups[2], { name: '浪漫' });
  assert.match(String(addMainTag(groups, '工具').error), /已存在/);

  const child = addChildTag(groups, '工具', '脚本');
  assert.deepEqual(child.groups[0].children, [{ name: '绘图' }, { name: '脚本' }]);
  const full = Array.from({ length: MAX_TAG_CHILDREN }, (_, index) => ({ name: `c${index}` }));
  const blocked = addChildTag([{ name: '工具', children: full }], '工具', 'extra');
  assert.match(String(blocked.error), /最多/);
});

test('removing and reordering never mutates the input', () => {
  const removed = removeMainTag(groups, '工具');
  assert.deepEqual(removed.map((group) => group.name), ['音乐']);
  assert.equal(groups.length, 2);

  const trimmed = removeChildTag(groups, '工具', '绘图');
  assert.deepEqual(trimmed[0].children, []);
  assert.deepEqual(groups[0].children, [{ name: '绘图' }]);

  const moved = moveMainTag(groups, 0, 1);
  assert.deepEqual(moved.map((group) => group.name), ['音乐', '工具']);
  assert.equal(moveMainTag(groups, 0, -1), groups, 'out-of-range moves are a no-op');
});

test('dirty detection ignores nothing but real edits', () => {
  assert.equal(tagCatalogDirty(groups, groups), false);
  assert.equal(tagCatalogDirty([{ name: '工具' }], groups), true);
});

test('the card renders the hierarchy, counts, and keeps saving disabled until dirty', () => {
  const html = renderToStaticMarkup(
    <TagCatalogSettings apiBase="/api/v1" groups={groups} revision={3} onSaved={() => {}} onConflict={() => {}} onToast={() => {}} />,
  );
  assert.match(html, /标签目录/);
  assert.match(html, /主标签 2\/20 · 子标签 1/);
  assert.match(html, /#工具/);
  // 子标签默认折叠：计数仍然报出来，但列表里先不铺开。
  assert.match(html, /展开 工具 的子标签（1 个）/);
  assert.equal(html.includes('删除子标签 绘图'), false, '子标签默认收起');
  assert.match(html, /保存后，从目录里删掉的标签会同时从模组上移除/);
  assert.equal((html.match(/保存目录/g) || []).length, 1);
  assert.equal((html.match(/disabled=""/g) || []).length >= 2, true, '恢复与保存都应在未改动时禁用');
});

test('an empty catalog explains why it cannot be saved', () => {
  const html = renderToStaticMarkup(
    <TagCatalogSettings apiBase="/api/v1" groups={[]} revision={1} onSaved={() => {}} onConflict={() => {}} onToast={() => {}} />,
  );
  assert.match(html, /目录为空/);
  assert.match(html, /主标签 0\/20/);
});

test('描述规则与服务端一致：可留空、限长、不接受换行', () => {
  assert.equal(validateTagDescription(''), null, '描述是可选的');
  assert.equal(validateTagDescription('  自动修复类  '), null);
  assert.equal(validateTagDescription('描'.repeat(61)), '标签描述最多 60 个字符');
  assert.equal(validateTagDescription('第一行' + String.fromCharCode(10) + '第二行'), '标签描述不能包含换行等控制字符');
});

test('描述可就地改，并算作未保存改动', () => {
  const withMain = setMainDescription(groups, '工具', ' 自动修复与诊断类模组 ');
  assert.equal(withMain[0].description, '自动修复与诊断类模组');
  assert.equal(groups[0].description, undefined, '不能就地改动入参');
  assert.equal(tagCatalogDirty(withMain, groups), true);

  const cleared = setMainDescription(withMain, '工具', '   ');
  assert.equal(cleared[0].description, undefined, '清空描述就真的不再写这个字段');

  const withChild = setChildDescription(groups, '工具', '绘图', '生成与编辑图片');
  assert.equal(withChild[0].children![0].description, '生成与编辑图片');
  assert.equal(withChild[0].children![0].name, '绘图', '改描述不能改名称');
});

test('描述进入渲染：主标签与展开后的子标签都能看到输入框', () => {
  const described: TagGroup[] = [
    { name: '工具', description: '自动修复与诊断类模组', children: [{ name: '绘图', description: '生成与编辑图片' }] },
  ];
  const html = renderToStaticMarkup(
    <TagCatalogSettings apiBase="/api/v1" groups={described} revision={1} onSaved={() => {}} onConflict={() => {}} onToast={() => {}} />,
  );
  assert.match(html, /aria-label="描述 工具"/);
  assert.match(html, /value="自动修复与诊断类模组"/);
  // 收起时子标签的输入框不渲染，避免一屏塞满看不见的输入。
  assert.equal(html.includes('aria-label="描述 绘图"'), false);
});

test('子标签折叠状态独立于保存内容', () => {
  // 折叠只影响编辑时的可见性，不进目录数据；保存载荷里不该出现任何折叠字段。
  const html = renderToStaticMarkup(
    <TagCatalogSettings apiBase="/api/v1" groups={groups} revision={1} onSaved={() => {}} onConflict={() => {}} onToast={() => {}} />,
  );
  assert.equal(html.includes('name="expanded"'), false, '折叠状态不能混进表单字段');
  assert.match(html, /aria-expanded="false"/, '有子标签的主标签默认收起');
});
