import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_TAG_FILTER,
  activeTagFilterCount,
  buildTagFilterRows,
  clearTagFilter,
  describeTagFilter,
  excludedTags,
  hasChildTags,
  includedTags,
  isTagRowExpanded,
  matchesTagFilter,
  nextTagFilterState,
  rowActiveCount,
  toggleTagFilter,
  toggleTagRowExpanded,
} from './tag-filter.js';

test('a tag cycles off → include → exclude → off', () => {
  assert.equal(nextTagFilterState(undefined), 'include');
  assert.equal(nextTagFilterState('include'), 'exclude');
  assert.equal(nextTagFilterState('exclude'), undefined);

  let states = EMPTY_TAG_FILTER;
  states = toggleTagFilter(states, '工具');
  assert.deepEqual(states, { 工具: 'include' });
  states = toggleTagFilter(states, '工具');
  assert.deepEqual(states, { 工具: 'exclude' });
  states = toggleTagFilter(states, '工具');
  assert.deepEqual(states, {}, 'the third click removes the key instead of storing an off state');
});

test('toggling leaves the previous state object untouched', () => {
  const before = { 工具: 'include' as const };
  const after = toggleTagFilter(before, '音乐');
  assert.deepEqual(before, { 工具: 'include' });
  assert.deepEqual(after, { 工具: 'include', 音乐: 'include' });
  assert.notEqual(before, after);
});

test('removing the last tag returns a stable empty object', () => {
  const cleared = clearTagFilter({ 工具: 'include' });
  assert.deepEqual(cleared, {});
  assert.equal(clearTagFilter(EMPTY_TAG_FILTER), EMPTY_TAG_FILTER, 'an empty filter must not re-render');
  assert.equal(activeTagFilterCount(cleared), 0);
});

test('included tags are ANDed, excluded tags veto', () => {
  const states = { 工具: 'include' as const, 音乐: 'exclude' as const };
  assert.equal(matchesTagFilter(['工具', '绘图'], states), true);
  assert.equal(matchesTagFilter(['工具'], states), true, 'a child of an included main tag still matches');
  assert.equal(matchesTagFilter(['工具', '音乐'], states), false, 'an excluded tag vetoes even with every include present');
  assert.equal(matchesTagFilter(['音乐'], states), false);

  const both = { 工具: 'include' as const, 绘图: 'include' as const };
  assert.equal(matchesTagFilter(['工具', '绘图'], both), true);
  assert.equal(matchesTagFilter(['工具', '脚本'], both), false, 'two includes must both be present');
  assert.equal(matchesTagFilter(['工具', '绘图', '脚本'], both), true);
});

test('an empty filter matches everything', () => {
  assert.equal(matchesTagFilter([], EMPTY_TAG_FILTER), true);
  assert.equal(matchesTagFilter(['任意'], EMPTY_TAG_FILTER), true);
});

test('include and exclude lists are reported separately, in insertion order', () => {
  const states = { 工具: 'include' as const, 音乐: 'exclude' as const, 绘图: 'include' as const };
  assert.deepEqual(includedTags(states), ['工具', '绘图']);
  assert.deepEqual(excludedTags(states), ['音乐']);
  assert.equal(activeTagFilterCount(states), 3);
});

test('the filter description names both sides', () => {
  assert.equal(describeTagFilter(EMPTY_TAG_FILTER), '');
  assert.equal(describeTagFilter({ 工具: 'include' }), '包含 #工具');
  assert.equal(describeTagFilter({ 工具: 'exclude' }), '排除 #工具');
  assert.equal(describeTagFilter({ 工具: 'include', 音乐: 'exclude' }), '包含 #工具 · 排除 #音乐');
});

test('rows keep catalog order and append tags that are no longer in the catalog', () => {
  const rows = buildTagFilterRows(
    [
      { name: '工具', children: [{ name: '绘图' }, { name: '脚本' }] },
      { name: '音乐' },
    ],
    ['脚本', '遗留标签', '遗留标签', '工具'],
  );
  assert.deepEqual(rows, [
    {
      main: { name: '工具', description: '' },
      children: [{ name: '绘图', description: '' }, { name: '脚本', description: '' }],
      stale: false,
    },
    { main: { name: '音乐', description: '' }, children: [], stale: false },
    { main: { name: '遗留标签', description: '' }, children: [], stale: true },
  ]);
});

test('an empty catalog still exposes every tag in use', () => {
  const rows = buildTagFilterRows([], ['工具', '遗留标签']);
  assert.deepEqual(rows, [
    { main: { name: '工具', description: '' }, children: [], stale: true },
    { main: { name: '遗留标签', description: '' }, children: [], stale: true },
  ]);
});

test('rows carry descriptions for both levels and keep orphan tags last', () => {
  const rows = buildTagFilterRows(
    [
      {
        name: '工具',
        description: '自动修复与诊断类模组',
        children: [{ name: '绘图', description: '生成与编辑图片' }, { name: '脚本' }],
      },
      { name: '音乐' },
    ],
    ['工具', '遗留标签'],
  );

  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].main, { name: '工具', description: '自动修复与诊断类模组' });
  assert.deepEqual(rows[0].children[0], { name: '绘图', description: '生成与编辑图片' });
  assert.deepEqual(rows[0].children[1], { name: '脚本', description: '' }, 'missing description becomes an empty string');
  assert.deepEqual(rows[1].main, { name: '音乐', description: '' });
  assert.equal(rows[2].main.name, '遗留标签', 'catalog-less tags stay usable');
  assert.equal(rows[2].stale, true);
  assert.deepEqual(rows[2].children, []);
});

test('a group with no children has no collapse control', () => {
  const rows = buildTagFilterRows([{ name: '音乐' }, { name: '工具', children: [{ name: '绘图' }] }], []);
  assert.equal(hasChildTags(rows[0]), false);
  assert.equal(hasChildTags(rows[1]), true);
  // 没有子标签时，即使被点过也恒为收起，调用方据此隐藏折叠按钮。
  assert.equal(isTagRowExpanded({ 音乐: true }, rows[0]), false);
});

test('collapse defaults to closed and toggles independently per group', () => {
  const rows = buildTagFilterRows([{ name: '工具', children: [{ name: '绘图' }] }, { name: '音乐' }], []);
  assert.equal(isTagRowExpanded({}, rows[0]), false, '默认折叠');

  let collapse = toggleTagRowExpanded({}, '工具');
  assert.equal(isTagRowExpanded(collapse, rows[0]), true);
  assert.equal(isTagRowExpanded(collapse, rows[1]), false, 'other groups stay closed');

  collapse = toggleTagRowExpanded(collapse, '工具');
  assert.equal(isTagRowExpanded(collapse, rows[0]), false);
});

test('a collapsed group still reports how many of its tags are filtering', () => {
  const rows = buildTagFilterRows([{ name: '工具', children: [{ name: '绘图' }, { name: '脚本' }] }], []);
  assert.equal(rowActiveCount(rows[0], {}), 0);
  assert.equal(rowActiveCount(rows[0], { 绘图: 'include' }), 1);
  assert.equal(rowActiveCount(rows[0], { 工具: 'include', 绘图: 'exclude' }), 2);
});
