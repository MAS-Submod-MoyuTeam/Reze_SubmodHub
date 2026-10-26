import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type { AppUpdateState } from './types/client';

// Exercise App's real hooks and handlers while replacing native I/O and unrelated views.
const desktop = fileURLToPath(new URL('../', import.meta.url));
const appSource = await readFile(new URL('./App.tsx', import.meta.url), 'utf8');
const nativeNames = [...appSource.matchAll(/import\s*\{([^}]+)\}\s*from ['"]\.\/wails['"]/g)]
  .flatMap((match) => match[1].split(',').map((name) => name.trim()));
const temporary = await mkdtemp(path.join(desktop, '.app-update-test-'));
const output = path.join(temporary, 'app.mjs');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./App.tsx', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node', packages: 'external',
  define: { __APP_VERSION__: '"1.0.0"', 'import.meta.env': '{}' },
  plugins: [{ name: 'app-update-native-fixture', setup(builder) {
    builder.onResolve({ filter: /\/wails$/ }, () => ({ path: 'native', namespace: 'fixture' }));
    builder.onResolve({ filter: /\/components\// }, (args) => ({ path: args.path, namespace: 'views' }));
    builder.onResolve({ filter: /catalog-api$/ }, () => ({ path: 'catalog', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: args.path === 'native'
      ? nativeNames.map((name) => `export const ${name} = (...args) => globalThis.__updateTest.native('${name}', ...args);`).join('\n')
      : 'export const fetchPublishedCatalog = async () => []; export const fetchVerifiedArchive = async () => null;' }));
    builder.onLoad({ filter: /.*/, namespace: 'views' }, (args) => {
      const name = args.path.split('/').at(-1)!;
      return { contents: `export const ${name} = (props) => { globalThis.__updateTest.views['${name}'] = props; return null; };` };
    });
  } }],
});
await writeFile(output, bundle.outputFiles[0].contents);
const { default: App } = await import(pathToFileURL(output).href);
await rm(temporary, { recursive: true, force: true });

const state = (status: AppUpdateState['status'], extra = {}): AppUpdateState => ({
  status, current_version: '1.0.0', download_progress: 0, downloaded_bytes: 0, total_bytes: 10,
  can_install: true, requires_user_action: true, requires_install_permission: false, ...extra,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

async function fixture(initial: AppUpdateState, confirm = Promise.resolve()) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true });
  const calls: string[] = [];
  const views: Record<string, any> = {};
  let backend = initial;
  const overrides: Record<string, () => any> = {};
  (globalThis as any).__updateTest = { views, native(name: string) {
    calls.push(name);
    if (overrides[name]) return overrides[name]();
    if (name === 'isAndroid') return false;
    if (name === 'ListMASInstances') return Promise.resolve({ instances: [], active_id: '' });
    if (name === 'ListOperations') return Promise.resolve([]);
    if (name === 'ConfirmAppUpdateStartup') return confirm;
    if (name === 'GetAppUpdateStatus') return Promise.resolve(backend);
    if (name === 'CheckForAppUpdate') return Promise.resolve(state('available'));
    if (name === 'DownloadAppUpdate') { backend = state('downloading'); return Promise.resolve(backend); }
    if (name === 'InstallAppUpdate') { backend = state('awaiting_user'); return Promise.resolve(backend); }
    return Promise.resolve({});
  } };
  const intervals = new Map<number, () => void>();
  const originalSet = globalThis.setInterval;
  const originalClear = globalThis.clearInterval;
  let nextTimer = 0;
  globalThis.setInterval = ((callback: () => void) => {
    const id = ++nextTimer; intervals.set(id, callback); return id;
  }) as any;
  globalThis.clearInterval = ((id: number) => { intervals.delete(id); }) as any;
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(<React.StrictMode><App /></React.StrictMode>));
  return {
    calls, views, overrides, intervals,
    modal: () => views.AppUpdateModal,
    backend: (next: AppUpdateState) => { backend = next; },
    async close() {
      await act(async () => root.unmount());
      globalThis.setInterval = originalSet;
      globalThis.clearInterval = originalClear;
      dom.window.close();
    },
  };
}

