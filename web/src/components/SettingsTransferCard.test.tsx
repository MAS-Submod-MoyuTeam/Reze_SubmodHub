/**
 * 导出 / 导入按钮必须真的打到端点上。
 *
 * 这里钉的是「接线」这一类错误：`ui/` 里的纯函数全绿、类型检查也过，但按钮
 * onClick 没接、CSRF 没带、或者解析完忘了弹确认条——只有组件级点击能抓到。
 */
import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { LangProvider } from '../i18n';
import { SettingsTransferCard } from './SettingsTransferCard';
import type { SiteSettings } from '../../../ui/settings-api';

const settings = (): SiteSettings => ({
  github_proxy_template: '',
  github_token_configured: false,
  github_token_encrypted: false,
  github_token_hint: '',
  github_sync_max_age: '1h0m0s',
  github_sync_max_age_locked: false,
  tag_catalog: [{ name: '工具' }],
  master_key_configured: true,
  revision: 12,
});

const transferDocument = (overrides: Record<string, unknown> = {}) => ({
  format: 'submodhub-settings',
  version: 1,
  exported_at: '2026-11-12T02:15:32Z',
  settings: {
    github_proxy_template: '100.106.239.85:7890',
    github_sync_max_age: '',
    tag_catalog: [{ name: '工具', children: [{ name: '绘图' }] }, { name: '音乐' }],
  },
  download_nodes: [{ id: 'cloudreve-dcc', type: 'cloudreve', credential_configured: true }],
  ...overrides,
});

function mount(options: { onImported?: (updated: SiteSettings) => void; onConflict?: () => void } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = {
    window: globals.window,
    document: globals.document,
    IS_REACT_ACT_ENVIRONMENT: globals.IS_REACT_ACT_ENVIRONMENT,
    fetch: globals.fetch,
  };
  globals.window = dom.window;
  globals.document = dom.window.document;
  globals.IS_REACT_ACT_ENVIRONMENT = true;

  const requests: Array<{ url: string; method: string; csrf: string | null; body: string }> = [];
  const toasts: Array<{ type: string; message: string }> = [];
  const imported: SiteSettings[] = [];
  let importStatus: { status: number; code: string } | null = null;

  globals.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({
      url,
      method,
      csrf: new Headers(init?.headers).get('X-CSRF-Token'),
      body: String(init?.body ?? ''),
    });
    if (url.endsWith('/session')) return Response.json({ user: { id: 'admin' }, roles: ['admin'], csrf_token: 'csrf-abc' });
    if (url.endsWith('/admin/settings/export')) {
      return new Response(JSON.stringify(transferDocument()), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="submodhub-settings-20261112-021532.json"',
        },
      });
    }
    if (url.endsWith('/admin/settings/import')) {
      if (importStatus) {
        return Response.json({ code: importStatus.code, message: importStatus.code }, { status: importStatus.status });
      }
      return Response.json(settings());
    }
    return Response.json({});
  }) as typeof fetch;

  // The browser download path is not under test here; just record the handoff.
  const savedLinks: Array<{ href: string; download: string }> = [];
  const prototype = dom.window.HTMLAnchorElement.prototype;
  const originalClick = prototype.click;
  prototype.click = function (this: HTMLAnchorElement) {
    savedLinks.push({ href: this.getAttribute('href') ?? '', download: this.download });
  };
  const mutableURL = URL as unknown as { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };
  const originalCreate = mutableURL.createObjectURL;
  const originalRevoke = mutableURL.revokeObjectURL;
  mutableURL.createObjectURL = () => 'blob:settings-export';
  mutableURL.revokeObjectURL = () => undefined;

  const root = createRoot(dom.window.document.getElementById('root')!);
  const byText = (text: string) =>
    [...dom.window.document.querySelectorAll('button')].find((button) => button.textContent?.includes(text));
  const button = (label: string) => {
    const found = byText(label);
    assert.ok(found, `button "${label}" should exist`);
    return found as HTMLButtonElement;
  };
  const fileInput = () =>
    dom.window.document.querySelector('input[type="file"]') as HTMLInputElement;

  return {
    dom,
    requests,
    toasts,
    imported,
    savedLinks,
    button,
    byText,
    fileInput,
    failImportWith(status: number, code: string) {
      importStatus = { status, code };
    },
    /** 模拟用户在文件选择器里选中一个文件。 */
    async pickFile(name: string, text: string) {
      const input = fileInput();
      const file = new dom.window.File([text], name, { type: 'application/json' });
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      await act(async () => {
        input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      });
    },
    async click(label: string) {
      await act(async () => {
        button(label).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      });
    },
    async paint() {
      await act(async () => {
        root.render(
          <LangProvider initialLang="zh">
            <SettingsTransferCard
              apiBase="/api/v1"
              revision={11}
              onImported={(updated) => {
                imported.push(updated);
                options.onImported?.(updated);
              }}
              onConflict={() => options.onConflict?.()}
              onToast={(type, message) => toasts.push({ type, message })}
            />
          </LangProvider>,
        );
      });
    },
    text: () => dom.window.document.body.textContent ?? '',
    async cleanup() {
      await act(async () => {
        root.unmount();
      });
      prototype.click = originalClick;
      mutableURL.createObjectURL = originalCreate;
      mutableURL.revokeObjectURL = originalRevoke;
      Object.assign(globals, saved);
      dom.window.close();
    },
  };
}

