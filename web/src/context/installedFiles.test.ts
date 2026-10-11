import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOCK_INSTALLED_FILES } from '../data/mockData';
import { InstalledFileList } from '../types/submodhub';

test('mock installed files data conforms to InstalledFileList DTO', () => {
  const extra = MOCK_INSTALLED_FILES['mod_extra_everything'];
  assert.ok(extra);
  assert.equal(extra.mod_id, 'mod_extra_everything');
  assert.equal(extra.managed, true);
  assert.equal(extra.summary.total_files, extra.files.length);
  assert.equal(extra.summary.drifted_files, 1);
  assert.equal(extra.summary.overridden_files, 1);
  assert.equal(extra.summary.active_files, 3);

  // Check individual entries
  const drifted = extra.files.find((f) => f.drifted);
  assert.ok(drifted);
  assert.equal(drifted.path, 'game/Submods/ExtraEverything/user_modified_config.rpy');

  const overridden = extra.files.find((f) => !f.active);
  assert.ok(overridden);
  assert.equal(overridden.path, 'game/Submods/ExtraEverything/overridden_helper.rpy');
});

test('cache isolation by activeInstallationId and modId', () => {
  const cache: Record<string, InstalledFileList> = {};
  const instA = 'inst_mas_1';
  const instB = 'inst_mas_2';
  const modId = 'mod_extra_everything';

  cache[instA + ':' + modId] = { ...MOCK_INSTALLED_FILES[modId], installation_id: instA };
  cache[instB + ':' + modId] = { ...MOCK_INSTALLED_FILES[modId], installation_id: instB };

  assert.equal(cache[instA + ':' + modId].installation_id, instA);
  assert.equal(cache[instB + ':' + modId].installation_id, instB);
  assert.notEqual(cache[instA + ':' + modId], cache[instB + ':' + modId]);
});

test('cache invalidation on mod changes or instance switch', () => {
  let cache: Record<string, InstalledFileList> = {
    'inst_1:mod_a': { ...MOCK_INSTALLED_FILES['mod_extra_everything'], installation_id: 'inst_1' },
    'inst_1:mod_b': { ...MOCK_INSTALLED_FILES['mod_emerald_blossoms'], installation_id: 'inst_1' },
  };

  // Invalidate specific mod
  const targetMod = 'mod_a';
  const next: Record<string, InstalledFileList> = {};
  for (const [k, v] of Object.entries(cache)) {
    if (!k.endsWith(':' + targetMod)) next[k] = v;
  }
  cache = next;
  assert.equal(cache['inst_1:mod_a'], undefined);
  assert.ok(cache['inst_1:mod_b']);

  // Switch instance: clear all
  cache = {};
  assert.equal(Object.keys(cache).length, 0);
});

test('bypassCache fetches fresh data and updates cache', () => {
  const cache: Record<string, InstalledFileList> = {};
  const cacheKey = 'inst_1:mod_extra_everything';

  // Seed stale cache where drifted_files is 0
  const staleData: InstalledFileList = {
    ...MOCK_INSTALLED_FILES['mod_extra_everything'],
    installation_id: 'inst_1',
    summary: {
      ...MOCK_INSTALLED_FILES['mod_extra_everything'].summary,
      drifted_files: 0,
    },
  };
  cache[cacheKey] = staleData;

  // With bypassCache = false, stale cache is returned
  const getFiles = (modId: string, bypassCache = false) => {
    const key = 'inst_1:' + modId;
    if (!bypassCache && cache[key]) {
      return cache[key];
    }
    // Fresh fetch from source
    const fresh = { ...MOCK_INSTALLED_FILES[modId], installation_id: 'inst_1' };
    cache[key] = fresh;
    return fresh;
  };

  assert.equal(getFiles('mod_extra_everything', false).summary.drifted_files, 0);

  // With bypassCache = true, fresh data is fetched and cache is updated
  const updated = getFiles('mod_extra_everything', true);
  assert.equal(updated.summary.drifted_files, 1);
  assert.equal(cache[cacheKey].summary.drifted_files, 1);
});

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useApp } from './AppContext';
import { InstalledFileList as InstalledFileListComp } from '../components/InstalledFileList';
import { InstalledMod } from '../types/submodhub';

