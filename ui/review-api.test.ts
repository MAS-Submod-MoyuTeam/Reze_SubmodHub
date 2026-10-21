import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listReviewSubmissions, listReviewAudit } from './submission-api';

test('review page requests carry pagination, state and cancellation and preserve metadata', async () => {
  const controller = new AbortController();
  const response = { items: [], total: 23, page: 2, page_size: 10, pending_count: 7 };
  const fetcher = (async (input, init) => {
    assert.equal(String(input), '/api/v1/review/submissions?page=2&page_size=10&state=published');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.signal, controller.signal);
    return Response.json(response);
  }) as typeof fetch;
  assert.deepEqual(await listReviewSubmissions('/api/v1/', { page: 2, pageSize: 10, state: 'published' }, controller.signal, fetcher), response);
});

test('all-state requests omit the filter and API failures propagate for UI recovery', async () => {
  const fetcher = (async (input) => {
    assert.equal(String(input), '/api/v1/review/submissions?page=1&page_size=20');
    return Response.json({ code: 'forbidden' }, { status: 403 });
  }) as typeof fetch;
  await assert.rejects(listReviewSubmissions('/api/v1', { page: 1, pageSize: 20, state: 'all' }, undefined, fetcher), /forbidden/);
});

test('audit page requests preserve totals and effective page from server', async () => {
  const fetcher = (async (input) => {
    assert.equal(String(input), '/api/v1/review/audit?page=9&page_size=50');
    return Response.json({ items: [], page: 1, page_size: 50, total: 0 });
  }) as typeof fetch;
  assert.deepEqual(await listReviewAudit('/api/v1', { page: 9, pageSize: 50 }, undefined, fetcher), { items: [], page: 1, page_size: 50, total: 0 });
});
