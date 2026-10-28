import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ModVersion } from '../types/submodhub';
import {
  localPlatformDeclaration,
  missingPlatformArchives,
  toggleLocalPlatform,
  uploadPlatforms,
  versionArchiveShape,
  versionUploadPlatforms,
} from './versionShipping';

const version = (patch: Partial<ModVersion> = {}): ModVersion => ({
  id: 'v1',
  mod_id: 'm1',
  version: '1.0.0',
  state: 'draft',
  size_bytes: 0,
  sha256: '',
  release_notes: '',
  dependencies: [],
  created_at: '2026-10-28T00:00:00Z',
  ...patch,
});

test('a version without an archive has no shape yet', () => {
  assert.equal(versionArchiveShape(version()), 'none');
  // A scan report or a version-wide hash means the shared archive already landed.
  assert.equal(versionArchiveShape(version({ scan_report_id: 'scan_v1' })), 'shared');
  assert.equal(versionArchiveShape(version({ sha256: 'a'.repeat(64), size_bytes: 10 })), 'shared');
  assert.equal(versionArchiveShape(version({ platform_assets: [{ platform: 'windows', size_bytes: 10 }] })), 'split');
});

test('upload platforms come from the mod declaration and fall back to both', () => {
  assert.deepEqual(uploadPlatforms(['windows', 'android']), ['windows', 'android']);
  assert.deepEqual(uploadPlatforms(['android']), ['android']);
  // Order is fixed by the platform list, not by the declared order.
  assert.deepEqual(uploadPlatforms(['android', 'windows']), ['windows', 'android']);
  // Platforms that can never ship their own archive do not produce a button.
  assert.deepEqual(uploadPlatforms(['windows', 'linux']), ['windows']);
  // A declaration that carries no build platform must not hide every button.
  assert.deepEqual(uploadPlatforms([]), ['windows', 'android']);
  assert.deepEqual(uploadPlatforms(undefined), ['windows', 'android']);
});

test('a version can always re-upload the platforms it already shipped', () => {
  const shipped = version({ platform_assets: [{ platform: 'android', size_bytes: 10 }] });
  assert.deepEqual(versionUploadPlatforms(shipped, ['windows']), ['windows', 'android']);
  assert.deepEqual(versionUploadPlatforms(version(), ['android']), ['android']);
});

test('missing platform archives only applies to the split shape', () => {
  const split = version({ platform_assets: [{ platform: 'windows', size_bytes: 10 }] });
  assert.deepEqual(missingPlatformArchives(split, ['windows', 'android']), ['android']);
  assert.deepEqual(missingPlatformArchives(split, ['windows']), []);
  // A shared archive serves every declared platform, so nothing is missing.
  assert.deepEqual(missingPlatformArchives(version({ sha256: 'a'.repeat(64) }), ['windows', 'android']), []);
  assert.deepEqual(missingPlatformArchives(version(), ['windows', 'android']), []);
});

test('the declaration round-trips and toggles without hidden platforms', () => {
  assert.deepEqual(localPlatformDeclaration(['windows', 'linux']), ['windows']);
  assert.deepEqual(localPlatformDeclaration([]), ['windows', 'android']);
  assert.deepEqual(toggleLocalPlatform(['windows', 'android'], 'android'), ['windows']);
  assert.deepEqual(toggleLocalPlatform(['android'], 'windows'), ['windows', 'android']);
  assert.deepEqual(toggleLocalPlatform(['windows'], 'windows'), []);
  // A stale non-build platform never survives a toggle.
  assert.deepEqual(toggleLocalPlatform(['windows', 'linux'], 'android'), ['windows', 'android']);
});
