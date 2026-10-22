import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Polyfill import.meta.env in non-Vite environments (e.g. Node.js unit tests)
if (!(import.meta as any).env) {
  (import.meta as any).env = {};
}

import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { AppContext, AppContextType, AppProvider, useApp } from '../context/AppContext';
import { ModDetailModal } from './ModDetailModal';
import { CatalogView } from './CatalogView';
import { ModSummary, ModVersion } from '../types/submodhub';

const sampleMod: ModSummary = {
  id: 'mod_test_1',
  title: '测试模组标题',
  summary: '测试模组简介',
  description: '测试模组详细描述',
  author: { id: 'author_1', display_name: '原作者' },
  category: 'submod',
  tags: ['dialogue'],
  supported_platforms: ['windows', 'android'],
  mas_version_range: '>=0.12.14',
  recommended_priority: 20,
  latest_version_id: 'v1',
  downloads_count: 10,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  is_published: true,
};

const sampleVersion: ModVersion = {
  id: 'v1',
  mod_id: 'mod_test_1',
  version: '1.0.0',
  state: 'published',
  size_bytes: 1024,
  sha256: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  release_notes: '初版发布',
  dependencies: [],
  created_at: '2026-01-01T00:00:00Z',
  is_immutable: true,
};

function createMockContext(overrides: Partial<AppContextType> = {}): AppContextType {
  return {
    refreshWindowText: '1 小时',
    cacheAuthorPage: () => {},
    activeTab: 'catalog',
    setActiveTab: () => {},
    selectedModId: null,
    setSelectedModId: () => {},
    detailModalModId: null,
    setDetailModalModId: () => {},
    currentUser: null,
    switchRolePersona: () => {},
    loginFlarum: async () => false,
    loginGithub: async () => false,
    logout: () => {},
    linkAccount: () => {},
    hasRole: () => false,
    isOffline: false,
    setIsOffline: () => {},
    mods: [sampleMod],
    versions: [sampleVersion],
    scanReports: {},
    auditLogs: [],
    searchQuery: '',
    setSearchQuery: () => {},
    categoryFilter: 'all',
    setCategoryFilter: () => {},
    platformFilter: 'all',
    setPlatformFilter: () => {},
    tagFilter: 'all',
    setTagFilter: () => {},
    getModWithVersions: () => ({ mod: sampleMod, versions: [sampleVersion] }),
    getDownloadDescriptor: async () => ({
      download_id: 'd1',
      version_id: 'v1',
      url: 'https://example.com/dl',
      sha256: 'abc',
      size_bytes: 1024,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      filename: 'submod_v1.zip',
    }),
    createModDraft: async () => '',
    updateModDraft: async () => false,
    syncModReleases: async () => null,
    createCandidateVersion: async () => '',
    uploadArchiveAndScan: async () => '',
    uploadDetailImages: async () => false,
    submitVersionForReview: async () => false,
    setLatestPublishedVersion: async () => {},
    approveSubmission: async () => true,
    rejectSubmission: async () => true,
    publishApprovedVersion: async () => true,
    updateUserRoles: () => {},
    unpublishVersion: async () => {},
    markVersionDeprecated: async () => {},
    clearVersionDeprecation: async () => {},
    deleteVersion: async () => {},
    unpublishMod: async () => true,
    deleteModDraft: async () => {},
    editVersion: async () => false,
    installations: [],
    activeInstallationId: '',
    setActiveInstallationId: () => {},
    getInstalledModFiles: async () => ({} as any),
    clearFileListCache: () => {},
    installedMods: [],
    currentPlan: null,
    operations: [],
    previewInstallPlan: () => ({} as any),
    applyPlan: async () => {},
    simulateExternalChange: () => {},
    adoptUnmanagedMod: () => {},
    clearCurrentPlan: () => {},
    toasts: [],
    showToast: () => {},
    removeToast: () => {},
    ...overrides,
  };
}

