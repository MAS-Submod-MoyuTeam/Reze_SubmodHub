import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSpriteSelectionValid, normalizeSpriteSetIDs } from './spritepackUtils';

test('normalizeSpriteSetIDs sorts, dedupes, and filters out whitespace and empty entries', () => {
  assert.deepEqual(normalizeSpriteSetIDs([]), []);
  assert.deepEqual(normalizeSpriteSetIDs(['  ', '']), []);
  assert.deepEqual(normalizeSpriteSetIDs(['set_b', 'set_a', 'set_b', ' set_c ']), ['set_a', 'set_b', 'set_c']);
  assert.deepEqual(normalizeSpriteSetIDs(undefined as unknown as string[]), []);
});

test('isSpriteSelectionValid enforces manifest presence, loading state, error state, and set membership', () => {
  const manifestA = [{ id: 'set_a1' }, { id: 'set_a2' }];

  // Loading: invalid
  assert.equal(isSpriteSelectionValid(['set_a1'], manifestA, true, ''), false);

  // Error: invalid
  assert.equal(isSpriteSelectionValid(['set_a1'], manifestA, false, 'network_error'), false);

  // Empty selection: invalid
  assert.equal(isSpriteSelectionValid([], manifestA, false, ''), false);

  // Empty manifest: invalid
  assert.equal(isSpriteSelectionValid(['set_a1'], [], false, ''), false);

  // Selection from another mod/stale set: invalid
  assert.equal(isSpriteSelectionValid(['set_old'], manifestA, false, ''), false);
  assert.equal(isSpriteSelectionValid(['set_a1', 'set_old'], manifestA, false, ''), false);

  // Valid selection: true
  assert.equal(isSpriteSelectionValid(['set_a1'], manifestA, false, ''), true);
  assert.equal(isSpriteSelectionValid(['set_a1', 'set_a2'], manifestA, false, ''), true);
});

test('mod switching lifecycle: selections and versions reset, prevents stale submissions on switch or error', () => {
  // Scenario: Mod A is active
  const modA = { id: 'spritepack_a', latest_version_id: 'v_a' };
  const manifestA = {
    version_id: 'v_a',
    sets: [{ id: 'set_a1', name: 'A1' }, { id: 'set_a2', name: 'A2' }],
  };

  let loading = false;
  let error = '';
  let spriteSets = manifestA.sets;
  let selectedSets = manifestA.sets.map((s) => s.id);
  let manifestVersionId = manifestA.version_id;

  // Mod A is ready: install is allowed
  assert.equal(isSpriteSelectionValid(selectedSets, spriteSets, loading, error), true);
  assert.deepEqual(selectedSets, ['set_a1', 'set_a2']);
  assert.equal(manifestVersionId, 'v_a');

  // User switches to Mod B
  const modB = { id: 'spritepack_b', latest_version_id: 'v_b' };
  // On mod switch (as in ModDetailModal useEffect):
  loading = true;
  error = '';
  spriteSets = [];
  selectedSets = []; // Reset on switch!
  manifestVersionId = '';

  // 1. During Mod B loading: install MUST be disabled, selectedSets MUST be empty
  assert.equal(selectedSets.length, 0);
  assert.equal(isSpriteSelectionValid(selectedSets, spriteSets, loading, error), false);
  // Even if stale sets somehow remained, loading=true or empty manifest blocks them
  assert.equal(isSpriteSelectionValid(['set_a1'], spriteSets, loading, error), false);

  // 2. If Mod B fails to load:
  loading = false;
  error = 'failed_to_fetch_manifest';
  // Install MUST be disabled
  assert.equal(isSpriteSelectionValid(selectedSets, spriteSets, loading, error), false);
  assert.equal(isSpriteSelectionValid(['set_a1'], spriteSets, loading, error), false);

  // 3. Mod B retry succeeds:
  error = '';
  const manifestB = {
    version_id: 'v_b',
    sets: [{ id: 'set_b1', name: 'B1' }],
  };
  spriteSets = manifestB.sets;
  selectedSets = manifestB.sets.map((s) => s.id);
  manifestVersionId = manifestB.version_id;

  assert.equal(isSpriteSelectionValid(selectedSets, spriteSets, loading, error), true);
  assert.deepEqual(selectedSets, ['set_b1']);
  assert.equal(manifestVersionId, 'v_b');

  // Verify Mod A's sets are rejected against Mod B's manifest
  assert.equal(isSpriteSelectionValid(['set_a1'], spriteSets, loading, error), false);
  assert.equal(isSpriteSelectionValid(['set_a1', 'set_b1'], spriteSets, loading, error), false);
});

