import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usePaneScrolled } from './usePaneScrolled';
import { mountTestDom } from './testDom';

function Probe({ pane, threshold }: { pane: HTMLElement | null; threshold?: number }) {
  const scrolled = usePaneScrolled(pane, threshold);
  return React.createElement('div', { 'data-testid': 'probe', 'data-scrolled': String(scrolled) });
}

async function mountPane(threshold?: number) {
  const ctx = mountTestDom('<div id="pane"></div><div id="root"></div>');
  const pane = ctx.document.getElementById('pane')!;
  return {
    ctx,
    pane,
    /** 模拟真实滚动：改 scrollTop 并派发面板自己的 scroll 事件（窗口不派发）。 */
    async scrollTo(top: number) {
      pane.scrollTop = top;
      await act(async () => {
        pane.dispatchEvent(new ctx.window.Event('scroll'));
      });
    },
    scrolled: () => (ctx.document.querySelector('[data-testid="probe"]') as HTMLElement | null)?.dataset.scrolled,
    async paint() {
      await ctx.paint(React.createElement(Probe, { pane, threshold }));
    },
  };
}

test('面板还在顶部时不出现「返回顶部」控件', async () => {
  const view = await mountPane();
  try {
    await view.paint();
    assert.equal(view.scrolled(), 'false', '首屏没有滚动过');
  } finally {
    await view.ctx.close();
  }
});

test('滚动超过阈值后出现，回到 240px 以内即收回', async () => {
  const view = await mountPane();
  try {
    await view.paint();
    await view.scrollTo(1200);
    assert.equal(view.scrolled(), 'true', '面板离开顶部后出现');
    await view.scrollTo(240);
    assert.equal(view.scrolled(), 'false', '阈值本身不算离开顶部');
    await view.scrollTo(241);
    assert.equal(view.scrolled(), 'true');
    await view.scrollTo(0);
    assert.equal(view.scrolled(), 'false', '回到顶部后自行收回');
  } finally {
    await view.ctx.close();
  }
});

test('用面板自己的滚动位置判断，窗口滚动不参与', async () => {
  const view = await mountPane();
  try {
    await view.paint();
    // 组件挂在内部面板里，滚窗口不会产生面板 scroll 事件。
    await act(async () => {
      view.ctx.window.dispatchEvent(new view.ctx.window.Event('scroll'));
    });
    assert.equal(view.scrolled(), 'false', '窗口滚动不得让控件出现');
  } finally {
    await view.ctx.close();
  }
});

test('滚动面板卸载后收回控件，不再残留', async () => {
  const view = await mountPane();
  try {
    await view.paint();
    await view.scrollTo(900);
    assert.equal(view.scrolled(), 'true');
    await view.ctx.paint(React.createElement(Probe, { pane: null }));
    assert.equal(view.scrolled(), 'false');
  } finally {
    await view.ctx.close();
  }
});
