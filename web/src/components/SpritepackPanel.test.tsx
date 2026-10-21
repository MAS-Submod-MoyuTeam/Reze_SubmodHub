import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { SpritepackPanel, type SpritepackPanelProps } from './SpritepackPanel';
import type { ModVersion, ScanReport } from '../types/submodhub';

function version(overrides: Partial<ModVersion> = {}): ModVersion {
  return {
    id: 'v1', mod_id: 'm1', version: '1.0.0', state: 'uploaded', size_bytes: 10, sha256: '',
    release_notes: '', dependencies: [], created_at: '2026-01-01T00:00:00Z', ...overrides,
  };
}

function scanReport(overrides: Partial<ScanReport> = {}): ScanReport {
  return {
    id: 'scan_v1', version_id: 'v1', status: 'ready', files: [], unsupported_paths: [], registrations: [],
    sprite_identities: [], sprite_sets: [], derived_gifts: [], blockers: [], warnings: [],
    resource_stats: { total_files: 0, scripts_count: 0, sprites_count: 0, audio_count: 0, total_size_bytes: 0, binary_flag: false },
    scanned_at: '2026-01-01T00:00:00Z', ...overrides,
  };
}

function panelProps(overrides: Partial<SpritepackPanelProps> = {}): SpritepackPanelProps {
  return {
    hasPublishedVersion: false, hasPendingReview: false, uploading: false, loading: false, error: undefined,
    loaded: true, versions: [], scanReports: {}, submittingVersionId: null, total: 0, page: 1, pageSize: 10,
    onUpload: () => {}, onRetry: () => {}, onDeleteVersion: () => {}, onSubmitReview: () => {},
    onPageChange: () => {}, onPageSizeChange: () => {}, ...overrides,
  };
}

function markup(props: SpritepackPanelProps): string {
  return renderToStaticMarkup(<SpritepackPanel {...props} />);
}

async function mountPanel(props: SpritepackPanelProps) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const original = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(<SpritepackPanel {...props} />));
  const container = dom.window.document.getElementById('root')!;
  const button = (text: string) => [...container.querySelectorAll('button')].find((element) => element.textContent?.includes(text));
  return {
    container,
    button,
    close: async () => {
      await act(async () => root.unmount());
      dom.window.close();
      Object.assign(globalThis, original);
    },
  };
}

test('offers the first spritepack upload and shows the empty state', () => {
  const html = markup(panelProps());
  assert.ok(html.includes('当前精灵包'));
  assert.ok(html.includes('上传精灵包 ZIP'));
  assert.ok(!html.includes('上传替换包'));
  assert.ok(html.includes('尚未上传精灵包。'));
  assert.ok(!html.includes('已有公开精灵包'));
});

test('switches to a replacement package once one is published', () => {
  const html = markup(panelProps({ hasPublishedVersion: true }));
  assert.ok(html.includes('上传替换包'));
  assert.ok(html.includes('已有公开精灵包。替换包审核通过后将成为唯一可下载的包。'));
});

test('blocks the upload while a spritepack is already under review', async () => {
  const page = await mountPanel(panelProps({ hasPendingReview: true }));
  try {
    assert.equal(page.button('上传精灵包 ZIP')?.disabled, true);
  } finally {
    await page.close();
  }
});

test('renders the pending draft package with its sprite sets and blockers', () => {
  const html = markup(panelProps({
    versions: [version({ state: 'draft', scan_report_id: 'scan_v1' })],
    scanReports: {
      scan_v1: scanReport({
        sprite_sets: [{ id: 'set_a', name: 'Hair', items: [{ display_name: 'Ribbon' }, { display_name: 'Bow' }] }],
        blockers: ['sprite_anchor: missing tag'],
      }),
    },
  }));
  assert.ok(html.includes('待发布包 · draft'));
  assert.ok(html.includes('识别到 1 套 · 2 个 JSON 项目'));
  assert.ok(html.includes('Hair'));
  assert.ok(html.includes('Ribbon、Bow'));
  assert.ok(html.includes('扫描阻断：sprite_anchor: missing tag'));
  assert.ok(html.includes('删除草稿'));
  // A draft has not been scanned into an uploadable package yet.
  assert.ok(!html.includes('提交审核'));
});

test('only still-editable packages are listed', () => {
  const html = markup(panelProps({
    versions: [
      version({ id: 'published', state: 'published' }),
      version({ id: 'retired', state: 'unpublished' }),
    ],
  }));
  assert.ok(!html.includes('待发布包'));
});

test('shows the load failure and retries it', async () => {
  let retried = 0;
  const page = await mountPanel(panelProps({ error: 'unavailable', loaded: false, onRetry: () => { retried++; } }));
  try {
    assert.equal(page.container.querySelector('[role="alert"]')?.textContent, '版本加载失败：unavailable 重试');
    await act(async () => page.button('重试')!.click());
    assert.equal(retried, 1);
  } finally {
    await page.close();
  }
});

test('submits an uploaded package and deletes a draft', async () => {
  const submitted: string[] = [];
  const deleted: string[] = [];
  const page = await mountPanel(panelProps({
    total: 23,
    page: 2,
    versions: [
      version({ id: 'v_draft', state: 'draft' }),
      version({ id: 'v_uploaded', state: 'uploaded', scan_report_id: 'scan_ok' }),
      version({ id: 'v_blocked', state: 'uploaded', scan_report_id: 'scan_blocked' }),
    ],
    scanReports: { scan_ok: scanReport(), scan_blocked: scanReport({ blockers: ['conflict: hair.png'] }) },
    onSubmitReview: (versionId) => { submitted.push(versionId); },
    onDeleteVersion: (versionId) => { deleted.push(versionId); },
  }));
  try {
    const submitButtons = [...page.container.querySelectorAll('button')].filter((element) => element.textContent?.includes('提交审核'));
    assert.equal(submitButtons.length, 2);
    // A blocked package cannot be submitted; the clean one can.
    assert.deepEqual(submitButtons.map((element) => element.disabled), [false, true]);
    await act(async () => submitButtons[0].click());
    assert.deepEqual(submitted, ['v_uploaded']);
    await act(async () => page.button('删除草稿')!.click());
    assert.deepEqual(deleted, ['v_draft']);
    // The pager stays the numbered one for versions: totals and position come from the server.
    assert.ok(page.container.textContent?.includes('共 23 条'));
    assert.ok(page.container.textContent?.includes('2 / 3 页'));
  } finally {
    await page.close();
  }
});

test('disables the submit button while the review request is in flight', async () => {
  const page = await mountPanel(panelProps({
    versions: [version({ id: 'v_uploaded', state: 'uploaded', scan_report_id: 'scan_ok' })],
    scanReports: { scan_ok: scanReport() },
    submittingVersionId: 'v_uploaded',
  }));
  try {
    assert.equal(page.button('提交审核')?.disabled, true);
  } finally {
    await page.close();
  }
});