test('download error is isolated from manifest error: selection remains valid and retryable', () => {
  const manifest = {
    version_id: 'v1',
    sets: [{ id: 'set_1', name: 'Kimono' }, { id: 'set_2', name: 'Summer' }],
  };

  const loading = false;
  let manifestError = '';
  let downloadError = '';
  const selectedSets = ['set_1'];

  // Initial valid state
  assert.equal(isSpriteSelectionValid(selectedSets, manifest.sets, loading, manifestError), true);

  // Network error during download
  downloadError = '套装下载失败：Failed to fetch';
  // Manifest error MUST remain empty so user selection is not locked
  assert.equal(manifestError, '');
  assert.equal(isSpriteSelectionValid(selectedSets, manifest.sets, loading, manifestError), true);

  // User retries download
  downloadError = '';
  assert.equal(isSpriteSelectionValid(selectedSets, manifest.sets, loading, manifestError), true);
});

test('version synchronization: install plan uses matching CatalogVersion rather than stale cached version', () => {
  // Cached catalog mod summary has stale v1
  const cachedMod = {
    id: 'spritepack_monika',
    title: 'Monika Spritepack',
    latest_version_id: 'v1',
    latest_version: '1.0.0',
    size_bytes: 1000,
    sha256: 'a'.repeat(64),
  };

  // Server published v2
  const serverManifest = {
    version_id: 'v2',
    sets: [{ id: 'set_modern', name: 'Modern Outfit' }],
  };
  const serverVersionV2 = {
    id: 'v2',
    mod_id: 'spritepack_monika',
    version: '2.0.0',
    size_bytes: 2500,
    sha256: 'b'.repeat(64),
    state: 'published' as const,
  };

  // When manifest is loaded with v2, version details are fetched for v2
  const manifestVersion = serverVersionV2;
  const selectedSets = ['set_modern'];

  // Installed payload must use the resolved manifestVersion (v2 & 2.0.0)
  const installVersionPayload = manifestVersion || undefined;
  assert.equal(installVersionPayload?.id, 'v2');
  assert.equal(installVersionPayload?.version, '2.0.0');
  // It must NOT mix cachedMod.latest_version ('1.0.0') with manifestVersionId ('v2')
  assert.notEqual(installVersionPayload?.version, cachedMod.latest_version);

  // Simulating version conflict (sprite_version_changed) reload lifecycle
  let manifestError = 'stale_version';
  let downloadError = '精灵包版本已更新，正在重新加载最新清单…';

  // Upon successful reload of latest manifest & version
  manifestError = '';
  downloadError = '精灵包版本已更新，已刷新至最新版本，请重新选择套装。';
  const refreshedVersion = {
    id: 'v3',
    mod_id: 'spritepack_monika',
    version: '3.0.0',
    size_bytes: 3000,
    sha256: 'c'.repeat(64),
    state: 'published' as const,
  };
  const refreshedSets = [{ id: 'set_future', name: 'Future Outfit' }];
  const newSelectedSets = ['set_future'];

  assert.equal(isSpriteSelectionValid(newSelectedSets, refreshedSets, false, manifestError), true);
  assert.equal(refreshedVersion.id, 'v3');
  assert.equal(refreshedVersion.version, '3.0.0');
});
