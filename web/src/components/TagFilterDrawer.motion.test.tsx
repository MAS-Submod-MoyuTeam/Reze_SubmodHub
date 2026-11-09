import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { MotionGlobalConfig } from 'motion/react';
import { TagFilterDrawer } from './TagFilterDrawer';
import { MotionProvider } from './Motion';
import type { TagFilterRow, TagFilterStates } from '../../../ui/tag-filter';

/**
 * 抽屉的动效契约。
 *
 * jsdom 没有 WAAPI（`Element.animate` 为 undefined），motion 的帧循环推进不了，
 * 退场动画在单测里永远不会自然结束。用官方的 `MotionGlobalConfig.skipAnimations`
 * 让动画立即完成——这样测的是「AnimatePresence 有没有正确拖住并释放节点」，
 * 而不是「动画好不好看」。位移与透明度的实际效果交给真实浏览器验收。
 */
MotionGlobalConfig.skipAnimations = true;

const rows: TagFilterRow[] = [
  { main: { name: '工具', description: '自动修复与诊断类模组' }, children: [], stale: false },
];
const states: TagFilterStates = {};

function mount() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = {
    window: globals.window,
    document: globals.document,
    IS_REACT_ACT_ENVIRONMENT: globals.IS_REACT_ACT_ENVIRONMENT,
  };
  globals.window = dom.window;
  globals.document = dom.window.document;
  globals.IS_REACT_ACT_ENVIRONMENT = true;

  const root = createRoot(dom.window.document.getElementById('root')!);

  return {
    document: dom.window.document,
    async paint(open: boolean) {
      await act(async () => {
        root.render(
          <MotionProvider>
            <TagFilterDrawer
              open={open}
              onClose={() => {}}
              rows={rows}
              states={states}
              onToggle={() => {}}
              onClear={() => {}}
            />
          </MotionProvider>
        );
      });
    },
    /** 让 AnimatePresence 完成退场并卸载。 */
    async waitForExit() {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
      });
    },
    async close() {
      await act(async () => root.unmount());
      dom.window.close();
      globals.window = saved.window;
      globals.document = saved.document;
      globals.IS_REACT_ACT_ENVIRONMENT = saved.IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

const drawer = (document: Document) => document.querySelector('[data-testid="tag-filter-drawer"]');
const panel = (document: Document) => document.querySelector('[data-testid="tag-filter-drawer"] aside');

test('关闭态不渲染任何节点', async () => {
  const view = mount();
  try {
    await view.paint(false);
    assert.equal(drawer(view.document), null, '关闭时不该留下空壳');
  } finally {
    await view.close();
  }
});

test('打开时遮罩与面板都接上 motion 的变体', async () => {
  const view = mount();
  try {
    await view.paint(true);
    const root = drawer(view.document)!;
    assert.ok(root, '打开后必须渲染抽屉');
    const overlay = root.querySelector('button[aria-label="关闭标签筛选"]') as HTMLElement;
    const aside = panel(view.document) as HTMLElement;
    // motion 会接管这些元素并写入内联 style；jsdom 没有 WAAPI，
    // 进入动画不会推进到终态，所以只断言「motion 确实挂上了」，
    // 具体位移/透明度由真实浏览器验收。
    assert.ok(overlay.getAttribute('style'), '遮罩必须由 motion 接管（写入内联 style）');
    assert.ok(aside.getAttribute('style'), '面板必须由 motion 接管（写入内联 style）');
    assert.equal(aside.tagName, 'ASIDE', 'motion 化之后仍必须是语义化的 aside');
  } finally {
    await view.close();
  }
});

test('关闭后由 AnimatePresence 释放节点，不会留下幽灵遮罩', async () => {
  const view = mount();
  try {
    await view.paint(true);
    assert.ok(drawer(view.document), '先确认打开');
    await view.paint(false);
    await view.waitForExit();
    assert.equal(drawer(view.document), null, '退场结束后必须卸载，否则会挡住整页点击');
  } finally {
    await view.close();
  }
});

test('退场途中重新打开不会把节点卡在中间态', async () => {
  const view = mount();
  try {
    await view.paint(true);
    await view.paint(false);
    await view.paint(true);
    assert.ok(drawer(view.document), '重开后必须仍在树上');
    await view.waitForExit();
    assert.ok(drawer(view.document), '重开后的节点不该被上一轮的退场收走');
  } finally {
    await view.close();
  }
});

test('面板给 Android 状态栏与手势条留出安全区', async () => {
  const view = mount();
  try {
    await view.paint(true);
    const cls = (panel(view.document) as HTMLElement).className;
    assert.match(cls, /env\(safe-area-inset-top/);
    assert.match(cls, /env\(safe-area-inset-bottom/);
    assert.match(cls, /env\(safe-area-inset-right/);
  } finally {
    await view.close();
  }
});

test('抽屉正文阻止滚动链传给背后页面', async () => {
  const view = mount();
  try {
    await view.paint(true);
    const body = view.document.querySelector('[data-testid="tag-filter-drawer"] aside > div.overflow-y-auto');
    assert.ok(body, '抽屉必须有可滚动的正文区');
    assert.match((body as HTMLElement).className, /overscroll-y-contain/);
  } finally {
    await view.close();
  }
});
