import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Pagination, paginate } from './Pagination';

const items = Array.from({ length: 23 }, (_, index) => index + 1);

test('pagination covers all records without gaps or duplicates and keeps a partial last page', () => {
  const pages = [1, 2, 3].map((page) => paginate(items, page, 10));
  assert.deepEqual(pages.flatMap((page) => page.items), items);
  assert.deepEqual(pages[2], { page: 3, totalPages: 3, items: [21, 22, 23], start: 21, end: 23 });
});

test('filtering or removing the final page clamps to a valid page', () => {
  assert.equal(paginate(items.slice(0, 10), 3, 10).page, 1);
  assert.deepEqual(paginate([], 3, 10), { page: 1, totalPages: 1, items: [], start: 0, end: 0 });
  assert.equal(paginate(items, 0, 10).page, 1);
});

test('page size changes preserve the full collection', () => {
  assert.equal(paginate(items, 1, 20).items.length, 20);
  assert.deepEqual(paginate(items, 2, 20).items, [21, 22, 23]);
});

test('controls expose current page, bounded page buttons and disabled boundaries', () => {
  const render = (total: number, page: number) => renderToStaticMarkup(<Pagination label="提交队列" total={total} page={page} pageSize={10} onPageChange={() => {}} onPageSizeChange={() => {}} />);
  const empty = render(0, 1);
  assert.match(empty, /共 0 条 · 0–0 条/);
  assert.equal((empty.match(/disabled=""/g) || []).length, 4);
  const last = render(230, 23);
  assert.match(last, /aria-current="page"[^>]*>23/);
  assert.match(last, /共 230 条 · 221–230 条/);
  assert.equal((last.match(/aria-label="第 \d+ 页"/g) || []).length, 5);
  assert.equal((last.match(/disabled=""/g) || []).length, 2);
});
