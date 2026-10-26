import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

// 启动时商店页的状态只由 App 决定：CatalogView 拿到的 `isCatalogRefreshing` 必须在首屏
// 目录请求落地前就是 true，否则客户端会先闪一帧「未找到符合条件的模组」。
// 这里和 App.update.test.tsx 一样，用真实 App 的 hooks/handler，把原生 I/O 与各视图换成替身。
const desktop = fileURLToPath(new URL('../', import.meta.url));
const appSource = await readFile(new URL('./App.tsx', import.meta.url), 'utf8');
const nativeNames = [...appSource.matchAll(/import\s*\{([^}]+)\}\s*from ['"]\.\/wails['"]/g)]
  .flatMap((match) => match[1].split(',').map((name) => name.trim()));
const temporary = await mkdtemp(path.join(desktop, '.app-catalog-test-'));
const output = path.join(temporary, 'app.mjs');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./App.tsx', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node', packages: 'external',
  define: { __APP_VERSION__: '"1.0.0"', 'import.meta.env': '{}' },
  plugins: [{ name: 'app-catalog-fixture', setup(builder) {
    builder.onResolve({ filter: /\/wails$/ }, () => ({ path: 'native', namespace: 'fixture' }));
    builder.onResolve({ filter: /\/components\// }, (args) => ({ path: args.path, namespace: 'views' }));
    builder.onResolve({ filter: /catalog-api$/ }, () => ({ path: 'catalog', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: args.path === 'native'
      ? nativeNames.map((name) => `export const ${name} = (...args) => globalThis.__catalogTest.native('${name}', ...args);`).join('\n')
      : 'export const fetchPublishedCatalog = (...args) => globalThis.__catalogTest.catalog(...args); export const fetchVerifiedArchive = async () => null;' }));
    builder.onLoad({ filter: /.*/, namespace: 'views' }, (args) => {
      const name = args.path.split('/').at(-1)!;
      return { contents: `export const ${name} = (props) => { globalThis.__catalogTest.views['${name}'] = props; return null; };` };
    });
  } }],
});
await writeFile(output, bundle.outputFiles[0].contents);
const { default: App } = await import(pathToFileURL(output).href);
await rm(temporary, { recursive: true, force: true });

/** 一条后端已发布目录项，形状与 `fetchPublishedCatalog` 的返回一致。 */
const publishedEntry = {
  mod: {
    id: 'mod_1', title: 'Settled Mod', summary: 'summary', description: '',
    author: { id: 'usr_1', display_name: 'Reze' }, category: 'submod',
    tags: ['语音'], supported_platforms: ['windows'], mas_version_range: '>=0.12.0',
    recommended_priority: 0, downloads_count: 3,
  },
  version: { id: 'ver_1', version: '1.0.0', size_bytes: 1024, sha256: 'sha256' },
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

async function fixture(catalog: () => Promise<unknown>) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true });
  const views: Record<string, any> = {};
  (globalThis as any).__catalogTest = { views, catalog, native(name: string) {
    if (name === 'isAndroid') return false;
    if (name === 'ListMASInstances') return Promise.resolve({ instances: [], active_id: '' });
    if (name === 'ListOperations') return Promise.resolve([]);
    if (name === 'ConfirmAppUpdateStartup') return Promise.resolve();
    if (name === 'GetAppUpdateStatus') return Promise.resolve({
      status: 'idle', current_version: '1.0.0', download_progress: 0, downloaded_bytes: 0,
      total_bytes: 0, can_install: false, requires_user_action: false, requires_install_permission: false,
    });
    return Promise.resolve({});
  } };
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(<App />));
  return {
    views,
    catalog: () => views.CatalogView,
    async close() {
      await act(async () => root.unmount());
      dom.window.close();
    },
  };
}

test('the client starts the store page in loading, and only reports a catalog verdict once it lands', async () => {
  const gate = deferred<unknown>();
  const f = await fixture(() => gate.promise);
  try {
    // 首屏：还没有任何目录数据，这一刻只能是「加载中」。
    assert.equal(f.catalog().isCatalogRefreshing, true, 'the first paint must not claim the catalog is loaded');
    assert.equal(f.catalog().catalogError, null);
    assert.deepEqual(f.catalog().mods, []);

    gate.resolve([publishedEntry]);
    await act(async () => {});

    assert.equal(f.catalog().isCatalogRefreshing, false, 'a settled request ends the skeleton state');
    assert.equal(f.catalog().catalogError, null);
    assert.deepEqual(f.catalog().mods.map((mod: { id: string }) => mod.id), ['mod_1']);
  } finally { await f.close(); }
});

test('a failed first load settles into the failure state instead of an endless skeleton', async () => {
  const gate = deferred<unknown>();
  const f = await fixture(() => gate.promise);
  try {
    assert.equal(f.catalog().isCatalogRefreshing, true);

    gate.reject(new Error('catalog_unreachable'));
    await act(async () => {});

    // 失败也要结束骨架：留着骨架就没有重试入口，用户永远等不到结论。
    assert.equal(f.catalog().isCatalogRefreshing, false);
    assert.match(String(f.catalog().catalogError), /catalog_unreachable/);
  } finally { await f.close(); }
});
