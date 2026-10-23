import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes } from './formatBytes';

test('formatBytes uses human units with one decimal above bytes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatBytes(3 * 1024 ** 3), '3.0 GB');
});

test('formatBytes refuses to invent a size for garbage input', () => {
  assert.equal(formatBytes(Number.NaN), '未知大小');
  assert.equal(formatBytes(-1), '未知大小');
  assert.equal(formatBytes(Number.POSITIVE_INFINITY), '未知大小');
});
