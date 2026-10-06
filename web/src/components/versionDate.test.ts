import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatVersionCreatedAt } from './versionDate';

test('missing or invalid version creation time is not shown as Invalid Date', () => {
  assert.equal(formatVersionCreatedAt(''), '创建时间未记录');
  assert.equal(formatVersionCreatedAt('bad-date'), '创建时间未记录');
});

test('valid version creation time is formatted as a date', () => {
  assert.notEqual(formatVersionCreatedAt('2026-10-06T00:00:00Z'), '创建时间未记录');
});
