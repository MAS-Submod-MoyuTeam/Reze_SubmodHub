import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortVersionHistory } from './versionHistory.ts';
import * as versionHistory from './versionHistory.ts';

test('version labels preserve the original value', () => {
  const format = 'formatVersionLabel' in versionHistory
    ? versionHistory.formatVersionLabel as (version: string) => string
    : undefined;
  assert.equal(format?.('1.0.1'), '1.0.1');
  assert.equal(format?.('v1.0.1'), 'v1.0.1');
  assert.equal(format?.('V2.0.0'), 'V2.0.0');
  assert.equal(format?.('release-1'), 'release-1');
});

test('GitHub release history is sorted by SemVer newest first', () => {
  const versions = ['v1.9.0', 'v2.0.0', 'v1.10.0', 'v2.0.0-rc.1'].map((version) => ({ version }));
  assert.deepEqual(sortVersionHistory(versions, true).map((item) => item.version), [
    'v2.0.0', 'v2.0.0-rc.1', 'v1.10.0', 'v1.9.0',
  ]);
});

test('GitHub release history puts the configured latest tag first', () => {
  const versions = [{ id: 'old', version: '3.0.0' }, { id: 'latest', version: '1.0.0' }];
  assert.equal(sortVersionHistory(versions, true, 'latest')[0].id, 'latest');
});

test('non-GitHub version history preserves its existing order', () => {
  const versions = [{ version: '1.0.0' }, { version: '2.0.0' }];
  assert.deepEqual(sortVersionHistory(versions, false), versions);
});
