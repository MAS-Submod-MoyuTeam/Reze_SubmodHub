import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { MotionGlobalConfig } from 'motion/react';
import { AppContext } from '../context/AppContext';
import { ToastContainer } from './ToastContainer';
import { MotionProvider } from './Motion';
import { createMockContext } from '../test/appContextMock';

/**
 * 提示条的动效契约。
 *
 * jsdom 没有 WAAPI，motion 的退场帧不会推进；`skipAnimations` 让动画立即完成，
 * 于是能验证「条目从 context 消失后，AnimatePresence 会把它收走」这条关键行为——
 * 旧实现靠自维护的 `leaving` 副本 + 计时器做同一件事，那套状态机已被删除。
 */
MotionGlobalConfig.skipAnimations = true;

type Tone = 'success' | 'error' | 'info' | 'warning';
interface Toast {
  id: string;
  type: Tone;
  message: string;
}

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

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const ctx = createMockContext();

  return {
    container,
    async paint(toasts: Toast[]) {
      await act(async () => {
        root.render(
          <MotionProvider>
            <AppContext.Provider value={{ ...ctx, toasts }}>
              <ToastContainer />
            </AppContext.Provider>
          </MotionProvider>
        );
      });
    },
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

const messages = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[role="region"] > div')).map((node) => node.textContent ?? '');

test('没有提示时不渲染任何条目', async () => {
  const view = mount();
  try {
    await view.paint([]);
    assert.deepEqual(messages(view.container), []);
  } finally {
    await view.close();
  }
});

test('提示消失后由 AnimatePresence 收走，不留残影', async () => {
  const view = mount();
  try {
    await view.paint([{ id: 't1', type: 'info', message: '已复制分享链接' }]);
    assert.equal(messages(view.container).length, 1);
    assert.ok(view.container.textContent?.includes('已复制分享链接'));

    await view.paint([]);
    await view.waitForExit();
    assert.deepEqual(messages(view.container), [], '移除后必须从 DOM 消失，否则会一直挡着右下角');
  } finally {
    await view.close();
  }
});

test('移除一条时其余提示保留', async () => {
  const view = mount();
  try {
    await view.paint([
      { id: 't1', type: 'info', message: '第一条' },
      { id: 't2', type: 'error', message: '第二条' },
    ]);
    assert.equal(messages(view.container).length, 2);

    await view.paint([{ id: 't2', type: 'error', message: '第二条' }]);
    await view.waitForExit();
    const left = messages(view.container);
    assert.equal(left.length, 1, '只该收走被移除的那一条');
    assert.ok(left[0].includes('第二条'));
  } finally {
    await view.close();
  }
});

test('提示的关闭按钮有可访问名与三种输入反馈', async () => {
  const view = mount();
  try {
    await view.paint([{ id: 't1', type: 'success', message: '已保存' }]);
    const button = view.container.querySelector('button[aria-label="关闭提示"]');
    assert.ok(button, '关闭按钮必须有可访问名，不能只有一个图标');
    const cls = button!.className;
    assert.match(cls, /hover:/);
    assert.match(cls, /active:/);
    assert.match(cls, /focus-visible:/);
  } finally {
    await view.close();
  }
});
