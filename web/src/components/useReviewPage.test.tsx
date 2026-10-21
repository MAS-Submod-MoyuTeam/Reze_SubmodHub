import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { useReviewPage } from './useReviewPage';

type Page = { page: number; label: string };
type Snapshot = { data?: Page; error?: string; loading: boolean; refreshing: boolean };

test('query changes hide stale rows while reloads keep the visible page', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const original = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const snapshots: Snapshot[] = [];
  const last = () => snapshots[snapshots.length - 1];
  function Probe({ loader, queryKey }: { loader: (signal: AbortSignal) => Promise<Page>; queryKey: string }) {
    snapshots.push(useReviewPage<Page>(loader, true, queryKey));
    return null;
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const settle = async () => { await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)); }); };
  try {
    await act(async () => root.render(<Probe loader={async () => ({ page: 1, label: 'first' })} queryKey="page-1" />));
    await settle();
    assert.equal(last().data?.label, 'first');
    assert.equal(last().loading, false);

    // A reload of the same query (new loader identity) must keep the visible page.
    let resolveRefresh: (value: Page) => void = () => {};
    const pending = new Promise<Page>((resolve) => { resolveRefresh = resolve; });
    await act(async () => root.render(<Probe loader={() => pending} queryKey="page-1" />));
    assert.equal(last().data?.label, 'first', 'reload keeps the visible page');
    assert.equal(last().loading, false);
    assert.equal(last().refreshing, true);
    await act(async () => { resolveRefresh({ page: 1, label: 'second' }); await settle(); });
    assert.equal(last().data?.label, 'second');
    assert.equal(last().refreshing, false);

    // A different query must not show the previous page.
    let rejectNext: (error: Error) => void = () => {};
    const failing = new Promise<Page>((_, reject) => { rejectNext = reject; });
    await act(async () => root.render(<Probe loader={() => failing} queryKey="page-2" />));
    assert.equal(last().data, undefined, 'a new query must not show the old page');
    assert.equal(last().loading, true);
    await act(async () => { rejectNext(new Error('unavailable')); await settle(); });
    assert.equal(last().error, 'unavailable');
    assert.equal(last().loading, false);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, original);
  }
});
