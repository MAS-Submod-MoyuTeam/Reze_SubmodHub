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
  tagCatalogDirty,
  validateTagName,
} from './TagCatalogSettings';
import type { TagGroup } from '../../../ui/tags-api';

const groups: TagGroup[] = [
  { name: '工具', children: ['绘图'] },
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
  assert.deepEqual(child.groups[0].children, ['绘图', '脚本']);
  const full = Array.from({ length: MAX_TAG_CHILDREN }, (_, index) => `c${index}`);
  const blocked = addChildTag([{ name: '工具', children: full }], '工具', 'extra');
  assert.match(String(blocked.error), /最多/);
});

test('removing and reordering never mutates the input', () => {
  const removed = removeMainTag(groups, '工具');
  assert.deepEqual(removed.map((group) => group.name), ['音乐']);
  assert.equal(groups.length, 2);

  const trimmed = removeChildTag(groups, '工具', '绘图');
  assert.deepEqual(trimmed[0].children, []);
  assert.deepEqual(groups[0].children, ['绘图']);

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
  assert.match(html, /删除子标签 绘图/);
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
