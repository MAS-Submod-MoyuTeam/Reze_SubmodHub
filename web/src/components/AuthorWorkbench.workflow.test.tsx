/**
 * 新建模组弹窗的「复制 GitHub Action 文件」在源码包分配模式下也必须可用。
 *
 * 源码包模式没有文件名正则可填：过去这条路径把「有正则」当成生成文件的唯一
 * 前提，作者勾了「无匹配时使用 Release source code ZIP」之后按钮仍然是灰的，
 * 等于这个仓库用不了发版通知。这里钉住两件事：
 * - 勾上源码包兜底后按钮立刻可用（规则里带的是兜底标记，不是空对象）；
 * - 第 1 步的说明改口成源码包，而不是让作者去找一条自己没填过的正则。
 */
import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { AppContext, type AppContextType } from '../context/AppContext';
import { LangProvider } from '../i18n';
import { AuthorWorkbench } from './AuthorWorkbench';
import { createMockContext } from '../test/appContextMock';

function buttonByText(doc: Document, text: string): HTMLButtonElement {
  const found = [...doc.querySelectorAll('button')].find((el) => (el.textContent || '').trim() === text);
  assert.ok(found, `找不到按钮「${text}」`);
  return found as HTMLButtonElement;
}

function mount() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = {
    window: globals.window,
    document: globals.document,
    localStorage: globals.localStorage,
    IS_REACT_ACT_ENVIRONMENT: globals.IS_REACT_ACT_ENVIRONMENT,
    fetch: globals.fetch,
  };
  globals.window = dom.window;
  globals.document = dom.window.document;
  globals.localStorage = dom.window.localStorage;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  // 打开工作台会读作者列表与标签目录；这里只断言表单，接口统一回空。
  globals.fetch = async () => ({ ok: true, status: 200, json: async () => ({ items: [], groups: [] }), text: async () => '' });
  const win = dom.window as unknown as Record<string, unknown>;
  win.matchMedia = () => ({ matches: false, media: '', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });

  const root = createRoot(dom.window.document.getElementById('root')!);
  const ctx = createMockContext({
    currentUser: { id: 'author_1', username: 'author', display_name: '作者', roles: ['author'] },
    hasRole: (role) => role === 'author',
  });

  return {
    doc: dom.window.document,
    saved,
    async paint() {
      await act(async () => {
        root.render(
          <AppContext.Provider value={ctx as AppContextType}>
            <LangProvider initialLang="zh">
              <AuthorWorkbench />
            </LangProvider>
          </AppContext.Provider>,
        );
      });
    },
    async click(text: string) {
      const el = buttonByText(dom.window.document, text);
      await act(async () => {
        el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      });
    },
    async toggle(id: string) {
      const el = dom.window.document.getElementById(id) as HTMLInputElement | null;
      assert.ok(el, `找不到开关「${id}」`);
      await act(async () => {
        el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      });
    },
    async dispose() {
      await act(async () => { root.unmount(); });
      dom.window.close();
    },
  };
}

test('源码包分配模式下也能生成发版通知文件', { timeout: 60000 }, async () => {
  const app = mount();
  try {
    await app.paint();
    await app.click('新建模组草稿');
    await app.click('GitHub Releases');

    // 没有任何文件名规则时按钮必须是灰的：空规则发出去没有意义。
    const copyButton = () => buttonByText(app.doc, '复制 GitHub Action 文件');
    assert.equal(copyButton().disabled, true);

    // 源码包模式没有正则可填，勾上兜底就够了。
    await app.toggle('gh_source_code_fallback');
    assert.equal(copyButton().disabled, false);
    assert.match(app.doc.body.textContent || '', /确认源码包兜底/);
    assert.doesNotMatch(app.doc.body.textContent || '', /确认文件名规则/);
  } finally {
    await app.dispose();
    const globals = globalThis as unknown as Record<string, unknown>;
    globals.window = app.saved.window;
    globals.document = app.saved.document;
    globals.localStorage = app.saved.localStorage;
    globals.IS_REACT_ACT_ENVIRONMENT = app.saved.IS_REACT_ACT_ENVIRONMENT;
    globals.fetch = app.saved.fetch;
  }
});
