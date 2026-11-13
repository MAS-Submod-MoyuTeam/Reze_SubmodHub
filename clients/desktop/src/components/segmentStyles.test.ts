/**
 * 深色主题分段控件选中态的护栏。
 *
 * 1. 锁住「选中 = bg-neutral-800 + inset 描边」这条口径；
 * 2. 扫一遍 clients/desktop/src 下的组件，禁止再出现旧的
 *    `bg-neutral-800 text-white shadow-xs`——它铺在 bg-neutral-900 的分段条上只差
 *    一级深灰，看不出哪一项是当前值（目录分类、已安装子页签都踩过）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { darkSegmentState } from './segmentStyles';

// 故意拆段：断言不该把自己也扫进去。
const LEGACY_WEAK_SELECTED = ['bg-neutral-800 text-white', 'shadow-xs'].join(' ');

function componentFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? componentFiles(full) : [full];
  });
}

test('选中项自带描边，未选中项只剩灰字', () => {
  const on = darkSegmentState(true);
  const off = darkSegmentState(false);
  assert.match(on, /ring-1/);
  assert.match(on, /bg-neutral-800/);
  assert.doesNotMatch(off, /bg-neutral-800/);
});

test('组件里不再出现「两级深灰只差一级」的旧选中写法', () => {
  const root = fileURLToPath(new URL('..', import.meta.url)); // clients/desktop/src
  const offenders = componentFiles(root)
    .filter((file) => file.endsWith('.tsx'))
    .filter((file) => readFileSync(file, 'utf8').includes(LEGACY_WEAK_SELECTED))
    .map((file) => relative(root, file).replaceAll('\\', '/'));
  assert.deepEqual(offenders, [], `这些组件还在用旧选中态：${offenders.join(', ')}`);
});
