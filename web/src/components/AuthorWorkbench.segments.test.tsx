/**
 * 新建模组弹窗里的分段控件：默认值对不对、选中态看不看得出来。
 *
 * 钉住两个已经反馈过的问题：
 * - GitHub 分段的「版本发现方式」默认要落在「发版通知」。按需抓取本来就在后台
 *   一直跑，把它标成「（默认）」会让作者以为默认是它；
 * - 「内容与版本来源」「发行平台」的选中项此前只是白底加一条淡描边，铺在浅灰底
 *   上几乎看不出区别。选中项必须是实心主色，并且 `aria-pressed` 与视觉一致。
 *
 * 断言只认两件事：`aria-pressed` 反映真实选中态，选中项的 class 里确实有主色填充。
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

const SELECTED_BG = 'bg-emerald-700';

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
    // 工作台里有延时回调（作者列表刷新）；不卸载干净的话 jsdom 的计时器会在
    // 全局对象还原之后再触发，把测试进程吊住。
    async dispose() {
      await act(async () => { root.unmount(); });
      dom.window.close();
    },
  };
}

test('版本发现方式默认是发版通知，分段控件的选中态靠实心主色表达', { timeout: 60000 }, async () => {
  const app = mount();
  try {
    await app.paint();
    await app.click('新建模组草稿');

    // 本地源先行：发行平台的两个按钮默认都发布，选中态必须是实心主色。
    const windows = buttonByText(app.doc, 'Windows');
    const android = buttonByText(app.doc, 'Android');
    assert.equal(windows.getAttribute('aria-pressed'), 'true');
    assert.equal(android.getAttribute('aria-pressed'), 'true');
    assert.match(windows.className, new RegExp(SELECTED_BG));
    assert.match(android.className, new RegExp(SELECTED_BG));

    // 取消勾选后同一条按钮必须马上变得不像被选中：aria-pressed 与底色一起变。
    await app.click('Android');
    assert.equal(buttonByText(app.doc, 'Android').getAttribute('aria-pressed'), 'false');
    assert.doesNotMatch(buttonByText(app.doc, 'Android').className, new RegExp(SELECTED_BG));
    assert.match(buttonByText(app.doc, 'Windows').className, new RegExp(SELECTED_BG));

    // 切到 GitHub Releases：默认必须是「发版通知」，按需抓取不能带「（默认）」字样。
    await app.click('GitHub Releases');
    assert.equal(buttonByText(app.doc, 'GitHub Releases').getAttribute('aria-pressed'), 'true');
    const onDemand = buttonByText(app.doc, '站内按需抓取');
    const notify = buttonByText(app.doc, '发版通知（推荐）');
    assert.equal(notify.getAttribute('aria-pressed'), 'true');
    assert.equal(onDemand.getAttribute('aria-pressed'), 'false');
    assert.match(notify.className, new RegExp(SELECTED_BG));
    assert.doesNotMatch(onDemand.className, new RegExp(SELECTED_BG));

    // 手动改选按需抓取时，选中态同样要跟着走。
    await app.click('站内按需抓取');
    assert.match(buttonByText(app.doc, '站内按需抓取').className, new RegExp(SELECTED_BG));
    assert.doesNotMatch(buttonByText(app.doc, '发版通知（推荐）').className, new RegExp(SELECTED_BG));
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