test('mounting AppProvider and InstalledFileList invokes query exactly once without infinite loop', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  class MockElement {
    nodeType = 1;
    tagName = 'DIV';
    nodeName = 'DIV';
    childNodes: any[] = [];
    _textContent?: string;
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
      this.dispatchEvent({ type: 'click', bubbles: true, cancelable: true });
    }
    setAttribute(name: string, val: any) {
      this.attributes[name] = String(val);
      if (name === 'title') (this as any).title = String(val);
    }
    removeAttribute(name: string) {
      delete this.attributes[name];
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
    createTextNode(text: string) { return { nodeType: 3, nodeName: '#text', textContent: text, ownerDocument: doc }; },
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
  };
  doc.defaultView = (globalThis as any).window;
  (globalThis as any).document = doc;

  let queryCallCount = 0;
  (globalThis as any).window.DesktopService = {
    ListInstalledModFiles: async (instId: string, modId: string) => {
      queryCallCount++;
      return {
        installation_id: instId,
        mod_id: modId,
        version_id: 'v1',
        version: '1.0.0',
        title: 'Test Mod',
        managed: true,
        installed_at: new Date().toISOString(),
        files: [],
        summary: { total_files: 0, active_files: 0, drifted_files: 0, overridden_files: 0, total_size_bytes: 0 },
      };
    },
  };

  const sampleMod: InstalledMod = {
    id: 'inst_extra',
    mod_id: 'mod_extra_everything',
    title: 'Extra Everything',
    version: '1.2.0',
    category: 'submod',
    is_managed: true,
    installed_at: '2026-09-21T10:00:00Z',
    priority: 20,
  };

  const container = new MockElement();
  container.ownerDocument = doc;
  const root = createRoot(container as any);

  await act(async () => {
    root.render(
      React.createElement(AppProvider, null,
        React.createElement(InstalledFileListComp, { mod: sampleMod, onClose: () => {} })
      )
    );
  });

  // Wait 200ms to allow any potential runaway effects to reveal themselves
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Must be called exactly once upon mount, preventing runaway effect loop
  assert.equal(queryCallCount, 1);

  // Unmount cleanly
  await act(async () => {
    root.unmount();
  });
});

function collectNodeText(node: any): string {
  if (!node) return '';
  return node.textContent || '';
}

test('switching instance prevents out-of-order response overwrite (B returns before A)', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  let resolveA: ((val: any) => void) | null = null;
  let resolveB: ((val: any) => void) | null = null;
  const promiseA = new Promise((res) => { resolveA = res; });
  const promiseB = new Promise((res) => { resolveB = res; });

  (globalThis as any).window.DesktopService = {
    ListInstalledModFiles: async (instId: string, _modId: string) => {
      if (instId === 'inst_mas_1') {
        return promiseA;
      }
      if (instId === 'inst_mas_2') {
        return promiseB;
      }
      return null;
    },
  };

  const sampleMod: InstalledMod = {
    id: 'inst_extra',
    mod_id: 'mod_extra_everything',
    title: 'Extra Everything',
    version: '1.2.0',
    category: 'submod',
    is_managed: true,
    installed_at: '2026-09-21T10:00:00Z',
    priority: 20,
  };

  let switchInstanceFn: (() => void) | null = null;

  const Harness: React.FC = () => {
    const { setActiveInstallationId } = useApp();
    switchInstanceFn = () => {
      setActiveInstallationId('inst_mas_2');
    };
    return React.createElement(InstalledFileListComp, { mod: sampleMod, onClose: () => {} });
  };

  const doc = (globalThis as any).document;
  const container = doc.createElement('div');
  const root = createRoot(container as any);

  // 1. Initial mount on inst_mas_1 -> triggers query A
  await act(async () => {
    root.render(
      React.createElement(AppProvider, null,
        React.createElement(Harness, null)
      )
    );
  });

  // 2. Switch to inst_mas_2 before A completes -> triggers query B
  await act(async () => {
    switchInstanceFn!();
  });

  // 3. Instance B query finishes FIRST
  await act(async () => {
    resolveB!({
      installation_id: 'inst_mas_2',
      mod_id: 'mod_extra_everything',
      version_id: 'v2',
      version: '2.0.0',
      title: 'Extra Everything',
      managed: true,
      installed_at: new Date().toISOString(),
      files: [
        {
          path: 'game/instance_b_file.rpy',
          canonical_path: 'game/instance_b_file.rpy',
          size_bytes: 2048,
          sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          active: true,
          layer_order: 10,
          drifted: false,
          origin_mod_id: 'mod_extra_everything',
        },
      ],
      summary: { total_files: 1, active_files: 1, drifted_files: 0, overridden_files: 0, total_size_bytes: 2048 },
    });
  });

  // UI must show Instance B data
  let text = collectNodeText(container);
  assert.ok(text.includes('game/instance_b_file.rpy'), 'Instance B file must be rendered');
  assert.ok(!text.includes('game/instance_a_file.rpy'), 'Instance A file must not be present');

  // 4. Instance A query finishes LATER
  await act(async () => {
    resolveA!({
      installation_id: 'inst_mas_1',
      mod_id: 'mod_extra_everything',
      version_id: 'v1',
      version: '1.0.0',
      title: 'Extra Everything',
      managed: true,
      installed_at: new Date().toISOString(),
      files: [
        {
          path: 'game/instance_a_file.rpy',
          canonical_path: 'game/instance_a_file.rpy',
          size_bytes: 1024,
          sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          active: true,
          layer_order: 10,
          drifted: false,
          origin_mod_id: 'mod_extra_everything',
        },
      ],
      summary: { total_files: 1, active_files: 1, drifted_files: 0, overridden_files: 0, total_size_bytes: 1024 },
    });
  });

  // UI must STILL show Instance B data, not overwritten by delayed Instance A response
  text = collectNodeText(container);
  assert.ok(text.includes('game/instance_b_file.rpy'), 'Instance B file must still be rendered');
  assert.ok(!text.includes('game/instance_a_file.rpy'), 'Instance A file must NOT overwrite Instance B');

  await act(async () => {
    root.unmount();
  });
});

