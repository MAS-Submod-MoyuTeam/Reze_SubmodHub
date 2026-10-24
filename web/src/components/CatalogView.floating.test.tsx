/**
 * 目录页的悬浮刷新与「返回顶部」。
 *
 * 这两件事在桌面客户端已经有既定口径（`clients/desktop/src/components/CatalogView.tsx`），
 * Web 版跟着同一套语义走：刷新常驻、刷新期间置灰并旋转、失败时让位给失败条；
 * 返回顶部只在离开顶部后出现，点击把整页滚回顶部。
 *
 * 这里用 Node 自带的测试跑真实挂载：滚动位置与 `scrollTo` 调用都靠可写的假属性记录，
 * 不引入 jsdom 之外的依赖。
 */
import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoot } from 'react-dom/client';
import { AppContext } from '../context/AppContext';
import { CatalogView } from './CatalogView';
import { createMockContext, sampleMod, sampleVersion } from '../test/appContextMock';

type Listener = (event: unknown) => void;

class MockElement {
  nodeType = 1;
  tagName = 'DIV';
  nodeName = 'DIV';
  childNodes: any[] = [];
  _textContent?: string;
  disabled = false;
  get children(): any[] {
    return this.childNodes.filter((c: any) => c.nodeType === 1);
  }
  get textContent(): string {
    if (this._textContent !== undefined) return this._textContent;
    let text = '';
    for (const child of this.childNodes) {
      text += (child.textContent || '') + ' ';
    }
    return text.trim();
  }
  set textContent(val: string) {
    this._textContent = val;
    this.childNodes = [];
  }
  style: any = {};
  attributes: Record<string, string> = {};
  ownerDocument: any = null;
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  parentNode: any = null;
  eventListeners: Record<string, Listener[]> = {};

  appendChild(child: any) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) this.childNodes.splice(idx, 1);
    this.childNodes.push(child);
    child.parentNode = this;
    this._textContent = undefined;
    return child;
  }
  removeChild(child: any) {
    const idx = this.childNodes.indexOf(child);
    if (idx !== -1) this.childNodes.splice(idx, 1);
    child.parentNode = null;
    this._textContent = undefined;
    return child;
  }
  insertBefore(newNode: any, refNode: any) {
    const existingIdx = this.childNodes.indexOf(newNode);
    if (existingIdx !== -1) this.childNodes.splice(existingIdx, 1);
    const idx = this.childNodes.indexOf(refNode);
    if (idx === -1) this.childNodes.push(newNode);
    else this.childNodes.splice(idx, 0, newNode);
    newNode.parentNode = this;
    this._textContent = undefined;
    return newNode;
  }
  addEventListener(event: string, handler: Listener) {
    if (!this.eventListeners[event]) this.eventListeners[event] = [];
    this.eventListeners[event].push(handler);
  }
  removeEventListener(event: string, handler: Listener) {
    if (this.eventListeners[event]) {
      this.eventListeners[event] = this.eventListeners[event].filter((h) => h !== handler);
    }
  }
  dispatchEvent(event: any) {
    event.target = this;
    event.currentTarget = this;
    let curr: any = this;
    while (curr) {
      const handlers = curr.eventListeners[event.type] || [];
      for (const h of handlers) h.call(curr, event);
      curr = curr.parentNode;
    }
  }
  click() {
    if (this.disabled) return;
    this.dispatchEvent({ type: 'click', bubbles: true, cancelable: true });
  }
  setAttribute(name: string, val: any) {
    this.attributes[name] = String(val);
    if (name === 'title') (this as any).title = String(val);
    if (name === 'disabled') this.disabled = true;
  }
  removeAttribute(name: string) {
    delete this.attributes[name];
    if (name === 'disabled') this.disabled = false;
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
}

