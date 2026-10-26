import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_PLATFORM_FILTERS } from './catalogPlatforms';

test('web catalog only offers platforms that ship a client', () => {
  assert.deepEqual(
    CATALOG_PLATFORM_FILTERS.map((option) => option.id),
    ['all', 'windows', 'android'],
  );
  // Linux / macOS have no release plan; showing them would offer an empty filter.
  assert.ok(!CATALOG_PLATFORM_FILTERS.some((option) => String(option.id) === 'linux'));
  assert.ok(!CATALOG_PLATFORM_FILTERS.some((option) => String(option.id) === 'macos'));
});
