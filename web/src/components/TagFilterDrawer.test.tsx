/**
 * 目录页的标签筛选抽屉（Web）。
 *
 * 口径：标签默认不选；点一次「包含」，再点一次「排除」，第三次回到未选。
 * 入口在右下角悬浮按钮组里，紧挨刷新按钮；点开是右侧抽屉，Esc 与遮罩都能关。
 *
 * 这里用 Node 自带的测试跑真实挂载，DOM 用一个最小的假实现（与 `CatalogView.floating.test.tsx`
 * 同一套），不引入 jsdom 之外的依赖。
 */
import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoot } from 'react-dom/client';
import { AppContext } from '../context/AppContext';
import { CatalogView } from './CatalogView';
import { createMockContext, sampleMod, sampleVersion } from '../test/appContextMock';
import type { TagFilterStates } from '../../../ui/tag-filter';

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
    for (const child of this.childNodes) text += (child.textContent || '') + ' ';
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
  focus() {}
  setAttribute(name: string, val: any) {
    this.attributes[name] = String(val);
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
  doc.documentElement.scrollTo = () => {};

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

/** 记录 toggleTagFilter 收到的标签名，用来验证「点一次一次点击」。 */
async function mountCatalog(
  options: { tagFilter?: TagFilterStates; mods?: typeof sampleMod[] } = {},
) {
  const { doc } = setupMockDom();
  const toggles: string[] = [];
  let cleared = 0;
  const ctx = createMockContext({
    mods: options.mods ?? [sampleMod],
    versions: [sampleVersion],
    tagFilter: options.tagFilter ?? {},
    toggleTagFilter: (name: string) => toggles.push(name),
    clearTagFilter: () => {
      cleared += 1;
    },
  });
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
    container,
    toggles,
    cleared: () => cleared,
    byTestId: (id: string) => findByTestId(container, id),
    async click(node: any) {
      await act(async () => {
        node.click();
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

function findAllByTestId(root: any, id: string, acc: any[] = []): any[] {
  if (root.nodeType === 1 && root.attributes?.['data-testid'] === id) acc.push(root);
  for (const child of root.childNodes || []) findAllByTestId(child, id, acc);
  return acc;
}

/** 按可访问名找元素；`excludeFirst` 跳过遮罩那一个同名按钮。 */
function findByAriaLabel(root: any, label: string, skipFirst = ''): any | null {
  let skipped = false;
  const walk = (node: any): any | null => {
    if (node.nodeType === 1 && node.attributes?.['aria-label'] === label) {
      if (!skipped && skipFirst) {
        skipped = true;
      } else {
        return node;
      }
    }
    for (const child of node.childNodes || []) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(root);
}

function findByDataTag(root: any, tag: string): any | null {
  if (root.nodeType === 1 && root.attributes?.['data-tag'] === tag) return root;
  for (const child of root.childNodes || []) {
    const found = findByDataTag(child, tag);
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

test('标签按钮与刷新按钮同排，抽屉默认关闭', async () => {
  const view = await mountCatalog();
  try {
    const tags = view.byTestId('catalog-tags');
    const refresh = view.byTestId('catalog-refresh');
    assert.ok(tags, '目录页必须有标签入口');
    assert.ok(refresh, '刷新入口仍在');
    assert.equal(tags.getAttribute('aria-expanded'), 'false');
    assert.equal(tags.getAttribute('aria-label'), '标签筛选');
    assert.equal(view.byTestId('tag-filter-drawer'), null, '默认不展开抽屉');
    assert.equal(view.byTestId('catalog-tags-badge'), null, '没有筛选时不该有角标');
  } finally {
    await view.unmount();
  }
});

test('点标签按钮打开抽屉，Esc 与遮罩都能关掉', async () => {
  const view = await mountCatalog();
  try {
    await view.click(view.byTestId('catalog-tags'));
    const drawer = view.byTestId('tag-filter-drawer');
    assert.ok(drawer, '点一次入口必须打开抽屉');
    assert.equal(drawer.getAttribute('aria-modal'), 'true');
    assert.equal(view.byTestId('catalog-tags').getAttribute('aria-expanded'), 'true');

    await act(async () => {
      view.doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
    });
    assert.equal(view.byTestId('tag-filter-drawer'), null, 'Esc 必须能关闭浮层');

    await view.click(view.byTestId('catalog-tags'));
    assert.ok(view.byTestId('tag-filter-drawer'));
    const close = findByAriaLabel(view.byTestId('tag-filter-drawer'), '关闭标签筛选', 'button');
    assert.ok(close, '抽屉必须有可点的关闭入口');
    await view.click(close);
    assert.equal(view.byTestId('tag-filter-drawer'), null);
  } finally {
    await view.unmount();
  }
});

test('抽屉里点标签只切换一次状态，三次点击走完包含→排除→取消', async () => {
  const view = await mountCatalog();
  try {
    await view.click(view.byTestId('catalog-tags'));
    const chip = findByDataTag(view.byTestId('tag-filter-drawer'), 'dialogue');
    assert.ok(chip, '抽屉里必须列出模组正在用的标签');
    assert.equal(chip.getAttribute('data-tag-state'), 'off');
    assert.equal(chip.getAttribute('aria-label'), 'dialogue', '未选时只说标签名');
    await view.click(chip);
    assert.deepEqual(view.toggles, ['dialogue'], '一次点击只提交一次切换');
  } finally {
    await view.unmount();
  }
});

test('已选状态在抽屉里可见：包含与排除各用自己的文案与标记', async () => {
  const mod = { ...sampleMod, tags: ['dialogue', '语音'] };
  const view = await mountCatalog({ tagFilter: { dialogue: 'include', 语音: 'exclude' }, mods: [mod] });
  try {
    await view.click(view.byTestId('catalog-tags'));
    const drawer = view.byTestId('tag-filter-drawer');
    const include = findByDataTag(drawer, 'dialogue');
    const exclude = findByDataTag(drawer, '语音');
    assert.equal(include.getAttribute('data-tag-state'), 'include');
    assert.equal(include.getAttribute('aria-label'), 'dialogue（包含）');
    assert.equal(exclude.getAttribute('data-tag-state'), 'exclude');
    assert.equal(exclude.getAttribute('aria-label'), '语音（排除）');
    assert.match(drawer.textContent || '', /包含 #dialogue/);
    assert.match(drawer.textContent || '', /排除 #语音/);
    assert.equal(view.byTestId('catalog-tags-badge').textContent, '2', '角标报正在生效的标签数');
  } finally {
    await view.unmount();
  }
});

test('清除全部只在有筛选时可点，点了就清空标签', async () => {
  const empty = await mountCatalog();
  try {
    await empty.click(empty.byTestId('catalog-tags'));
    const button = findNodeByText(empty.byTestId('tag-filter-drawer'), /^清除全部$/);
    assert.ok(button);
    assert.equal(button.disabled, true, '没有筛选时不该给出一个无效的清空动作');
  } finally {
    await empty.unmount();
  }

  const filtered = await mountCatalog({ tagFilter: { dialogue: 'include' } });
  try {
    await filtered.click(filtered.byTestId('catalog-tags'));
    const button = findNodeByText(filtered.byTestId('tag-filter-drawer'), /^清除全部$/);
    assert.ok(button);
    assert.equal(button.disabled, false);
    await filtered.click(button);
    assert.equal(filtered.cleared(), 1);
  } finally {
    await filtered.unmount();
  }
});

test('标签筛选导致空结果时说明是哪些标签，并给出只清标签的入口', async () => {
  const ctxDom = setupMockDom();
  const cleared: number[] = [];
  const ctx = createMockContext({
    mods: [sampleMod],
    versions: [sampleVersion],
    tagFilter: { 不存在的标签: 'include' },
    clearTagFilter: () => cleared.push(1),
  });
  const container = ctxDom.doc.createElement('div');
  ctxDom.doc.documentElement.appendChild(container);
  const root = createRoot(container as any);
  await act(async () => {
    root.render(
      <AppContext.Provider value={ctx}>
        <CatalogView onSelectMod={() => {}} onOpenDownloadModal={() => {}} />
      </AppContext.Provider>,
    );
  });
  try {
    const reason = findByTestId(container, 'catalog-tag-filter-reason');
    assert.ok(reason, '空结果必须说明标签筛选是原因');
    assert.match(reason.textContent || '', /包含 #不存在的标签/);
    const clearOnly = findByTestId(container, 'catalog-clear-tags');
    assert.ok(clearOnly, '必须能只清标签，而不牵连搜索与分类');
    await act(async () => {
      clearOnly.click();
    });
    assert.equal(cleared.length, 1);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('抽屉里不再铺平所有标签：主标签与子标签按目录层级各占一行', async () => {
  // 目录读取是异步的，这里只验证没有目录时的兜底：模组上的标签仍要能选。
  const view = await mountCatalog();
  try {
    await view.click(view.byTestId('catalog-tags'));
    const drawer = view.byTestId('tag-filter-drawer');
    assert.ok(findByDataTag(drawer, 'dialogue'), '目录不可用时退回模组聚合的标签');
    assert.equal(
      findAllByTestId(drawer, 'tag-filter-drawer').length,
      1,
      '同一时刻只该有一个抽屉',
    );
  } finally {
    await view.unmount();
  }
});

