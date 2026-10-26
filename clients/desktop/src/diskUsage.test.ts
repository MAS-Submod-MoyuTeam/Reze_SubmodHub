import assert from 'node:assert/strict';
import test from 'node:test';

import { computeDiskUsage } from './diskUsage';

const GB = 1024 * 1024 * 1024;

test('computeDiskUsage reports the real occupancy of the volume', () => {
  assert.deepEqual(computeDiskUsage(6 * GB, 10 * GB), { percent: 40, usedBytes: 4 * GB });
  assert.deepEqual(computeDiskUsage(0, 10 * GB), { percent: 100, usedBytes: 10 * GB });
  assert.deepEqual(computeDiskUsage(10 * GB, 10 * GB), { percent: 0, usedBytes: 0 });
});

test('computeDiskUsage rounds to a whole percentage', () => {
  assert.equal(computeDiskUsage(2 * GB, 3 * GB)?.percent, 33);
  assert.equal(computeDiskUsage(1 * GB, 3 * GB)?.percent, 67);
});

test('computeDiskUsage stays unknown instead of inventing a percentage', () => {
  assert.equal(computeDiskUsage(null, 10 * GB), null);
  assert.equal(computeDiskUsage(6 * GB, null), null);
  assert.equal(computeDiskUsage(undefined, undefined), null);
  assert.equal(computeDiskUsage(6 * GB, 0), null);
  assert.equal(computeDiskUsage(Number.NaN, 10 * GB), null);
});

test('computeDiskUsage clamps impossible readings to the 0-100 range', () => {
  assert.deepEqual(computeDiskUsage(12 * GB, 10 * GB), { percent: 0, usedBytes: 0 });
  assert.deepEqual(computeDiskUsage(-1 * GB, 10 * GB), { percent: 100, usedBytes: 10 * GB });
});