test('rapid instance switching discards all outdated queries and retains only latest', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

  let resolve1: ((val: any) => void) | null = null;
  let resolve2: ((val: any) => void) | null = null;
  let resolve3: ((val: any) => void) | null = null;
  const promise1 = new Promise((res) => { resolve1 = res; });
  const promise2 = new Promise((res) => { resolve2 = res; });
  const promise3 = new Promise((res) => { resolve3 = res; });

  let callCount = 0;
  (globalThis as any).window.DesktopService = {
    ListInstalledModFiles: async (instId: string, _modId: string) => {
      callCount++;
      if (callCount === 1) return promise1;
      if (callCount === 2) return promise2;
      if (callCount === 3) return promise3;
      return null;
    },
  };

  const sampleMod: InstalledMod = {
    id: 'inst_extra',
    mod_id: 'mod_extra_everything',
    title: 'Extra Everything',
    version: '1.2.0',
    category: 'submod',
    is_managed: true,
    installed_at: '2026-09-21T10:00:00Z',
    priority: 20,
  };

  let setInstFn: ((id: string) => void) | null = null;

  const Harness: React.FC = () => {
    const { setActiveInstallationId } = useApp();
    setInstFn = setActiveInstallationId;
    return React.createElement(InstalledFileListComp, { mod: sampleMod, onClose: () => {} });
  };

  const doc = (globalThis as any).document;
  const container = doc.createElement('div');
  const root = createRoot(container as any);

  // 1. Mount inst_mas_1 -> trigger query 1
  await act(async () => {
    root.render(
      React.createElement(AppProvider, null,
        React.createElement(Harness, null)
      )
    );
  });

  // 2. Switch to inst_mas_2 -> trigger query 2
  await act(async () => {
    setInstFn!('inst_mas_2');
  });

  // 3. Switch back to inst_mas_1 -> trigger query 3
  await act(async () => {
    setInstFn!('inst_mas_1');
  });

  assert.equal(callCount, 3);

  // 4. Resolve query 3 (the latest) first
  await act(async () => {
    resolve3!({
      installation_id: 'inst_mas_1',
      mod_id: 'mod_extra_everything',
      version_id: 'v3',
      version: '3.0.0',
      title: 'Extra Everything',
      managed: true,
      installed_at: new Date().toISOString(),
      files: [
        {
          path: 'game/v3_latest_file.rpy',
          canonical_path: 'game/v3_latest_file.rpy',
          size_bytes: 3072,
          sha256: '3333333333333333333333333333333333333333',
          active: true,
          layer_order: 10,
          drifted: false,
          origin_mod_id: 'mod_extra_everything',
        },
      ],
      summary: { total_files: 1, active_files: 1, drifted_files: 0, overridden_files: 0, total_size_bytes: 3072 },
    });
  });

  let text = collectNodeText(container);
  assert.ok(text.includes('game/v3_latest_file.rpy'), 'Latest v3 file must be rendered');

  // 5. Resolve query 2 and query 1 later
  await act(async () => {
    resolve2!({
      installation_id: 'inst_mas_2',
      mod_id: 'mod_extra_everything',
      version_id: 'v2',
      version: '2.0.0',
      title: 'Extra Everything',
      managed: true,
      installed_at: new Date().toISOString(),
      files: [
        {
          path: 'game/v2_stale_file.rpy',
          canonical_path: 'game/v2_stale_file.rpy',
          size_bytes: 2048,
          sha256: '2222222222222222222222222222222222222222',
          active: true,
          layer_order: 10,
          drifted: false,
          origin_mod_id: 'mod_extra_everything',
        },
      ],
      summary: { total_files: 1, active_files: 1, drifted_files: 0, overridden_files: 0, total_size_bytes: 2048 },
    });
    resolve1!({
      installation_id: 'inst_mas_1',
      mod_id: 'mod_extra_everything',
      version_id: 'v1',
      version: '1.0.0',
      title: 'Extra Everything',
      managed: true,
      installed_at: new Date().toISOString(),
      files: [
        {
          path: 'game/v1_stale_file.rpy',
          canonical_path: 'game/v1_stale_file.rpy',
          size_bytes: 1024,
          sha256: '1111111111111111111111111111111111111111',
          active: true,
          layer_order: 10,
          drifted: false,
          origin_mod_id: 'mod_extra_everything',
        },
      ],
      summary: { total_files: 1, active_files: 1, drifted_files: 0, overridden_files: 0, total_size_bytes: 1024 },
    });
  });

  text = collectNodeText(container);
  assert.ok(text.includes('game/v3_latest_file.rpy'), 'Latest v3 file must still be present');
  assert.ok(!text.includes('game/v2_stale_file.rpy'), 'v2 stale file must NOT overwrite latest');
  assert.ok(!text.includes('game/v1_stale_file.rpy'), 'v1 stale file must NOT overwrite latest');

  await act(async () => {
    root.unmount();
  });
});
