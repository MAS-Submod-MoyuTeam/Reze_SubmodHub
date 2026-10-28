import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeScanFailure } from './scanErrors';

test('an unreadable ledger names the file and says nothing will heal it', () => {
  const copy = describeScanFailure('manifest_corrupt');
  assert.match(copy, /\.submodhub\/state\/manifest\.json/);
  assert.match(copy, /人工修复或重建/);
  assert.doesNotMatch(copy, /请重新扫描/);
});

test('other scan failures keep their own message', () => {
  assert.equal(describeScanFailure('mas_root_not_configured'), 'mas_root_not_configured');
  assert.equal(describeScanFailure('boom'), 'boom');
});
