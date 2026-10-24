import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useLoadMoreOnScroll } from './useLoadMoreOnScroll';
import { FakeIntersectionObserver, mountTestDom } from './testDom';

type ProbeProps = { hasMore: boolean; loadedCount: number; onLoadMore: () => void; pane: HTMLElement | null };

function Probe({ hasMore, loadedCount, onLoadMore, pane }: ProbeProps) {
  const sentinelRef = useLoadMoreOnScroll({ hasMore, onLoadMore, loadedCount, scrollRoot: pane });
  return React.createElement('div', { ref: sentinelRef, 'data-testid': 'sentinel' });
}

/** 每个用例独立 DOM；观察器桩在用例内安装，结束后按原样恢复。 */
function withDom(run: (ctx: ReturnType<typeof mountTestDom>, pane: HTMLElement) => Promise<void>): () => Promise<void> {
  return async () => {
    const ctx = mountTestDom('<div id="pane"></div><div id="root"></div>');
    FakeIntersectionObserver.install();
    try {
      await run(ctx, ctx.document.getElementById('pane')!);
    } finally {
      await ctx.close();
    }
  };
}

test('观察内部滚动面板：root 是面板本身而不是窗口视口', withDom(async (ctx, pane) => {
  // 桌面目录在面板内滚动，以视口为 root 的观察器永远不会回调。
  let calls = 0;
  await ctx.paint(React.createElement(Probe, { hasMore: true, loadedCount: 6, onLoadMore: () => { calls += 1; }, pane }));

  const observer = FakeIntersectionObserver.instances[0];
  assert.ok(observer, '仍有更多可加载时应挂载观察器');
  assert.equal(observer.options?.root, pane, '观察根必须是内部滚动面板');
  assert.match(String(observer.options?.rootMargin), /240px/, '保留滚动至底部前的预取距离');

  await act(async () => observer.emit(false));
  assert.equal(calls, 0, '哨兵不在视野内时不加载');
  await act(async () => observer.emit(true));
  assert.equal(calls, 1, '哨兵进入预取区时加载下一页');
}));

test('行数变化就重新挂载观察器，让仍落在预取区里的哨兵继续填充', withDom(async (ctx, pane) => {
  let calls = 0;
  const onLoadMore = () => { calls += 1; };
  await ctx.paint(React.createElement(Probe, { hasMore: true, loadedCount: 6, onLoadMore, pane }));
  const first = FakeIntersectionObserver.instances[0];
  await ctx.paint(React.createElement(Probe, { hasMore: true, loadedCount: 12, onLoadMore, pane }));

  assert.equal(first.disconnected, true, '上一轮的观察器必须释放');
  const second = FakeIntersectionObserver.instances[1];
  assert.ok(second, '行数变化后重新挂载观察器');
  assert.equal(second.observed[0], first.observed[0], '重挂的是同一个哨兵节点');

  // 旧观察器已被 disconnect，它的回调不得再触发续页；新观察器仍然有效。
  await act(async () => first.emit(true));
  assert.equal(calls, 0, '释放后的观察器不得再触发续页');
  await act(async () => second.emit(true));
  assert.equal(calls, 1, '新观察器接手后续页');
}));

test('一页装不满时继续填充：每追加一页都重新挂载观察器', withDom(async (ctx, pane) => {
  let calls = 0;
  const onLoadMore = () => { calls += 1; };
  const rows = [6, 12, 18];
  for (const loadedCount of rows) {
    await ctx.paint(React.createElement(Probe, { hasMore: true, loadedCount, onLoadMore, pane }));
    const observer = FakeIntersectionObserver.instances[FakeIntersectionObserver.instances.length - 1]!;
    assert.ok(observer, `已渲染 ${loadedCount} 行时必须有观察器`);
    await act(async () => observer.emit(true));
  }
  assert.equal(calls, rows.length, '每一轮都能再次触发，直到哨兵被推出预取区');
  assert.equal(FakeIntersectionObserver.instances.length, rows.length, '每轮各挂载一个观察器');
}));

test('没有滚动面板时不挂载观察器，也不误调用加载', withDom(async (ctx) => {
  await ctx.paint(React.createElement(Probe, {
    hasMore: true,
    loadedCount: 6,
    onLoadMore: () => { throw new Error('面板尚未就绪时不得加载'); },
    pane: null,
  }));
  assert.equal(FakeIntersectionObserver.instances.length, 0);
}));

test('已无更多时释放观察器', withDom(async (ctx, pane) => {
  await ctx.paint(React.createElement(Probe, { hasMore: true, loadedCount: 6, onLoadMore: () => {}, pane }));
  const observer = FakeIntersectionObserver.instances[0];
  await ctx.paint(React.createElement(Probe, { hasMore: false, loadedCount: 12, onLoadMore: () => {}, pane }));

  assert.equal(observer.disconnected, true);
  assert.equal(FakeIntersectionObserver.instances.length, 1, '列表结束后不再挂载观察器');
}));