test('startup discovers updates once in StrictMode without opening the modal', async () => {
  const f = await fixture(state('idle'));
  try {
    assert.equal(f.calls.filter((name) => name === 'CheckForAppUpdate').length, 1);
    assert.equal(f.modal().updateState.status, 'available');
    assert.equal(f.modal().isOpen, false);
  } finally { await f.close(); }
});

test('startup preserves existing downloads, staged APKs, and installation handoffs', async () => {
  for (const status of ['downloading', 'verifying', 'ready', 'installing', 'awaiting_user'] as const) {
    const f = await fixture(state(status));
    try {
      assert.equal(f.calls.includes('CheckForAppUpdate'), false, status);
      assert.equal(f.modal().updateState.status, status);
      assert.equal(f.modal().isOpen, false);
    } finally { await f.close(); }
  }
});

test('awaiting_user polling recovers a cancelled install to ready and allows retry', async () => {
  const f = await fixture(state('awaiting_user'));
  try {
    assert.equal(f.intervals.size, 1);
    f.backend(state('ready', { error: '用户取消了安装' }));
    await act(async () => { for (const poll of f.intervals.values()) poll(); });
    assert.equal(f.modal().updateState.status, 'ready');
    assert.equal(f.modal().updateState.error, '用户取消了安装');
    assert.equal(f.intervals.size, 0);
    await act(async () => f.modal().onInstallUpdate());
    assert.equal(f.modal().updateState.status, 'awaiting_user');
    assert.equal(f.modal().updateState.error, undefined);
    assert.equal(f.calls.filter((name) => name === 'InstallAppUpdate').length, 1);
  } finally { await f.close(); }
});

test('foreground events and reopening the modal reconcile backend state and permissions', async () => {
  const f = await fixture(state('ready', { error: 'previous failure' }));
  try {
    f.backend(state('ready', { requires_install_permission: true }));
    await act(async () => window.dispatchEvent(new window.Event('focus')));
    assert.equal(f.modal().updateState.requires_install_permission, true);
    assert.equal(f.modal().updateState.error, undefined);
    f.backend(state('ready', { requires_install_permission: false }));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
    assert.equal(f.modal().updateState.requires_install_permission, false);
    f.backend(state('ready', { error: 'returned from installer' }));
    await act(async () => f.views.TitleBar.onOpenAppUpdate());
    assert.equal(f.modal().isOpen, true);
    assert.equal(f.modal().updateState.error, 'returned from installer');
  } finally { await f.close(); }
});

test('late startup check cannot overwrite a user installation handoff', async () => {
  const gate = deferred<void>();
  const f = await fixture(state('idle'), gate.promise);
  try {
    const check = deferred<AppUpdateState>();
    f.overrides.CheckForAppUpdate = () => check.promise;
    await act(async () => gate.resolve());
    f.backend(state('ready'));
    await act(async () => window.dispatchEvent(new window.Event('focus')));
    await act(async () => f.modal().onInstallUpdate());
    check.resolve(state('available'));
    await act(async () => {});
    assert.equal(f.modal().updateState.status, 'awaiting_user');
  } finally { await f.close(); }
});

test('poll and foreground signals share one in-flight status request', async () => {
  const f = await fixture(state('awaiting_user'));
  try {
    const status = deferred<AppUpdateState>();
    f.overrides.GetAppUpdateStatus = () => status.promise;
    const count = f.calls.filter((name) => name === 'GetAppUpdateStatus').length;
    await act(async () => {
      for (const poll of f.intervals.values()) poll();
      window.dispatchEvent(new window.Event('focus'));
      for (const poll of f.intervals.values()) poll();
    });
    assert.equal(f.calls.filter((name) => name === 'GetAppUpdateStatus').length, count + 1);
    status.resolve(state('ready', { error: 'cancelled' }));
    await act(async () => {});
    assert.equal(f.modal().updateState.status, 'ready');
  } finally { await f.close(); }
});

