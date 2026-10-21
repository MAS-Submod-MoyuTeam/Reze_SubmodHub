import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { WindowPager, type WindowPagerProps } from './WindowPager';

function pagerProps(overrides: Partial<WindowPagerProps> = {}): WindowPagerProps {
  return {
    label: '我的模组', total: 13, start: 0, shown: 10, pageSize: 10,
    onPrevious: () => {}, onNext: () => {}, onPageSizeChange: () => {}, ...overrides,
  };
}

async function mountPager(props: WindowPagerProps) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const original = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(dom.window.document.getElementById('root')!);
  await act(async () => root.render(<WindowPager {...props} />));
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

test('the first window cannot page back and shows the visible range', async () => {
  const page = await mountPager(pagerProps());
  try {
    assert.equal(page.button('上一页')?.disabled, true);
    assert.equal(page.button('下一页')?.disabled, false);
    assert.match(page.container.textContent || '', /共 13 条 · 1–10 条/);
  } finally {
    await page.close();
  }
});

// The second window starts exactly one page in, so its previous neighbour is the
// first window. The pager must not confuse that with "no previous window".
test('the second window can page back even though its neighbour is the first window', async () => {
  let previous = 0;
  const page = await mountPager(pagerProps({ start: 10, shown: 3, onPrevious: () => { previous++; } }));
  try {
    assert.equal(page.button('上一页')?.disabled, false);
    assert.equal(page.button('下一页')?.disabled, true);
    assert.match(page.container.textContent || '', /共 13 条 · 11–13 条/);
    await act(async () => page.button('上一页')!.click());
    assert.equal(previous, 1);
  } finally {
    await page.close();
  }
});

test('an emptied window still offers the way back without a bogus range', async () => {
  const page = await mountPager(pagerProps({ start: 13, shown: 0 }));
  try {
    assert.equal(page.button('上一页')?.disabled, false);
    assert.equal(page.button('下一页')?.disabled, true);
    assert.match(page.container.textContent || '', /共 13 条/);
    assert.ok(!/\d+–\d+ 条/.test(page.container.textContent || ''));
  } finally {
    await page.close();
  }
});

test('changing the page size reports the new size', async () => {
  const sizes: number[] = [];
  const page = await mountPager(pagerProps({ onPageSizeChange: (size) => { sizes.push(size); } }));
  try {
    const select = page.container.querySelector('select')!;
    const view = select.ownerDocument.defaultView!;
    select.value = '50';
    await act(async () => {
      select.dispatchEvent(new view.Event('change', { bubbles: true }));
    });
    assert.deepEqual(sizes, [50]);
  } finally {
    await page.close();
  }
});