// ---------------- DOM Helper for interactive tests ----------------
function setupMockDom() {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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
    eventListeners: Record<string, Function[]> = {};

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
      if (idx !== -1) {
        this.childNodes.splice(idx, 1);
        child.parentNode = null;
      }
      this._textContent = undefined;
      return child;
    }
    insertBefore(newNode: any, refNode: any) {
      const existingIdx = this.childNodes.indexOf(newNode);
      if (existingIdx !== -1) this.childNodes.splice(existingIdx, 1);
      const idx = this.childNodes.indexOf(refNode);
      if (idx === -1) {
        this.childNodes.push(newNode);
      } else {
        this.childNodes.splice(idx, 0, newNode);
      }
      newNode.parentNode = this;
      this._textContent = undefined;
      return newNode;
    }
    addEventListener(event: string, handler: Function) {
      if (!this.eventListeners[event]) this.eventListeners[event] = [];
      this.eventListeners[event].push(handler);
    }
    removeEventListener(event: string, handler: Function) {
      if (this.eventListeners[event]) {
        this.eventListeners[event] = this.eventListeners[event].filter((h: any) => h !== handler);
      }
    }
    dispatchEvent(event: any) {
      event.target = this;
      event.currentTarget = this;
      let curr: any = this;
      while (curr) {
        const handlers = curr.eventListeners[event.type] || [];
        for (const h of handlers) {
          h.call(curr, event);
        }
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

  const doc: any = {
    nodeType: 9,
    nodeName: '#document',
    createElement(tag: string) {
      const el = new MockElement();
      el.tagName = tag.toUpperCase();
      el.nodeName = tag.toUpperCase();
      el.ownerDocument = doc;
      return el;
    },
    createElementNS(_ns: string, tag: string) { return this.createElement(tag); },
    createTextNode(text: string) {
      let val = text;
      return {
        nodeType: 3,
        nodeName: '#text',
        get textContent() { return val; },
        set textContent(v: string) { val = v; },
        get nodeValue() { return val; },
        set nodeValue(v: string) { val = v; },
        get data() { return val; },
        set data(v: string) { val = v; },
        ownerDocument: doc,
      };
    },
    createComment(text: string) { return { nodeType: 8, nodeName: '#comment', textContent: text, ownerDocument: doc }; },
    documentElement: new MockElement(),
    addEventListener() {},
    removeEventListener() {},
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

  return { doc, MockElement };
}

function findNodeByText(root: any, pattern: RegExp | string): any | null {
  const matches = (text: string) =>
    typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text);
  if (root.nodeType === 3 && typeof root.textContent === 'string' && matches(root.textContent)) {
    return root.parentNode;
  }
  // React may optimize a single string child by assigning element.textContent
  // directly instead of creating a text node.
  if (root.nodeType === 1 && root.childNodes.length === 0 && matches(root.textContent || '')) {
    return root;
  }
  for (const child of root.childNodes || []) {
    const found = findNodeByText(child, pattern);
    if (found) return found;
  }
  return null;
}

function findButtonByText(root: any, pattern: RegExp | string): any | null {
  if (root.tagName === 'BUTTON') {
    const text = root.textContent || '';
    if (typeof pattern === 'string' ? text.includes(pattern) : pattern.test(text)) {
      return root;
    }
  }
  for (const child of root.childNodes || []) {
    const found = findButtonByText(child, pattern);
    if (found) return found;
  }
  return null;
}

// ---------------- Tests ----------------

test('admin sees "下架项目" button on published mod, separate from "下架此版本"', () => {
  const ctx = createMockContext({
    currentUser: { id: 'admin_1', username: 'admin', display_name: '管理员', roles: ['admin'], linked_accounts: {} },
    mods: [sampleMod],
    versions: [sampleVersion],
  });

  const markup = renderToStaticMarkup(
    <AppContext.Provider value={ctx}>
      <ModDetailModal modId={sampleMod.id} downloadVersionId={null} onClose={() => {}} onTriggerClientPlan={() => {}} />
    </AppContext.Provider>
  );

  // Both project-level "下架项目" and version-level "下架此版本" are present
  assert.match(markup, /下架项目/);
  assert.match(markup, /下架此版本/);
});

test('non-admin user and anonymous user do not see "下架项目" button', () => {
  // Author user without admin role
  const authorCtx = createMockContext({
    currentUser: { id: 'author_1', username: 'author', display_name: '原作者', roles: ['author'], linked_accounts: {} },
    mods: [sampleMod],
    versions: [sampleVersion],
  });

  const authorMarkup = renderToStaticMarkup(
    <AppContext.Provider value={authorCtx}>
      <ModDetailModal modId={sampleMod.id} downloadVersionId={null} onClose={() => {}} onTriggerClientPlan={() => {}} />
    </AppContext.Provider>
  );
  assert.doesNotMatch(authorMarkup, /下架项目/);
  // Author can still see "下架此版本"
  assert.match(authorMarkup, /下架此版本/);

  // Anonymous visitor
  const visitorCtx = createMockContext({
    currentUser: null,
    mods: [sampleMod],
    versions: [sampleVersion],
  });

  const visitorMarkup = renderToStaticMarkup(
    <AppContext.Provider value={visitorCtx}>
      <ModDetailModal modId={sampleMod.id} downloadVersionId={null} onClose={() => {}} onTriggerClientPlan={() => {}} />
    </AppContext.Provider>
  );
  assert.doesNotMatch(visitorMarkup, /下架项目/);
  assert.doesNotMatch(visitorMarkup, /下架此版本/);
});

test('admin does not see "下架项目" button if mod is already unpublished', () => {
  const unpublishedMod = { ...sampleMod, is_published: false };
  const ctx = createMockContext({
    currentUser: { id: 'admin_1', username: 'admin', display_name: '管理员', roles: ['admin'], linked_accounts: {} },
    mods: [unpublishedMod],
    versions: [sampleVersion],
  });

  const markup = renderToStaticMarkup(
    <AppContext.Provider value={ctx}>
      <ModDetailModal modId={unpublishedMod.id} downloadVersionId={null} onClose={() => {}} onTriggerClientPlan={() => {}} />
    </AppContext.Provider>
  );
  assert.doesNotMatch(markup, /下架项目/);
});

test('admin sees "下架项目" button even when mod has no versions or is a spritepack', () => {
  // Mod with no published versions
  const noVersionsCtx = createMockContext({
    currentUser: { id: 'admin_1', username: 'admin', display_name: '管理员', roles: ['admin'], linked_accounts: {} },
    mods: [sampleMod],
    versions: [],
  });

  const markupNoVersions = renderToStaticMarkup(
    <AppContext.Provider value={noVersionsCtx}>
      <ModDetailModal modId={sampleMod.id} downloadVersionId={null} onClose={() => {}} onTriggerClientPlan={() => {}} />
    </AppContext.Provider>
  );
  assert.match(markupNoVersions, /下架项目/);

  // Spritepack category
  const spritepackMod = { ...sampleMod, category: 'spritepack' as const };
  const spritepackCtx = createMockContext({
    currentUser: { id: 'admin_1', username: 'admin', display_name: '管理员', roles: ['admin'], linked_accounts: {} },
    mods: [spritepackMod],
    versions: [],
  });

  const markupSpritepack = renderToStaticMarkup(
    <AppContext.Provider value={spritepackCtx}>
      <ModDetailModal modId={spritepackMod.id} downloadVersionId={null} onClose={() => {}} onTriggerClientPlan={() => {}} />
    </AppContext.Provider>
  );
  assert.match(markupSpritepack, /下架项目/);
});

test('clicking "下架项目" and cancelling confirmation does not send request or close modal', async () => {
  const { doc } = setupMockDom();

  let unpublishCalled = false;
  let closeCalled = false;
  let confirmMessage = '';

  (globalThis as any).window.confirm = (msg: string) => {
    confirmMessage = msg;
    return false; // User cancels
  };

  const ctx = createMockContext({
    currentUser: { id: 'admin_1', username: 'admin', display_name: '管理员', roles: ['admin'], linked_accounts: {} },
    mods: [sampleMod],
    versions: [sampleVersion],
    unpublishMod: async () => {
      unpublishCalled = true;
      return true;
    },
  });

  const container = doc.createElement('div');
  doc.documentElement.appendChild(container);
  const root = createRoot(container as any);

  await act(async () => {
    root.render(
      <AppContext.Provider value={ctx}>
        <ModDetailModal
          modId={sampleMod.id}
          downloadVersionId={null}
          onClose={() => { closeCalled = true; }}
          onTriggerClientPlan={() => {}}
        />
      </AppContext.Provider>
    );
  });

  const btn = findButtonByText(container, /下架项目/);
  assert.ok(btn, 'unpublish mod button should be found');

  await act(async () => {
    btn.click();
  });

  assert.match(confirmMessage, /测试模组标题/);
  assert.match(confirmMessage, /公开目录隐藏/);
  assert.match(confirmMessage, /版本/);
  assert.match(confirmMessage, /保留/);
  assert.equal(unpublishCalled, false, 'unpublishMod should not be called when user cancels confirm');
  assert.equal(closeCalled, false, 'onClose should not be called when user cancels confirm');

  await act(async () => {
    root.unmount();
  });
});

test('clicking "下架项目" and confirming: success closes modal; failure preserves modal and restores button', async () => {
  const { doc } = setupMockDom();

  let unpublishCallCount = 0;
  let closeCalled = false;
  let shouldSucceed = true;
  let resolveUnpublish: ((val: boolean) => void) | null = null;

  (globalThis as any).window.confirm = () => true;

  const ctx = createMockContext({
    currentUser: { id: 'admin_1', username: 'admin', display_name: '管理员', roles: ['admin'], linked_accounts: {} },
    mods: [sampleMod],
    versions: [sampleVersion],
    unpublishMod: async (modId: string) => {
      unpublishCallCount++;
      assert.equal(modId, sampleMod.id);
      return new Promise<boolean>((resolve) => {
        resolveUnpublish = resolve;
      });
    },
  });

  const container = doc.createElement('div');
  doc.documentElement.appendChild(container);
  const root = createRoot(container as any);

  await act(async () => {
    root.render(
      <AppContext.Provider value={ctx}>
        <ModDetailModal
          modId={sampleMod.id}
          downloadVersionId={null}
          onClose={() => { closeCalled = true; }}
          onTriggerClientPlan={() => {}}
        />
      </AppContext.Provider>
    );
  });

  const btn = findButtonByText(container, /下架项目/);
  assert.ok(btn, 'unpublish mod button should be found');

  // 1. Trigger unpublish: in-flight state verification
  await act(async () => {
    btn.click();
    await Promise.resolve();
  });

  // Verify in-flight: button is disabled and text shows processing
  assert.equal(btn.disabled, true, 'button must be disabled during unpublish in-flight');
  assert.match(btn.textContent, /正在下架项目|处理中/);

  // Attempt duplicate click while in-flight
  btn.click();
  assert.equal(unpublishCallCount, 1, 'must not trigger duplicate request while in-flight');

  // Resolve with FAILURE first
  await act(async () => {
    resolveUnpublish!(false);
  });

  assert.equal(closeCalled, false, 'modal should NOT close on failure');
  assert.equal(btn.disabled, false, 'button must be re-enabled after failure');
  assert.match(btn.textContent, /下架项目/);

  // 2. Trigger again, resolve with SUCCESS
  await act(async () => {
    btn.click();
    await Promise.resolve();
  });

  assert.equal(btn.disabled, true);
  await act(async () => {
    resolveUnpublish!(true);
  });

  assert.equal(closeCalled, true, 'modal must close on success');

  await act(async () => {
    root.unmount();
  });
});

test('stale unpublish request of mod A does not close modal when user switches to mod B', async () => {
  const { doc } = setupMockDom();

  const modA: ModSummary = { ...sampleMod, id: 'mod_a', title: '模组 A' };
  const modB: ModSummary = { ...sampleMod, id: 'mod_b', title: '模组 B' };

  let resolveUnpublishA: ((ok: boolean) => void) | null = null;
  let closeCallCount = 0;

  (globalThis as any).window.confirm = () => true;

  const ctx = createMockContext({
    currentUser: { id: 'admin_1', username: 'admin', display_name: '管理员', roles: ['admin'], linked_accounts: {} },
    mods: [modA, modB],
    versions: [
      { ...sampleVersion, mod_id: 'mod_a', id: 'v_a' },
      { ...sampleVersion, mod_id: 'mod_b', id: 'v_b' },
    ],
    unpublishMod: async (modId: string) => {
      if (modId === 'mod_a') {
        return new Promise<boolean>((resolve) => {
          resolveUnpublishA = resolve;
        });
      }
      return true;
    },
  });

  const container = doc.createElement('div');
  doc.documentElement.appendChild(container);
  const root = createRoot(container as any);

  // 1. Open modal for Mod A
  await act(async () => {
    root.render(
      <AppContext.Provider value={ctx}>
        <ModDetailModal
          modId="mod_a"
          downloadVersionId={null}
          onClose={() => { closeCallCount++; }}
          onTriggerClientPlan={() => {}}
        />
      </AppContext.Provider>
    );
  });

  // 2. Admin clicks "下架项目" on Mod A (in-flight)
  const btnA = findButtonByText(container, /下架项目/);
  assert.ok(btnA);
  await act(async () => {
    btnA.click();
    await Promise.resolve();
  });
  assert.ok(resolveUnpublishA, 'unpublishMod for A should have been called');

  // 3. User closes A and switches to Mod B
  await act(async () => {
    root.render(
      <AppContext.Provider value={ctx}>
        <ModDetailModal
          modId="mod_b"
          downloadVersionId={null}
          onClose={() => { closeCallCount++; }}
          onTriggerClientPlan={() => {}}
        />
      </AppContext.Provider>
    );
  });

  // Reset close counter before resolving A
  closeCallCount = 0;

  // 4. Mod A's unpublish request completes with success
  await act(async () => {
    resolveUnpublishA!(true);
  });

  // 5. Assert that onClose was NOT called (Mod B remains open!)
  assert.equal(closeCallCount, 0, 'stale request of mod A must not call onClose for mod B');

  // 6. Mod B's own unpublish button must not stay stuck in A's in-flight state.
  const btnB = findButtonByText(container, /下架项目/);
  assert.ok(btnB, 'mod B unpublish button should still be rendered');
  assert.equal(btnB.disabled, false, 'mod B button must not inherit mod A in-flight state');
  assert.match(btnB.textContent, /下架项目/);

  await act(async () => {
    root.unmount();
  });
});

test('stale unpublish request does not invoke onClose after modal unmounts', async () => {
  const { doc } = setupMockDom();

  let resolveUnpublish: ((ok: boolean) => void) | null = null;
  let closeCallCount = 0;

  (globalThis as any).window.confirm = () => true;

  const ctx = createMockContext({
    currentUser: { id: 'admin_1', username: 'admin', display_name: '管理员', roles: ['admin'], linked_accounts: {} },
    mods: [sampleMod],
    versions: [sampleVersion],
    unpublishMod: async () => {
      return new Promise<boolean>((resolve) => {
        resolveUnpublish = resolve;
      });
    },
  });

  const container = doc.createElement('div');
  doc.documentElement.appendChild(container);
  const root = createRoot(container as any);

  await act(async () => {
    root.render(
      <AppContext.Provider value={ctx}>
        <ModDetailModal
          modId={sampleMod.id}
          downloadVersionId={null}
          onClose={() => { closeCallCount++; }}
          onTriggerClientPlan={() => {}}
        />
      </AppContext.Provider>
    );
  });

  const btn = findButtonByText(container, /下架项目/);
  assert.ok(btn);
  await act(async () => {
    btn.click();
    await Promise.resolve();
  });

  // Unmount modal while request is still pending
  await act(async () => {
    root.unmount();
  });

  closeCallCount = 0;

  // Resolve pending request
  await act(async () => {
    resolveUnpublish!(true);
  });

  assert.equal(closeCallCount, 0, 'unmounted modal must not invoke onClose');
});

// ---------------- Integration Tests with real AppProvider ----------------

const FullIntegrationApp: React.FC = () => {
  const { detailModalModId, setDetailModalModId, toasts, mods } = useApp();
  return (
    <div>
      <CatalogView
        onSelectMod={(id) => setDetailModalModId(id)}
        onOpenDownloadModal={() => {}}
      />
      {detailModalModId && (
        <ModDetailModal
          modId={detailModalModId}
          downloadVersionId={null}
          onClose={() => setDetailModalModId(null)}
          onTriggerClientPlan={() => {}}
        />
      )}
      <div id="mods-state">
        {mods.map((mod) => `${mod.id}:${mod.is_published ? 'published' : 'unpublished'}`).join(',')}
      </div>
      <div id="toast-log">
        {toasts.map((t) => `[${t.type}]: ${t.message}`).join('; ')}
      </div>
    </div>
  );
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface CatalogFetchMock {
  restore: () => void;
  calls: string[];
}

// Minimal backend used by the real AppProvider integration tests. The catalog
// endpoints must match the exact response shapes consumed by ui/catalog-api.ts:
// GET /mods returns CatalogMod items, then each mod's published version is
// fetched individually, and /versions returns { items }.
function installCatalogFetchMock(handleUnpublish: (url: string) => Response): CatalogFetchMock {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method || 'GET';
    calls.push(`${method} ${url}`);
    const path = new URL(url, 'http://localhost').pathname;

    if (path === '/api/v1/session') {
      return jsonResponse({
        user: { id: 'admin_1', username: 'admin', display_name: '管理员' },
        roles: ['admin'],
        csrf_token: 'csrf_123',
      });
    }
    if (path === '/api/v1/mods/mod_test_1/images') {
      return jsonResponse({ items: [] });
    }
    if (path === '/api/v1/mods/mod_test_1/versions/v1') {
      return jsonResponse(sampleVersion);
    }
    if (path === '/api/v1/mods/mod_test_1/versions') {
      return jsonResponse({ items: [sampleVersion] });
    }
    if (path === '/api/v1/mods') {
      return jsonResponse({ items: [sampleMod] });
    }
    if (path === '/api/v1/author/mods/mod_test_1/unpublish') {
      return handleUnpublish(url);
    }
    if (path === '/api/v1/author/mods') {
      return jsonResponse({ items: [] });
    }
    if (path.startsWith('/api/v1/review/') || path === '/api/v1/author/submissions') {
      return jsonResponse({ items: [] });
    }
    return jsonResponse({});
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

async function waitForCondition(
  check: () => boolean,
  message: string,
  timeoutMs = 2000,
  describe?: () => string,
): Promise<void> {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) {
      assert.fail(describe ? `${message} | ${describe()}` : message);
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}


test('integration: real AppProvider unpublishMod updates mods state, closes modal, and removes card from CatalogView on API success', async () => {
  const { doc } = setupMockDom();
  const fetchMock = installCatalogFetchMock(() => jsonResponse({ id: 'mod_test_1', unpublished: true }));

  (globalThis as any).window.confirm = () => true;

  const container = doc.createElement('div');
  doc.documentElement.appendChild(container);
  const root = createRoot(container as any);

  try {
    // Mount real AppProvider with FullIntegrationApp
    await act(async () => {
      root.render(
        <AppProvider>
          <FullIntegrationApp />
        </AppProvider>
      );
    });

    // Wait for the real catalog fetch (mods + versions) to update context state
    await waitForCondition(
      () => Boolean(findNodeByText(container, 'mod_test_1:published')),
      'AppProvider should load the published catalog',
      2000,
      () => `text=${container.textContent}; calls=${fetchMock.calls.join(' | ')}`,
    );
    const modTitleNode = findNodeByText(container, '测试模组标题');
    assert.ok(modTitleNode, 'catalog should display the published mod card');

    // Click on the card to open ModDetailModal
    await act(async () => {
      modTitleNode.click();
      await Promise.resolve();
    });

    // ModDetailModal is now visible with "下架项目" button
    const unpublishBtn = findButtonByText(container, /下架项目/);
    assert.ok(unpublishBtn, 'admin must see "下架项目" button in the opened detail modal');

    // Click "下架项目" and execute real AppProvider.unpublishMod flow
    await act(async () => {
      unpublishBtn.click();
    });

    // 1. Verify real network request was sent
    assert.ok(
      fetchMock.calls.includes('POST /api/v1/author/mods/mod_test_1/unpublish'),
      `unpublish request must be sent, got: ${fetchMock.calls.join(' | ')}`,
    );

    // 2. Verify real context state flipped to unpublished
    await waitForCondition(
      () => Boolean(findNodeByText(container, 'mod_test_1:unpublished')),
      'AppProvider.mods must mark the mod as unpublished',
    );

    // 3. Verify modal closed
    assert.equal(findButtonByText(container, /下架项目/), null, 'detail modal must be closed after successful unpublish');

    // 4. Verify success toast was displayed by real AppProvider
    assert.ok(
      findNodeByText(container, /模组已从公开目录下架；版本、归档和详情图均已保留/),
      'success toast must be shown',
    );

    // 5. Verify CatalogView immediately removed the card (filtered by is_published)
    assert.equal(findNodeByText(container, '测试模组标题'), null, 'card must disappear from CatalogView after unpublish');
  } finally {
    await act(async () => {
      root.unmount();
    });
    fetchMock.restore();
  }
});

test('integration: real AppProvider unpublishMod preserves is_published, keeps modal and CatalogView card, and shows toast on API error', async () => {
  const { doc } = setupMockDom();
  const fetchMock = installCatalogFetchMock(() =>
    jsonResponse({ code: 'storage_error', message: '磁盘故障，持久化被拒绝' }, 500),
  );

  (globalThis as any).window.confirm = () => true;

  const container = doc.createElement('div');
  doc.documentElement.appendChild(container);
  const root = createRoot(container as any);

  try {
    await act(async () => {
      root.render(
        <AppProvider>
          <FullIntegrationApp />
        </AppProvider>
      );
    });

    await waitForCondition(
      () => Boolean(findNodeByText(container, 'mod_test_1:published')),
      'AppProvider should load the published catalog',
      2000,
      () => `text=${container.textContent}; calls=${fetchMock.calls.join(' | ')}`,
    );
    const modTitleNode = findNodeByText(container, '测试模组标题');
    assert.ok(modTitleNode, 'catalog should display the published mod card');

    await act(async () => {
      modTitleNode.click();
      await Promise.resolve();
    });

    const unpublishBtn = findButtonByText(container, /下架项目/);
    assert.ok(unpublishBtn);

    // Click "下架项目", trigger API error 500
    await act(async () => {
      unpublishBtn.click();
    });

    // 1. Verify error toast was displayed and carried the server error code
    await waitForCondition(
      () => Boolean(findNodeByText(container, /模组下架失败/)),
      'error toast must be shown',
    );
    const toastNode = findNodeByText(container, /模组下架失败/);
    assert.ok(toastNode);
    assert.match(toastNode.textContent, /storage_error/);

    // 2. Verify real context state was NOT changed to unpublished
    assert.ok(
      findNodeByText(container, 'mod_test_1:published'),
      'AppProvider.mods must keep is_published true when unpublish fails',
    );
    assert.equal(findNodeByText(container, 'mod_test_1:unpublished'), null);

    // 3. Verify modal is NOT closed and the button is usable again
    const unpublishBtnAfter = findButtonByText(container, /下架项目/);
    assert.ok(unpublishBtnAfter, 'detail modal must remain open on failure');
    await waitForCondition(
      () => {
        const current = findButtonByText(container, /下架项目/);
        return Boolean(current) && current.disabled === false;
      },
      'button must be re-enabled after failure',
    );

    // 4. Verify CatalogView still displays the card (state is_published was NOT changed to false)
    assert.ok(findNodeByText(container, '测试模组标题'), 'card must still be present in catalog when unpublish fails');
  } finally {
    await act(async () => {
      root.unmount();
    });
    fetchMock.restore();
  }
});

