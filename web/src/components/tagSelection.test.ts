import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MOD_TAGS,
  isValidTagSelection,
  orderByCatalog,
  toggleTagSelection,
} from './tagSelection';
import type { TagGroup } from '../../../ui/tags-api';

const groups: TagGroup[] = [
  { name: '工具', children: ['绘图', '脚本'] },
  { name: '音乐' },
];

test('selecting a child also selects its main tag', () => {
  const next = toggleTagSelection(groups, [], '脚本');
  assert.deepEqual(next, ['工具', '脚本']);
});

test('deselecting a child keeps the main tag selected', () => {
  const next = toggleTagSelection(groups, ['工具', '脚本'], '脚本');
  assert.deepEqual(next, ['工具']);
});

test('clicking a main tag with any member selected clears the whole group', () => {
  assert.deepEqual(toggleTagSelection(groups, ['工具', '绘图', '音乐'], '工具'), ['音乐']);
  assert.deepEqual(toggleTagSelection(groups, ['工具'], '工具'), []);
});

test('clicking a main tag with nothing selected selects only the main tag', () => {
  assert.deepEqual(toggleTagSelection(groups, [], '工具'), ['工具']);
});

test('the cap counts the main tag added for a child', () => {
  const full = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  assert.equal(MAX_MOD_TAGS, 8);
  const wide: TagGroup[] = [{ name: 'x', children: ['x1'] }];
  // Two free slots are enough for the pair (parent + child).
  assert.deepEqual(toggleTagSelection(wide, ['a', 'b', 'c', 'd', 'e', 'f'], 'x1'), ['a', 'b', 'c', 'd', 'e', 'f', 'x', 'x1']);
  // One free slot is not: the pair would exceed the cap.
  const withParent = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  assert.equal(toggleTagSelection(wide, withParent, 'x1'), withParent);
  assert.equal(toggleTagSelection(wide, full, 'x1'), full, 'no-op must return the same array');
  assert.equal(toggleTagSelection(groups, full, '绘图'), full);
});

test('unknown names never enter the selection', () => {
  const selected = ['工具'];
  assert.equal(toggleTagSelection(groups, selected, '自由标签'), selected);
});

test('orderByCatalog sorts by catalog order and drops unknown names', () => {
  assert.deepEqual(orderByCatalog(groups, ['脚本', '音乐', '工具', '幽灵']), ['工具', '脚本', '音乐']);
});

test('at least one tag is required', () => {
  assert.equal(isValidTagSelection([]), false);
  assert.equal(isValidTagSelection(['  ']), false);
  assert.equal(isValidTagSelection(['工具']), true);
});