test('late checking snapshot cannot overwrite a completed update check', async () => {
  const f = await fixture(state('available'));
  try {
    const check = deferred<AppUpdateState>();
    const snapshot = deferred<AppUpdateState>();
    f.overrides.CheckForAppUpdate = () => check.promise;
    let pending!: Promise<void>;
    await act(async () => { pending = f.modal().onCheckUpdate(); });
    f.overrides.GetAppUpdateStatus = () => snapshot.promise;
    await act(async () => window.dispatchEvent(new window.Event('focus')));
    check.resolve(state('available'));
    await act(async () => { await pending; });
    snapshot.resolve(state('checking'));
    await act(async () => {});
    assert.equal(f.modal().updateState.status, 'available');
  } finally { await f.close(); }
});

test('late available snapshot cannot stop polling after download starts', async () => {
  const f = await fixture(state('available'));
  try {
    const download = deferred<AppUpdateState>();
    const snapshot = deferred<AppUpdateState>();
    f.overrides.DownloadAppUpdate = () => download.promise;
    let pending!: Promise<void>;
    await act(async () => { pending = f.modal().onDownloadUpdate(); });
    f.overrides.GetAppUpdateStatus = () => snapshot.promise;
    await act(async () => window.dispatchEvent(new window.Event('focus')));
    download.resolve(state('downloading'));
    await act(async () => { await pending; });
    snapshot.resolve(state('available'));
    await act(async () => {});
    assert.equal(f.modal().updateState.status, 'downloading');
    assert.equal(f.intervals.size, 1);
  } finally { await f.close(); }
});

test('late download response cannot overwrite cancellation', async () => {
  const f = await fixture(state('available'));
  try {
    const download = deferred<AppUpdateState>();
    f.overrides.DownloadAppUpdate = () => download.promise;
    f.overrides.CancelAppUpdate = () => state('cancelled');
    let pending!: Promise<void>;
    await act(async () => { pending = f.modal().onDownloadUpdate(); });
    await act(async () => f.modal().onCancelUpdate());
    download.resolve(state('downloading'));
    await act(async () => { await pending; });
    assert.equal(f.modal().updateState.status, 'cancelled');
    assert.equal(f.intervals.size, 0);
  } finally { await f.close(); }
});

test('late downloading snapshot cannot overwrite completed cancellation', async () => {
  const f = await fixture(state('downloading'));
  try {
    const cancellation = deferred<AppUpdateState>();
    const snapshot = deferred<AppUpdateState>();
    f.overrides.CancelAppUpdate = () => cancellation.promise;
    let pending!: Promise<void>;
    await act(async () => { pending = f.modal().onCancelUpdate(); });
    f.overrides.GetAppUpdateStatus = () => snapshot.promise;
    await act(async () => window.dispatchEvent(new window.Event('focus')));
    cancellation.resolve(state('cancelled'));
    await act(async () => { await pending; });
    snapshot.resolve(state('downloading'));
    await act(async () => {});
    assert.equal(f.modal().updateState.status, 'cancelled');
    assert.equal(f.intervals.size, 0);
  } finally { await f.close(); }
});

test('late startup status cannot overwrite a user download', async () => {
  const gate = deferred<void>();
  const f = await fixture(state('idle'), gate.promise);
  try {
    const status = deferred<AppUpdateState>();
    f.overrides.GetAppUpdateStatus = () => status.promise;
    await act(async () => gate.resolve());
    delete f.overrides.GetAppUpdateStatus;
    await act(async () => f.modal().onDownloadUpdate());
    status.resolve(state('idle'));
    await act(async () => {});
    assert.equal(f.modal().updateState.status, 'downloading');
    assert.equal(f.calls.includes('CheckForAppUpdate'), false);
  } finally { await f.close(); }
});
