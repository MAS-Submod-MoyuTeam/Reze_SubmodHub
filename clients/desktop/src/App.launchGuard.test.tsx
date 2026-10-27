import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

// 事务进行时启动游戏必须被拦住，并且拦截原因要说清楚：这里挂真实 App，
// 把原生 I/O 与视图换成替身，只观察「TitleBar 收到什么围栏状态」和
// 「点了启动会发生什么」。
const desktop = fileURLToPath(new URL('../', import.meta.url));
const appSource = await readFile(new URL('./App.tsx', import.meta.url), 'utf8');
const nativeNames = [...appSource.matchAll(/import\s*\{([^}]+)\}\s*from ['"]\.\/wails['"]/g)]
  .flatMap((match) => match[1].split(',').map((name) => name.trim()));
const temporary = await mkdtemp(path.join(desktop, '.app-launch-guard-test-'));
const output = path.join(temporary, 'app.mjs');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./App.tsx', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node', packages: 'external',
  define: { __APP_VERSION__: '"1.0.0"', 'import.meta.env': '{}' },
  plugins: [{ name: 'app-launch-guard-fixture', setup(builder) {
    builder.onResolve({ filter: /\/wails$/ }, () => ({ path: 'native', namespace: 'fixture' }));
    builder.onResolve({ filter: /\/components\// }, (args) => ({ path: args.path, namespace: 'views' }));
    builder.onResolve({ filter: /catalog-api$/ }, () => ({ path: 'catalog', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: args.path === 'native'
      ? nativeNames.map((name) => `export const ${name} = (...args) => globalThis.__launchGuardTest.native('${name}', ...args);`).join('\n')
      : 'export const fetchPublishedCatalog = (...args) => globalThis.__launchGuardTest.catalog(...args); export const fetchVerifiedArchive = async () => null;' }));
    builder.onLoad({ filter: /.*/, namespace: 'views' }, (args) => {
      const name = args.path.split('/').at(-1)!;
      return { contents: `export const ${name} = (props) => { globalThis.__launchGuardTest.views['${name}'] = props; return null; };` };
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

const validInstances = {
  instances: [{ id: 'mas-1', label: 'MAS', root: 'C:\\MAS', status: { valid: true, game_exists: true } }],
  active_id: 'mas-1',
};

/** 稳定的事务记录夹具：只有 state 影响启动围栏。 */
function operation(state: string) {
  return {
    operation_id: `op_${state}`,
    installation_id: 'mas-1',
    kind: 'install',
    state,
    phase: state,
    can_rollback: state === 'recoverable',
    progress: { stage: '', current_file: '', processed_files: 0, total_files: 0, percent: 0 },
  };
}

async function fixture(options: {
  operations: () => Promise<unknown>;
  launch?: (id: string) => Promise<void>;
}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
  });
  const views: Record<string, any> = {};
  const launched: string[] = [];
  const launch = options.launch ?? (async () => {});
  (globalThis as any).__launchGuardTest = {
    views,
    catalog: async () => [],
    native(name: string, ...args: unknown[]) {
      if (name === 'isAndroid') return false;
      if (name === 'ListMASInstances') return Promise.resolve(validInstances);
      if (name === 'ListOperations') return options.operations();
      if (name === 'LaunchMASInstance') {
        launched.push(String(args[0]));
        return launch(String(args[0]));
      }
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
    views,
    launched,
    settle,
    body: () => dom.window.document.body.textContent ?? '',
    launchGame: async () => {
      await act(async () => { await views.TitleBar.onLaunchGame(); });
      await settle();
    },
    async close() {
      await act(async () => root.unmount());
      dom.window.close();
    },
  };
}

test('没有事务时启动入口保持可用', async () => {
  const f = await fixture({ operations: async () => [] });
  try {
    assert.equal(f.views.TitleBar.isTransactionActive, false);
    await f.launchGame();
    assert.deepEqual(f.launched, ['mas-1']);
  } finally { await f.close(); }
});

test('事务正在应用（recoverable）时启动入口被围栏拦截', async () => {
  const f = await fixture({ operations: async () => [operation('recoverable')] });
  try {
    assert.equal(f.views.TitleBar.isTransactionActive, true);
    await f.launchGame();
    assert.deepEqual(f.launched, [], '事务进行中不得调用 LaunchMASInstance');
    assert.match(f.body(), /事务进行中，游戏启动已被阻止/);
  } finally { await f.close(); }
});

test('计划已确认但尚未落 journal（planned）同样算事务进行中', async () => {
  const f = await fixture({ operations: async () => [operation('planned')] });
  try {
    assert.equal(f.views.TitleBar.isTransactionActive, true);
  } finally { await f.close(); }
});

test('已提交/已回滚/需人工恢复的事务不再阻止启动游戏', async () => {
  for (const state of ['committed', 'rolled_back', 'needs_manual_recovery', 'query_failed']) {
    const f = await fixture({ operations: async () => [operation(state)] });
    try {
      assert.equal(f.views.TitleBar.isTransactionActive, false, `${state} 不应阻止启动`);
    } finally { await f.close(); }
  }
});

test('后端拒绝启动时按稳定错误码给出阻止原因，而不是原始错误码', async () => {
  const f = await fixture({
    operations: async () => [],
    launch: async () => { throw new Error('transaction_in_progress'); },
  });
  try {
    await f.launchGame();
    assert.deepEqual(f.launched, ['mas-1']);
    assert.match(f.body(), /事务进行中，游戏启动已被阻止/);
    assert.doesNotMatch(f.body(), /启动失败：transaction_in_progress/);
  } finally { await f.close(); }
});
