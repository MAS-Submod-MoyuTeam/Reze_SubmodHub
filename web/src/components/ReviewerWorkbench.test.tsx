import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { AppProvider } from '../context/AppContext';
import { ReviewerWorkbench } from './ReviewerWorkbench';

test('reviewer requests server pages, retries failures, and refreshes the last filtered page after approval', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const oldFetch = globalThis.fetch;
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let rows = Array.from({ length: 12 }, (_, i) => ({ id: `s${i + 1}`, mod_id: `m${i}`, version_id: `v${i}`, author_id: 'author', state: 'ready_for_review', mod_title: `Mod ${i + 1}`, author_name: 'Author', version_str: '1.0.0', category: 'submod', created_at: '2026-10-21' }));
  const requests: string[] = [];
  let failList = false;
  let failAction = false;
  let releaseOld: (() => void) | undefined;
  let delayNext = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    requests.push(path);
    const url = new URL(path, 'http://localhost');
    if (url.pathname === '/api/v1/session') return Response.json({user:{id:'admin',username:'admin',display_name:'Admin'},roles:['admin'],csrf_token:'csrf'});
    if (['/api/v1/mods','/api/v1/author/mods','/api/v1/author/submissions'].includes(url.pathname)) return Response.json({items:[]});
    if (url.pathname.endsWith('/decision')) {
      if (failAction) return Response.json({code:'unavailable'}, {status:503});
      const id=url.pathname.split('/').at(-2);
      const decision=JSON.parse(String(init?.body)).decision;
      rows=rows.map(row=>row.id===id?{...row,state:decision==='approve'?'published':'rejected'}:row);
      return Response.json(rows.find(row=>row.id===id));
    }
    if (url.pathname.endsWith('/review/submissions')) {
      if (failList) return Response.json({ code: 'unavailable' }, { status: 503 });
      const size = Number(url.searchParams.get('page_size'));
      assert.ok(size > 0 && size <= 100);
      const state = url.searchParams.get('state');
      const filtered = rows.filter((row) => !state || row.state === state);
      const page = Math.min(Number(url.searchParams.get('page')), Math.max(1, Math.ceil(filtered.length / size)));
      const body = { items: filtered.slice((page - 1) * size, page * size), page, page_size: size, total: filtered.length, pending_count: rows.filter((row) => row.state === 'ready_for_review').length };
      // Ignore cancellation deliberately: the hook must still discard late results.
      if (delayNext) { delayNext = false; await new Promise<void>((resolve) => { releaseOld = resolve; }); }
      return Response.json(body);
    }
    if (url.pathname.endsWith('/review/audit')) return Response.json({ items: [], total: 43, page: Number(url.searchParams.get('page')), page_size: Number(url.searchParams.get('page_size')) });
    const row = rows.find((item) => url.pathname.endsWith('/' + item.id));
    if (row) return Response.json({ submission: row, mod: { summary: `Detail ${row.id}` }, version: { id: row.version_id, dependencies: [] }, scan_report: { files: [{ source: 'file.rpy', target: 'game/file.rpy', size: 12, sha256: 'hash', class: 'script' }] } });
    throw Error('unexpected request ' + path);
  }) as typeof fetch;
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const settle = async () => { await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); }); };
  const button = (label: string, scope: Element = container) => {
    const found = Array.from(scope.querySelectorAll('button')).find((item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label);
    assert.ok(found, `missing button ${label}`);
    return found;
  };
  const click = async (label: string, scope?: Element) => { await act(async () => { button(label, scope).click(); }); await settle(); };
  const nav = () => container.querySelector('nav[aria-label="提交队列分页"]')!;
  try {
    await act(async () => { root.render(<AppProvider><ReviewerWorkbench /></AppProvider>); });
    await settle();
    assert.ok(requests.includes('/api/v1/review/submissions?page=1&page_size=10'));
    assert.equal(requests.includes('/api/v1/review/submissions'), false, 'provider must not fetch an unbounded review list');
    assert.equal(requests.some((path) => path.includes('/review/audit')), false, 'audit must load only when opened');
    assert.match(container.textContent!, /完整包文件树/);
    await click('下一页', nav());
    assert.match(container.querySelector('h2.text-base')!.textContent!, /Mod 11/);
    assert.ok(requests.includes('/api/v1/review/submissions?page=2&page_size=10'));
    await click('待处理');
    assert.match(nav().textContent!, /1 \/ 2 页/);
    await click('下一页', nav());
    failAction = true;
    await click('批准并发布');
    await act(async () => { container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    assert.ok(container.querySelector('textarea'), 'failed decision keeps modal and reason');
    failAction = false;
    await act(async () => { container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    await settle();
    await click('批准并发布');
    await act(async () => { container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    await settle();
    assert.match(nav().textContent!, /1 \/ 1 页/);
    assert.match(container.querySelector('h2.text-base')!.textContent!, /Mod 1 /);

    failList = true;
    await click('已驳回');
    assert.match(container.querySelector('[role="alert"]')!.textContent!, /提交队列加载失败/);
    assert.equal(container.querySelector('h2.text-base'), null, 'old detail hidden on failed query');
    failList = false;
    await click('重试');
    assert.match(container.textContent!, /当前筛选下暂无提交/);

    delayNext = true;
    await click('全部');
    assert.ok(releaseOld);
    await click('已上线');
    assert.match(nav().textContent!, /共 2 条/);
    await act(async () => { releaseOld!(); });
    await settle();
    assert.match(nav().textContent!, /共 2 条/, 'old all-state response cannot overwrite published filter');
    await click('审核与下架审计流水');
    const audit = container.querySelector('nav[aria-label="审计流水分页"]')!;
    await click('最后一页', audit);
    assert.ok(requests.includes('/api/v1/review/audit?page=3&page_size=20'));
  } finally {
    await act(async () => { root.unmount(); });
    t.mock.timers.reset();
    dom.window.close();
    Object.assign(globalThis, { window: oldWindow, document: oldDocument, fetch: oldFetch });
  }
});

// A per-platform version is one submission covering two builds. The reviewer has
// to be able to read each build's own report, otherwise the second platform is
// approved on evidence nobody looked at.
test('reviewer opens each platform report of a per-platform submission', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const oldFetch = globalThis.fetch;
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const row = { id: 's1', mod_id: 'm1', version_id: 'v1', author_id: 'author', state: 'ready_for_review', mod_title: '拆分平台模组', author_name: 'Author', version_str: '1.0.0', category: 'submod', created_at: '2026-10-21' };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const url = new URL(path, 'http://localhost');
    if (url.pathname === '/api/v1/session') return Response.json({ user: { id: 'admin', username: 'admin', display_name: 'Admin' }, roles: ['admin'], csrf_token: 'csrf' });
    if (['/api/v1/mods', '/api/v1/author/mods', '/api/v1/author/submissions'].includes(url.pathname)) return Response.json({ items: [] });
    if (url.pathname.endsWith('/review/submissions')) {
      return Response.json({ items: [row], page: 1, page_size: Number(url.searchParams.get('page_size')), total: 1, pending_count: 1 });
    }
    if (url.pathname.endsWith('/review/audit')) return Response.json({ items: [], total: 0, page: 1, page_size: 20 });
    if (url.pathname.endsWith('/' + row.id)) {
      return Response.json({
        submission: row,
        mod: { summary: '拆分平台说明' },
        version: {
          id: 'v1',
          dependencies: [],
          size_bytes: 0,
          sha256: '',
          platform_assets: [
            { platform: 'windows', size_bytes: 2048, sha256: 'w'.repeat(64) },
            { platform: 'android', size_bytes: 4096, sha256: 'a'.repeat(64) },
          ],
        },
        scan_report: { files: [{ source: 'windows.rpy', target: 'game/windows.rpy', size: 11, sha256: 'h1', class: 'script' }] },
        scan_reports: {
          'scan_v1-windows': { files: [{ source: 'windows.rpy', target: 'game/windows.rpy', size: 11, sha256: 'h1', class: 'script' }] },
          'scan_v1-android': { files: [{ source: 'android.rpy', target: 'game/android.rpy', size: 22, sha256: 'h2', class: 'script' }] },
        },
      });
    }
    throw Error('unexpected request ' + path);
  }) as typeof fetch;
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  const settle = async () => { await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); }); };
  const platformTab = (label: string) => {
    const found = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.trim() === label);
    assert.ok(found, `missing platform tab ${label}`);
    return found;
  };
  try {
    await act(async () => { root.render(<AppProvider><ReviewerWorkbench /></AppProvider>); });
    await settle();
    assert.match(container.textContent!, /逐个平台核对报告/);
    assert.match(container.textContent!, /2048 bytes/, 'the chosen platform size replaces the empty version-wide size');
    assert.match(container.textContent!, /windows\.rpy/);
    assert.doesNotMatch(container.textContent!, /android\.rpy/, 'the other platform is not shown until it is selected');
    await act(async () => { platformTab('Android').click(); });
    await settle();
    assert.match(container.textContent!, /android\.rpy/);
    assert.match(container.textContent!, /4096 bytes/);
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
    Object.assign(globalThis, { window: oldWindow, document: oldDocument, fetch: oldFetch });
  }
});
