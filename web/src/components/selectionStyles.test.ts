/**
 * 选中态口径的护栏。
 *
 * 两件事：
 * 1. 锁住「选值 = 实心主色、视图 Tab = 白底 + inset 描边」这条口径的输出；
 * 2. 扫一遍 web/src 下的组件，禁止再出现「白底叠浅灰底 + shadow-xs」的旧写法——
 *    那种选中项与未选中项几乎同色，作者看不出点没点中（发行平台、工作台视图切换
 *    都踩过这个坑）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tabStateClass, valueStateClass } from './selectionStyles';

// 故意拆成两段：这条断言不该把自己也扫进去。
const LEGACY_WEAK_SELECTED = ['bg-white text-neutral-900', 'shadow-xs'].join(' ');

function componentFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? componentFiles(full) : [full];
  });
}

test('选值分段项：选中项实心主色，未选中项不填底', () => {
  const on = valueStateClass(true);
  const off = valueStateClass(false);
  assert.match(on, /bg-emerald-700/);
  assert.match(on, /text-white/);
  assert.doesNotMatch(off, /bg-emerald-700/);
});

test('视图 Tab：选中项靠白底 + inset 描边浮起来，不靠文字灰度', () => {
  const on = tabStateClass(true);
  const off = tabStateClass(false);
  assert.match(on, /bg-white/);
  assert.match(on, /ring-1/);
  // 未选中项最多是 hover 时的半透明底，不能真的填成白块。
  assert.doesNotMatch(off, /(^|\s)bg-white(\s|$)/);
});

test('组件里不再出现「白底叠浅灰底」的旧选中写法', () => {
  const root = fileURLToPath(new URL('..', import.meta.url)); // web/src
  const offenders = componentFiles(root)
    .filter((file) => file.endsWith('.tsx'))
    .filter((file) => readFileSync(file, 'utf8').includes(LEGACY_WEAK_SELECTED))
    .map((file) => relative(root, file).replaceAll('\\', '/'));
  assert.deepEqual(offenders, [], `这些组件还在用旧选中态：${offenders.join(', ')}`);
});
