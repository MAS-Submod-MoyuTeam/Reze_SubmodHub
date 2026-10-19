import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sortVersionHistory } from './versionHistory.ts';

test('version history sorts versions by numeric segments, newest first', () => {
  const versions = [
    { id: 'older', version: '1.8.7', created_at: '2026-10-01T00:00:00Z' },
    { id: 'newer', version: '1.8.20', created_at: '2026-09-01T00:00:00Z' },
    { id: 'oldest', version: '1.8.3', created_at: '2026-08-01T00:00:00Z' },
  ];

  assert.deepEqual(sortVersionHistory(versions).map(({ version }) => version), [
    '1.8.20', '1.8.7', '1.8.3',
  ]);
});

test('version history keeps the configured latest version first', () => {
  const versions = [
    { id: 'latest', version: '1.8.7' },
    { id: 'newer-tag', version: '1.8.20' },
  ];

  assert.equal(sortVersionHistory(versions, 'latest')[0].id, 'latest');
});
