import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampLoadedPage, hasMoreSubmods, loadFooterLabel, visibleSubmodCount } from './catalogPaging';

const PAGE = 6;

test('visibleSubmodCount：逐页累积，且不超过命中总数', () => {
  assert.equal(visibleSubmodCount(1, PAGE, 14), 6, '首页只渲染一页');
  assert.equal(visibleSubmodCount(2, PAGE, 14), 12, '加载一页后累积');
  assert.equal(visibleSubmodCount(3, PAGE, 14), 14, '末页按总数收敛，不留空位');
  assert.equal(visibleSubmodCount(9, PAGE, 14), 14, '多余页数不会越过总数');
  assert.equal(visibleSubmodCount(0, PAGE, 14), 6, '页数下限为 1');
});

test('visibleSubmodCount：已渲染数量用于「已渲染 xx / 共 yy」', () => {
  // 筛选后只剩 2 条时必须报 2，而不是首屏整页的 6。
  assert.equal(visibleSubmodCount(1, PAGE, 2), 2);
  assert.equal(visibleSubmodCount(1, PAGE, 0), 0, '空结果不报告任何已渲染');
});

test('hasMoreSubmods：仍有余量时才提示滚动查看更多', () => {
  assert.equal(hasMoreSubmods(6, 14), true);
  assert.equal(hasMoreSubmods(12, 14), true);
  assert.equal(hasMoreSubmods(14, 14), false, '全部渲染后不再提示');
  assert.equal(hasMoreSubmods(0, 0), false, '空目录没有下一页');
});

test('clampLoadedPage：命中变少时页数收敛，不保留看不见的旧页', () => {
  assert.equal(clampLoadedPage(3, PAGE, 14), 3, '命中数仍够三页时保持不变');
  assert.equal(clampLoadedPage(3, PAGE, 10), 2, '命中变少后收敛到 10 条能覆盖的页数');
  assert.equal(clampLoadedPage(3, PAGE, 4), 1, '只剩一页以内时回到首页');
});

test('clampLoadedPage：上限夹住页数，筛选放宽不会凭空恢复旧页', () => {
  // 回归：14 条滚到第 3 页后切到只剩 1 条的标签，再切回来，页数必须停在该结果能覆盖的上限。
  assert.equal(clampLoadedPage(1, PAGE, 14), 1, '仍从首页开始，续页交给哨兵');
  assert.equal(clampLoadedPage(3, PAGE, 1), 1, '命中只剩 1 条时夹到一页');
  assert.equal(clampLoadedPage(5, PAGE, 14), 3, '多余页数夹到能覆盖 14 条的三页');
});

test('clampLoadedPage：空结果与非法页数回到首页', () => {
  assert.equal(clampLoadedPage(4, PAGE, 0), 1, '空结果不保留任何页数');
  assert.equal(clampLoadedPage(0, PAGE, 14), 1, '页数下限为 1');
});

test('loadFooterLabel：全部渲染后只报总数', () => {
  assert.equal(loadFooterLabel(14, 14, '子模组'), '共 14 个子模组');
  assert.equal(loadFooterLabel(0, 0, '子模组'), '共 0 个子模组', '无命中时列表区自己说明，页脚只报总数');
  assert.equal(loadFooterLabel(2, 2, '子模组'), '共 2 个子模组');
});

test('loadFooterLabel：仍有未渲染条目时提示滚动，不谎称正在加载', () => {
  const label = loadFooterLabel(6, 14, '子模组');
  assert.equal(label, '已渲染 6 / 共 14 个子模组，滚动查看更多');
  assert.doesNotMatch(label, /正在加载/, '全部条目早已在内存里，没有东西在加载');
});