test('导出按钮取回文档并交给浏览器保存', async () => {
  const view = mount();
  try {
    await view.paint();
    await view.click('导出为 JSON');

    const exported = view.requests.filter((r) => r.url.endsWith('/admin/settings/export'));
    assert.equal(exported.length, 1);
    assert.equal(exported[0].method, 'GET');
    assert.deepEqual(view.savedLinks, [
      { href: 'blob:settings-export', download: 'submodhub-settings-20261112-021532.json' },
    ]);
    assert.equal(view.toasts.at(-1)?.type, 'success');
  } finally {
    await view.cleanup();
  }
});

test('选中文件后先展示确认条，不直接导入', async () => {
  const view = mount();
  try {
    await view.paint();
    await view.pickFile('backup.json', JSON.stringify(transferDocument()));

    assert.equal(view.requests.filter((r) => r.url.endsWith('/admin/settings/import')).length, 0, '选文件不应立刻导入');
    const text = view.text();
    assert.match(text, /确认整份替换/);
    assert.match(text, /2 个主标签 \/ 1 个子标签/);
    assert.match(text, /1 个节点/);
    assert.match(text, /100\.106\.239\.85:7890/);
    assert.match(text, /backup\.json/);
  } finally {
    await view.cleanup();
  }
});

test('确认后带 CSRF 导入整份文档，并用响应刷新缓存', async () => {
  const view = mount();
  try {
    await view.paint();
    await view.pickFile('backup.json', JSON.stringify(transferDocument()));
    await view.click('替换当前配置');

    const posts = view.requests.filter((r) => r.url.endsWith('/admin/settings/import'));
    assert.equal(posts.length, 1);
    assert.equal(posts[0].method, 'POST');
    assert.equal(posts[0].csrf, 'csrf-abc');
    assert.deepEqual(JSON.parse(posts[0].body), transferDocument());

    assert.equal(view.imported.length, 1);
    assert.equal(view.imported[0].revision, 12);
    assert.equal(view.toasts.at(-1)?.type, 'success');
    // 确认条在成功后收起，避免管理员对着一个已经执行完的动作再点一次。
    assert.doesNotMatch(view.text(), /确认整份替换/);
  } finally {
    await view.cleanup();
  }
});

test('坏文件在本地就被挡住，不会有任何请求', async () => {
  const view = mount();
  try {
    await view.paint();
    await view.pickFile('catalog.json', JSON.stringify({ groups: [] }));
    assert.equal(view.requests.filter((r) => r.url.includes('/admin/settings/import')).length, 0);
    assert.match(view.text(), /这不是 SubmodHub 的设置文档/);

    await view.pickFile('broken.json', '{ not json');
    assert.match(view.text(), /不是合法的 JSON/);

    await view.pickFile('newer.json', JSON.stringify({ ...transferDocument(), version: 2 }));
    assert.match(view.text(), /版本不受支持/);
  } finally {
    await view.cleanup();
  }
});

test('导入失败时把服务端错误码写进卡片', async () => {
  const view = mount();
  try {
    await view.paint();
    view.failImportWith(400, 'credential_required');
    await view.pickFile('backup.json', JSON.stringify(transferDocument()));
    await view.click('替换当前配置');

    assert.match(view.text(), /导入失败：credential_required/);
    assert.equal(view.toasts.at(-1)?.type, 'error');
    assert.equal(view.imported.length, 0);
  } finally {
    await view.cleanup();
  }
});

test('revision 冲突走冲突回调，提示重新加载而不是「导入失败」', async () => {
  let conflicted = 0;
  const view = mount({ onConflict: () => { conflicted += 1; } });
  try {
    await view.paint();
    view.failImportWith(409, 'settings_conflict');
    await view.pickFile('backup.json', JSON.stringify(transferDocument()));
    await view.click('替换当前配置');

    assert.equal(conflicted, 1);
    assert.match(view.toasts.at(-1)?.message ?? '', /已被其他管理员修改/);
  } finally {
    await view.cleanup();
  }
});

test('文档里带令牌时确认条会明确说明将要替换令牌', async () => {
  const view = mount();
  try {
    await view.paint();
    const withToken = transferDocument();
    (withToken.settings as Record<string, unknown>).github_token = 'ghp_example';
    await view.pickFile('with-token.json', JSON.stringify(withToken));
    assert.match(view.text(), /导入后会替换当前令牌/);
  } finally {
    await view.cleanup();
  }
});