function setupMockDom() {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  const doc: any = {
    nodeType: 9,
    nodeName: '#document',
    eventListeners: {} as Record<string, Listener[]>,
    scrollCalls: [] as unknown[],
    createElement(tag: string) {
      const el = new MockElement();
      el.tagName = tag.toUpperCase();
      el.nodeName = tag.toUpperCase();
      el.ownerDocument = doc;
      return el;
    },
    createElementNS(_ns: string, tag: string) {
      return this.createElement(tag);
    },
    createTextNode(text: string) {
      let val = text;
      return {
        nodeType: 3,
        nodeName: '#text',
        get textContent() {
          return val;
        },
        set textContent(v: string) {
          val = v;
        },
        get nodeValue() {
          return val;
        },
        set nodeValue(v: string) {
          val = v;
        },
        get data() {
          return val;
        },
        set data(v: string) {
          val = v;
        },
        ownerDocument: doc,
      };
    },
    createComment(text: string) {
      return { nodeType: 8, nodeName: '#comment', textContent: text, ownerDocument: doc };
    },
    documentElement: new MockElement(),
    // 与浏览器一致：位置与滚动动作在 documentElement 上，`scroll` 事件从 document 派发。
    dispatchEvent(event: any) {
      for (const handler of doc.eventListeners[event.type] || []) handler.call(doc, event);
    },
    addEventListener(event: string, handler: Listener) {
      if (!doc.eventListeners[event]) doc.eventListeners[event] = [];
      doc.eventListeners[event].push(handler);
    },
    removeEventListener(event: string, handler: Listener) {
      if (doc.eventListeners[event]) {
        doc.eventListeners[event] = doc.eventListeners[event].filter((h: Listener) => h !== handler);
      }
    },
  };
  // `pageScrollPane()` 推动的是 documentElement，所以记录也必须挂在它身上。
  doc.documentElement.scrollTo = (options: unknown) => {
    doc.scrollCalls.push(options);
  };

  (globalThis as any).HTMLIFrameElement = class {};
  (globalThis as any).Element = MockElement;
  (globalThis as any).window = {
    document: doc,
    HTMLIFrameElement: (globalThis as any).HTMLIFrameElement,
    Element: MockElement,
    addEventListener() {},
    removeEventListener() {},
    location: { origin: 'http://localhost:3000' },
    setTimeout: (fn: any, ms: any) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: any) => globalThis.clearTimeout(id),
    setInterval: (fn: any, ms: any) => globalThis.setInterval(fn, ms),
    clearInterval: (id: any) => globalThis.clearInterval(id),
  };
  doc.defaultView = (globalThis as any).window;
  (globalThis as any).document = doc;

  return { doc };
}

