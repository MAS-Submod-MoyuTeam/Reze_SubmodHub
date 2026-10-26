import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

// 事务属于具体实例：启动时的 ListOperations 必须等 ListMASInstances 解析出活动实例之后才发。
// 这里和 App.catalog.test.tsx 一样挂真实 App，把原生 I/O 与视图换成替身，只观察
// “有没有发请求”和“用户看到什么”。
const desktop = fileURLToPath(new URL('../', import.meta.url));
const appSource = await readFile(new URL('./App.tsx', import.meta.url), 'utf8');
const nativeNames = [...appSource.matchAll(/import\s*\{([^}]+)\}\s*from ['"]\.\/wails['"]/g)]
  .flatMap((match) => match[1].split(',').map((name) => name.trim()));
const temporary = await mkdtemp(path.join(desktop, '.app-operations-test-'));
const output = path.join(temporary, 'app.mjs');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./App.tsx', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node', packages: 'external',
  define: { __APP_VERSION__: '"1.0.0"', 'import.meta.env': '{}' },
  plugins: [{ name: 'app-operations-fixture', setup(builder) {
    builder.onResolve({ filter: /\/wails$/ }, () => ({ path: 'native', namespace: 'fixture' }));
    builder.onResolve({ filter: /\/components\// }, (args) => ({ path: args.path, namespace: 'views' }));
    builder.onResolve({ filter: /catalog-api$/ }, () => ({ path: 'catalog', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: args.path === 'native'
      ? nativeNames.map((name) => `export const ${name} = (...args) => globalThis.__operationsTest.native('${name}', ...args);`).join('\n')
      : 'export const fetchPublishedCatalog = (...args) => globalThis.__operationsTest.catalog(...args); export const fetchVerifiedArchive = async () => null;' }));
    builder.onLoad({ filter: /.*/, namespace: 'views' }, (args) => {
      const name = args.path.split('/').at(-1)!;
      return { contents: `export const ${name} = (props) => { globalThis.__operationsTest.views['${name}'] = props; return null; };` };
    });
  } }],
});
await writeFile(output, bundle.outputFiles[0].contents);
const { default: App } = await import(pathToFileURL(output).href);
await rm(temporary, { recursive: true, force: true });

const idleAppUpdate = {
  status: 'idle', current_version: '1.0.0', download_progress: 0, downloaded_bytes: 0,
  total_bytes: 0, can_install: false, requires_user_action: false, requires_install_permission: false,
};

/** 无活动实例、目录无效、可读取三种启动形态共用的 App 挂载夹具。 */
async function fixture(options: { instances: unknown; listOperations: () => Promise<unknown> }) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
  });
  const views: Record<string, any> = {};
  const calls: string[] = [];
  (globalThis as any).__operationsTest = {
    views,
    calls,
    catalog: async () => [],
    native(name: string, ...args: unknown[]) {
      calls.push(name);
      if (name === 'isAndroid') return false;
      if (name === 'ListMASInstances') return Promise.resolve(options.instances);
      if (name === 'ListOperations') return options.listOperations();
      if (name === 'ScanLocalSubmods') return Promise.resolve([]);
      if (name === 'ScanInstalledSpritepacks') return Promise.resolve([]);
      if (name === 'ListInstalledArchives') return Promise.resolve([]);
      if (name === 'ConfirmAppUpdateStartup') return Promise.resolve();
      if (name === 'GetAppUpdateStatus') return Promise.resolve(idleAppUpdate);
      return Promise.resolve({});
    },
  };
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(<App />));
  const settle = async () => { for (let i = 0; i < 5; i += 1) await act(async () => {}); };
  await settle();
  return {
    calls,
    body: () => dom.window.document.body.textContent ?? '',
    async close() {
      await act(async () => root.unmount());
      dom.window.close();
    },
  };
}

/** 旧实现会把这个错误原样弹给用户。 */
const invalidRoot = () => Promise.reject(new Error('invalid_mas_root'));

test('首次启动还没有实例时，不去读取事务，也不报告 MAS 根目录无效', async () => {
  const f = await fixture({ instances: { instances: [], active_id: '' }, listOperations: invalidRoot });
  try {
    assert.equal(f.calls.includes('ListOperations'), false, '没有活动实例时不应发起实例级读取');
    assert.doesNotMatch(f.body(), /事务列表读取失败/);
    assert.doesNotMatch(f.body(), /invalid_mas_root/);
  } finally { await f.close(); }
});

test('活动实例的 MAS 目录无效时，事务读取让位给实例诊断，不弹事务列表失败', async () => {
  const f = await fixture({
    instances: {
      instances: [{
        id: 'mas-1', label: 'MAS', root: 'C:\\MAS',
        status: { valid: false, game_exists: false, diagnostic: 'mas_root_missing' },
      }],
      active_id: 'mas-1',
    },
    listOperations: invalidRoot,
  });
  try {
    assert.equal(f.calls.includes('ListOperations'), false);
    assert.doesNotMatch(f.body(), /事务列表读取失败/);
  } finally { await f.close(); }
});

test('活动实例通过验证后，事务列表照常从后端读取', async () => {
  const f = await fixture({
    instances: {
      instances: [{
        id: 'mas-1', label: 'MAS', root: 'C:\\MAS',
        status: { valid: true, game_exists: true },
      }],
      active_id: 'mas-1',
    },
    listOperations: async () => [],
  });
  try {
    assert.equal(f.calls.filter((name) => name === 'ListOperations').length, 1, '实例就绪后应恰好读取一次事务列表');
    assert.doesNotMatch(f.body(), /事务列表读取失败/);
  } finally { await f.close(); }
});
