import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Pagination } from './Pagination';

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
