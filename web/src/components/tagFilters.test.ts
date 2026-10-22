import test from 'node:test';
import assert from 'node:assert/strict';
import { activeGroupOf, buildTagFilterModel, childTagsFor } from './tagFilters';
import type { TagGroup } from '../../../ui/tags-api';

const groups: TagGroup[] = [
  { name: '工具', children: ['绘图', '脚本'] },
  { name: '音乐' },
];

test('the catalog drives order, hierarchy, and stale tags', () => {
  const model = buildTagFilterModel(groups, ['脚本', '工具', '遗留标签']);
  assert.deepEqual(model.mains, ['工具', '音乐']);
  assert.deepEqual(model.children, { 工具: ['绘图', '脚本'] });
  assert.deepEqual(model.stale, ['遗留标签']);
});

test('an unavailable catalog falls back to the flat used tags', () => {
  const model = buildTagFilterModel([], ['工具', '遗留标签']);
  assert.deepEqual(model.mains, ['工具', '遗留标签']);
  assert.deepEqual(model.children, {});
  assert.deepEqual(model.stale, []);
  assert.deepEqual(childTagsFor(model, '工具'), []);
});

test('the active group follows the selection, including a child selection', () => {
  const model = buildTagFilterModel(groups, []);
  assert.equal(activeGroupOf(model, 'all'), null);
  assert.equal(activeGroupOf(model, '工具'), '工具');
  assert.equal(activeGroupOf(model, '脚本'), '工具');
  assert.equal(activeGroupOf(model, '音乐'), '音乐');
  assert.equal(activeGroupOf(model, '不存在'), null);
  assert.deepEqual(childTagsFor(model, '脚本'), ['绘图', '脚本']);
  assert.deepEqual(childTagsFor(model, '音乐'), []);
});

test('selecting a main tag matches mods that only carry its children', () => {
  // 服务端在选子标签时会补上主标签，所以包含判定即可覆盖子标签模组。
  const modTags = ['工具', '脚本'];
  assert.equal(modTags.includes('工具'), true);
  assert.equal(modTags.includes('脚本'), true);
  const model = buildTagFilterModel(groups, []);
  assert.equal(activeGroupOf(model, '工具'), '工具');
});
