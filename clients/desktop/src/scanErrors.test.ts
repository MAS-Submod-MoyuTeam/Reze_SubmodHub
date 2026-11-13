import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeScanFailure } from './scanErrors';
import { translate } from './i18n/translate';

const tZh = (key: string, vars?: Record<string, string | number>) => translate('zh', key, vars);

test('an unreadable ledger names the file and says nothing will heal it', () => {
  const copy = describeScanFailure('manifest_corrupt', tZh);
  assert.match(copy, /\.submodhub\/state\/manifest\.json/);
  assert.match(copy, /人工修复或重建/);
  assert.doesNotMatch(copy, /请重新扫描/);
});

test('other scan failures keep their own message', () => {
  assert.equal(describeScanFailure('mas_root_not_configured', tZh), 'mas_root_not_configured');
  assert.equal(describeScanFailure('boom', tZh), 'boom');
});