async function mountCatalog(overrides: Parameters<typeof createMockContext>[0] = {}) {
  const { doc } = setupMockDom();
  const ctx = createMockContext({ mods: [sampleMod], versions: [sampleVersion], ...overrides });
  const container = doc.createElement('div');
  doc.documentElement.appendChild(container);
  const root = createRoot(container as any);
  await act(async () => {
    root.render(
      <AppContext.Provider value={ctx}>
        <CatalogView onSelectMod={() => {}} onOpenDownloadModal={() => {}} />
      </AppContext.Provider>,
    );
  });
  return {
    doc,
    ctx,
    container,
    byTestId: (id: string) => findByTestId(container, id),
    async scrollPageTo(top: number) {
      // 与浏览器一致：位置在 documentElement 上，事件从 document 派发。
      doc.documentElement.scrollTop = top;
      await act(async () => {
        doc.dispatchEvent({ type: 'scroll' });
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

function findByTestId(root: any, id: string): any | null {
  if (root.nodeType === 1 && root.attributes?.['data-testid'] === id) return root;
  for (const child of root.childNodes || []) {
    const found = findByTestId(child, id);
    if (found) return found;
  }
  return null;
}

function findByAriaLabel(root: any, label: string): any | null {
  if (root.nodeType === 1 && root.attributes?.['aria-label'] === label) return root;
  for (const child of root.childNodes || []) {
    const found = findByAriaLabel(child, label);
    if (found) return found;
  }
  return null;
}

function findNodeByText(root: any, pattern: RegExp): any | null {
  if (root.nodeType === 3 && typeof root.textContent === 'string' && pattern.test(root.textContent)) {
    return root.parentNode;
  }
  if (root.nodeType === 1 && root.childNodes.length === 0 && pattern.test(root.textContent || '')) {
    return root;
  }
  for (const child of root.childNodes || []) {
    const found = findNodeByText(child, pattern);
    if (found) return found;
  }
  return null;
}

function findFirst(root: any, predicate: (node: any) => boolean): any | null {
  if (root.nodeType === 1 && predicate(root)) return root;
  for (const child of root.childNodes || []) {
    const found = findFirst(child, predicate);
    if (found) return found;
  }
  return null;
}

test('刷新按钮常驻在目录页，空闲时不置灰也不旋转', async () => {
  const view = await mountCatalog({ catalogLoading: false, catalogRefreshing: false });
  try {
    const refresh = view.byTestId('catalog-refresh');
    assert.ok(refresh, '目录页必须常驻刷新入口');
    assert.equal(refresh.getAttribute('aria-label'), '刷新模组目录');
    assert.equal(refresh.disabled, false, '空闲时刷新必须可点');
    assert.equal(findFirst(refresh, (node: any) => /animate-spin/.test(node.attributes?.class || '')), null, '空闲时不能转');
  } finally {
    await view.unmount();
  }
});

test('刷新期间置灰并旋转，直到重新拉取结束', async () => {
  const view = await mountCatalog({ catalogRefreshing: true });
  try {
    const refresh = view.byTestId('catalog-refresh');
    assert.ok(refresh);
    assert.equal(refresh.disabled, true, '刷新进行中必须锁住入口');
    assert.equal(refresh.getAttribute('aria-busy'), 'true');
    assert.ok(
      findFirst(refresh, (node: any) => /animate-spin/.test(node.attributes?.class || '')),
      '刷新进行中必须持续旋转',
    );
  } finally {
    await view.unmount();
  }
});

test('点刷新真的重新拉取目录，不假装转圈', async () => {
  let reloads = 0;
  const view = await mountCatalog({
    reloadCatalog: async () => {
      reloads += 1;
    },
  });
  try {
    const refresh = view.byTestId('catalog-refresh');
    assert.ok(refresh);
    await act(async () => {
      refresh.click();
    });
    assert.equal(reloads, 1, '点一次刷新必须发起一次拉取');
  } finally {
    await view.unmount();
  }
});

test('刷新失败时悬浮刷新让位，失败条里只留一个重试入口', async () => {
  let reloads = 0;
  const view = await mountCatalog({
    catalogError: 'fetch failed',
    reloadCatalog: async () => {
      reloads += 1;
    },
  });
  try {
    assert.ok(findNodeByText(view.container, /目录加载失败/), '失败必须可见');
    assert.equal(view.byTestId('catalog-refresh'), null, '失败时的重试入口只有一个');
    const retry = findNodeByText(view.container, /重新加载目录/);
    assert.ok(retry, '失败条必须给出重试入口');
    assert.match(retry.textContent || '', /重新加载目录/);
  } finally {
    await view.unmount();
  }
});

test('失败条在场时不再同时声称「未找到匹配的模组」', async () => {
  const view = await mountCatalog({ catalogError: 'fetch failed' });
  try {
    assert.ok(findNodeByText(view.container, /目录加载失败/));
    assert.equal(
      findNodeByText(view.container, /未找到匹配的模组/),
      null,
      '读不到目录时不该用上一次的残留数据得出「筛不到」',
    );
  } finally {
    await view.unmount();
  }
});

test('返回顶部只在离开顶部后出现', async () => {
  const view = await mountCatalog();
  try {
    assert.equal(view.byTestId('catalog-back-to-top'), null, '首屏还在顶部时不出现');
    await view.scrollPageTo(1200);
    assert.ok(view.byTestId('catalog-back-to-top'), '离开顶部后出现');
    await view.scrollPageTo(240);
    assert.equal(view.byTestId('catalog-back-to-top'), null, '阈值本身不算离开顶部');
    await view.scrollPageTo(241);
    assert.ok(view.byTestId('catalog-back-to-top'), '阈值以上出现');
  } finally {
    await view.unmount();
  }
});

test('点返回顶部把整页滚回顶部', async () => {
  const view = await mountCatalog();
  try {
    await view.scrollPageTo(1500);
    const button = findByAriaLabel(view.container, '返回顶部');
    assert.ok(button, '必须给出可点的返回顶部入口');
    await act(async () => {
      button.click();
    });
    assert.deepEqual(view.doc.scrollCalls, [{ top: 0, behavior: 'smooth' }], '滚动目标是文档顶部');
    await view.scrollPageTo(0);
    assert.equal(view.byTestId('catalog-back-to-top'), null, '滚回顶部后自行收回');
  } finally {
    await view.unmount();
  }
});
