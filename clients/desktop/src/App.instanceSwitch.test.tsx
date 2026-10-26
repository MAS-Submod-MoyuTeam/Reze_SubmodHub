import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

// 切换实例是整屏级别的数据替换：切换返回之前屏幕上还是旧实例的模组、精灵包与事务。
// 这里和 App.operationsStartup.test.tsx 一样挂真实 App，只把原生 I/O 与业务视图换成替身，
// 并且保留真实的切换覆盖层组件，用来观察「冻结什么、显示什么、什么时候解除」。
const desktop = fileURLToPath(new URL('../', import.meta.url));
const appSource = await readFile(new URL('./App.tsx', import.meta.url), 'utf8');
const nativeNames = [...appSource.matchAll(/import\s*\{([^}]+)\}\s*from ['"]\.\/wails['"]/g)]
  .flatMap((match) => match[1].split(',').map((name) => name.trim()));
const temporary = await mkdtemp(path.join(desktop, '.app-instance-switch-test-'));
const output = path.join(temporary, 'app.mjs');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./App.tsx', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node', packages: 'external',
  define: { __APP_VERSION__: '"1.0.0"', 'import.meta.env': '{}' },
  plugins: [{ name: 'app-instance-switch-fixture', setup(builder) {
    builder.onResolve({ filter: /\/wails$/ }, () => ({ path: 'native', namespace: 'fixture' }));
    // 覆盖层要真的渲染出来，才能在 DOM 上验证冻结与提示；其余视图照旧换成替身。
    builder.onResolve({ filter: /\/components\/InstanceSwitchOverlay$/ }, () => ({
      path: path.join(desktop, 'src', 'components', 'InstanceSwitchOverlay.tsx'),
    }));
    builder.onResolve({ filter: /\/components\// }, (args) => ({ path: args.path, namespace: 'views' }));
    builder.onResolve({ filter: /catalog-api$/ }, () => ({ path: 'catalog', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: args.path === 'native'
      ? nativeNames.map((name) => `export const ${name} = (...args) => globalThis.__switchTest.native('${name}', ...args);`).join('\n')
      : 'export const fetchPublishedCatalog = async () => []; export const fetchVerifiedArchive = async () => null;' }));
    builder.onLoad({ filter: /.*/, namespace: 'views' }, (args) => {
      const name = args.path.split('/').at(-1)!;
      return { contents: `export const ${name} = (props) => { globalThis.__switchTest.views['${name}'] = props; return null; };` };
    });
  } }],
});
await writeFile(output, bundle.outputFiles[0].contents);
const { default: App } = await import(pathToFileURL(output).href);
await rm(temporary, { recursive: true, force: true });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

const idleAppUpdate = {
  status: 'idle', current_version: '1.0.0', download_progress: 0, downloaded_bytes: 0,
  total_bytes: 0, can_install: false, requires_user_action: false, requires_install_permission: false,
};

const instance = (id: string, label: string) => ({
  id, label, root: `C:\\${id}`,
  status: { valid: true, game_exists: true },
});

/** 两个实例：mas-1 是启动时的活动实例，mas-2 是用户要切过去的目标。 */
const twoInstances = { instances: [instance('mas-1', 'MAS 一号'), instance('mas-2', 'MAS 二号')], active_id: 'mas-1' };
const switchedToMasTwo = { instances: [instance('mas-1', 'MAS 一号'), instance('mas-2', 'MAS 二号')], active_id: 'mas-2' };

async function fixture(options: {
  instances?: unknown;
  selectInstance?: (id: string) => Promise<unknown>;
  scanSubmods?: () => Promise<unknown>;
}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
  });
  const views: Record<string, any> = {};
  (globalThis as any).__switchTest = {
    views,
    native(name: string) {
      if (name === 'isAndroid') return false;
      if (name === 'ListMASInstances') return Promise.resolve(options.instances ?? twoInstances);
      if (name === 'ListOperations') return Promise.resolve([]);
      if (name === 'ListInstalledArchives') return Promise.resolve([]);
      if (name === 'ScanLocalSubmods') return options.scanSubmods ? options.scanSubmods() : Promise.resolve([]);
      if (name === 'ScanInstalledSpritepacks') return Promise.resolve([]);
      if (name === 'SelectMASInstance') return options.selectInstance ? options.selectInstance(String(arguments[1])) : Promise.resolve(switchedToMasTwo);
      if (name === 'ConfirmAppUpdateStartup') return Promise.resolve();
      if (name === 'GetAppUpdateStatus') return Promise.resolve(idleAppUpdate);
      return Promise.resolve({});
    },
  };
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(<App />));
  const settle = async () => { for (let i = 0; i < 5; i += 1) await act(async () => {}); };
  await settle();
  const overlay = () => dom.window.document.querySelector('[data-testid="instance-switch-overlay"]');
  const frozen = () => dom.window.document.querySelector('[inert]');
  return {
    views,
    overlay,
    frozen,
    settle,
    select: async (id: string) => {
      await act(async () => { void views.TitleBar.onSelectInstallation(id); });
    },
    body: () => dom.window.document.body.textContent ?? '',
    async close() {
      await act(async () => root.unmount());
      dom.window.close();
    },
  };
}

test('切换实例时冻结整屏并显示加载提示，直到新实例的读取落定', async () => {
  const select = deferred<unknown>();
  const submods = deferred<unknown>();
  let scanGate: Promise<unknown> | null = null;
  const f = await fixture({
    selectInstance: () => select.promise,
    scanSubmods: () => (scanGate ?? Promise.resolve([])),
  });
  try {
    assert.equal(f.overlay(), null, '空闲时不应有切换覆盖层');
    assert.equal(f.frozen(), null, '空闲时界面不应被冻结');

    await f.select('mas-2');

    // 切换请求还在路上：整屏已经冻结，并说明切到哪个实例。
    assert.ok(f.overlay(), '切换开始后应出现全窗口覆盖层');
    assert.match(f.overlay()!.textContent ?? '', /正在切换到「MAS 二号」/);
    assert.match(f.overlay()!.textContent ?? '', /正在读取该实例的模组、精灵包与事务记录/);
    // 冻结期间唯一可读的状态就是这个 live region。
    assert.equal(f.overlay()!.getAttribute('role'), 'status');
    assert.equal(f.overlay()!.getAttribute('aria-live'), 'polite');
    assert.ok(f.frozen(), '切换期间背景界面应被冻结');
    assert.equal(f.frozen()!.getAttribute('aria-busy'), 'true');

    // 后端已经切换完成，但新实例的本地模组读取还没落定：冻结必须继续。
    scanGate = submods.promise;
    await act(async () => { select.resolve(switchedToMasTwo); });
    await f.settle();
    assert.ok(f.overlay(), '新实例的数据尚未就绪时不应提前解除冻结');

    submods.resolve([]);
    await f.settle();

    assert.equal(f.overlay(), null, '数据就绪后覆盖层应消失');
    assert.equal(f.frozen(), null, '数据就绪后界面应恢复可交互');
  } finally { await f.close(); }
});

test('切换失败时解除冻结并保留可恢复的错误提示', async () => {
  const select = deferred<unknown>();
  const f = await fixture({ selectInstance: () => select.promise });
  try {
    await f.select('mas-2');
    assert.ok(f.overlay());

    await act(async () => { select.reject(new Error('mas_instance_not_found')); });
    await f.settle();

    assert.equal(f.overlay(), null, '失败后不应把用户锁在冻结界面里');
    assert.equal(f.frozen(), null);
    assert.match(f.body(), /切换实例失败：mas_instance_not_found/);
  } finally { await f.close(); }
});
