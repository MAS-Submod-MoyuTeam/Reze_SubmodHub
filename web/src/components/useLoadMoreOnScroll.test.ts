import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';
import { useLoadMoreOnScroll } from './useLoadMoreOnScroll';

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed: Element[] = [];
  readonly options: IntersectionObserverInit | undefined;
  disconnected = false;
  callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(target: Element) {
    this.observed.push(target);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  emit(isIntersecting: boolean) {
    const entry = { isIntersecting, target: this.observed[0] } as IntersectionObserverEntry;
    this.callback([entry], this as unknown as IntersectionObserver);
  }
}

type ProbeProps = { hasMore: boolean; loadedCount: number; onLoadMore: () => void; showSentinel?: boolean };

function Probe({ hasMore, loadedCount, onLoadMore, showSentinel = true }: ProbeProps) {
  const sentinelRef = useLoadMoreOnScroll({ hasMore, onLoadMore, loadedCount });
  return showSentinel ? React.createElement('div', { ref: sentinelRef, 'data-testid': 'sentinel' }) : null;
}

type GlobalKey = 'window' | 'document' | 'IntersectionObserver';
const globals = globalThis as unknown as Record<GlobalKey, unknown>;

function withDom(run: (root: Root, dom: JSDOM) => Promise<void>, io?: typeof IntersectionObserver) {
  return async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
    // Restore the exact prior shape: a key that did not exist must not survive as undefined.
    const keys: GlobalKey[] = ['window', 'document', 'IntersectionObserver'];
    const saved = new Map(keys.map((key) => [key, { present: key in globalThis, value: globals[key] }]));

    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    if (io) globals.IntersectionObserver = io;
    else delete globals.IntersectionObserver;
    FakeIntersectionObserver.instances = [];

    const root = createRoot(dom.window.document.getElementById('root')!);
    try {
      await run(root, dom);
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      for (const key of keys) {
        const { present, value } = saved.get(key)!;
        if (present) globals[key] = value;
        else delete globals[key];
      }
    }
  };
}

test('auto-loads the next page when the sentinel scrolls into view', withDom(async (root) => {
  let calls = 0;
  const onLoadMore = () => { calls += 1; };

  await act(async () => root.render(React.createElement(Probe, { hasMore: true, loadedCount: 6, onLoadMore })));
  const first = FakeIntersectionObserver.instances[0];
  assert.ok(first, 'an observer is armed while more rows remain');
  assert.equal(first.observed.length, 1, 'it watches the sentinel right after the last row');
  assert.match(String(first.options?.rootMargin), /240px/, 'it prefetches before the sentinel is fully on screen');

  await act(async () => first.emit(false));
  assert.equal(calls, 0, 'a sentinel that is out of view must not load a page');

  await act(async () => first.emit(true));
  assert.equal(calls, 1, 'scrolling the sentinel into view loads the next page');

  // A load appends rows, so the observer is re-armed; otherwise a remainder that
  // still fits on screen would never get a second intersection event.
  await act(async () => root.render(React.createElement(Probe, { hasMore: true, loadedCount: 12, onLoadMore })));
  assert.equal(first.disconnected, true, 'the previous observer is released');
  const second = FakeIntersectionObserver.instances[1];
  assert.ok(second, 'the observer is re-armed after the page grew');
  await act(async () => second.emit(true));
  assert.equal(calls, 2);

  // Once every row is shown, a still-visible sentinel must not load anything.
  await act(async () => root.render(React.createElement(Probe, { hasMore: false, loadedCount: 18, onLoadMore })));
  assert.equal(second.disconnected, true, 'the observer is released when nothing is left');
  assert.equal(FakeIntersectionObserver.instances.length, 2, 'no observer is armed at the end of the list');
  assert.equal(calls, 2);
}, FakeIntersectionObserver as unknown as typeof IntersectionObserver));

test('arms the observer when the sentinel mounts after the first page arrives', withDom(async (root) => {
  // Regression: the list renders a skeleton first, so the sentinel appears in a
  // later commit while `hasMore` was already true. A ref-only effect ran against
  // a null node, never re-ran, and scrolling stayed dead until a manual click.
  let calls = 0;
  const onLoadMore = () => { calls += 1; };
  await act(async () => root.render(React.createElement(Probe, { hasMore: true, loadedCount: 6, onLoadMore, showSentinel: false })));
  assert.equal(FakeIntersectionObserver.instances.length, 0, 'nothing to watch before the node exists');

  await act(async () => root.render(React.createElement(Probe, { hasMore: true, loadedCount: 6, onLoadMore })));
  const observer = FakeIntersectionObserver.instances[0];
  assert.ok(observer, 'the observer is armed once the node mounts');
  await act(async () => observer.emit(true));
  assert.equal(calls, 1);
}, FakeIntersectionObserver as unknown as typeof IntersectionObserver));

test('re-arms when a narrower filter refills the list after the end was reached', withDom(async (root) => {
  // Filtering resets the cursor, so a finished list can start over with `hasMore`
  // true again and a smaller row count; the observer must come back to life.
  let calls = 0;
  const onLoadMore = () => { calls += 1; };
  await act(async () => root.render(React.createElement(Probe, { hasMore: false, loadedCount: 40, onLoadMore })));
  assert.equal(FakeIntersectionObserver.instances.length, 0, 'a finished list arms nothing');

  await act(async () => root.render(React.createElement(Probe, { hasMore: true, loadedCount: 6, onLoadMore })));
  const observer = FakeIntersectionObserver.instances[0];
  assert.ok(observer, 'the observer is armed again once rows are left to load');
  await act(async () => observer.emit(true));
  assert.equal(calls, 1);
}, FakeIntersectionObserver as unknown as typeof IntersectionObserver));

test('stays inert but keeps the anchor mounted when IntersectionObserver is unavailable', withDom(async (root, dom) => {
  await act(async () => root.render(React.createElement(Probe, {
    hasMore: true,
    loadedCount: 6,
    onLoadMore: () => { throw new Error('must not auto-load without IntersectionObserver'); },
  })));
  assert.equal(dom.window.document.querySelectorAll('[data-testid="sentinel"]').length, 1);
}));
