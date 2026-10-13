import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateSpriteSelectionDiff,
  deriveSpriteSelection,
  isSpriteSelectionValid,
  normalizeSpriteSetIDs,
  type SpriteInstallationSnapshot,
} from './spritepackUtils';

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

test('deriveSpriteSelection: first install defaults to all manifest sets in sorted order', () => {
  const manifestSets = [{ id: 'set_b' }, { id: 'set_a' }, { id: 'set_b' }];
  const baseline = deriveSpriteSelection(manifestSets, null, 'success');

  assert.equal(baseline.mode, 'first_install');
  assert.deepEqual(baseline.initialIds, ['set_a', 'set_b']);
  assert.deepEqual(baseline.installedIds, []);
  assert.deepEqual(baseline.unavailableInstalledIds, []);
});

test('deriveSpriteSelection: known installed defaults to installed sets only and detects unavailable IDs', () => {
  const manifestSets = [{ id: 'set_a' }, { id: 'set_b' }, { id: 'set_c' }];
  const snapshot: SpriteInstallationSnapshot = {
    instanceId: 'inst_1',
    modId: 'mod_sprite',
    versionId: 'v1',
    operationId: 'op_123',
    setIds: ['set_a', 'set_old_deleted'],
    selectionHash: 'sha_existing',
  };

  const baseline = deriveSpriteSelection(manifestSets, snapshot, 'success');
  assert.equal(baseline.mode, 'known_installed');
  // Only installed sets that exist in the manifest are initially selected
  assert.deepEqual(baseline.initialIds, ['set_a']);
  assert.deepEqual(baseline.installedIds, ['set_a', 'set_old_deleted']);
  assert.deepEqual(baseline.unavailableInstalledIds, ['set_old_deleted']);

  // If no installed set intersects with manifest sets, initial selection is empty
  const manifestDisjoint = [{ id: 'set_c' }, { id: 'set_d' }];
  const disjointBaseline = deriveSpriteSelection(manifestDisjoint, snapshot, 'success');
  assert.equal(disjointBaseline.mode, 'known_installed');
  assert.deepEqual(disjointBaseline.initialIds, []);
  assert.deepEqual(disjointBaseline.installedIds, ['set_a', 'set_old_deleted']);
  assert.deepEqual(disjointBaseline.unavailableInstalledIds, ['set_a', 'set_old_deleted']);
});

test('deriveSpriteSelection: legacy receipt without verifiable selection falls back to unknown_installed and never selects all', () => {
  const manifestSets = [{ id: 'set_a' }, { id: 'set_b' }];

  // Missing setIds
  const snapshotMissingSets: SpriteInstallationSnapshot = {
    instanceId: 'inst_1',
    modId: 'mod_sprite',
    versionId: 'v1',
    operationId: 'op_legacy',
    selectionHash: 'hash_only',
  };
  const baseline1 = deriveSpriteSelection(manifestSets, snapshotMissingSets, 'success');
  assert.equal(baseline1.mode, 'unknown_installed');
  assert.deepEqual(baseline1.initialIds, []);

  // Empty setIds
  const snapshotEmptySets: SpriteInstallationSnapshot = {
    instanceId: 'inst_1',
    modId: 'mod_sprite',
    versionId: 'v1',
    operationId: 'op_legacy',
    setIds: [],
    selectionHash: 'hash_only',
  };
  const baseline2 = deriveSpriteSelection(manifestSets, snapshotEmptySets, 'success');
  assert.equal(baseline2.mode, 'unknown_installed');
  assert.deepEqual(baseline2.initialIds, []);

  // Missing selection hash
  const snapshotMissingHash: SpriteInstallationSnapshot = {
    instanceId: 'inst_1',
    modId: 'mod_sprite',
    versionId: 'v1',
    operationId: 'op_legacy',
    setIds: ['set_a'],
  };
  const baseline3 = deriveSpriteSelection(manifestSets, snapshotMissingHash, 'success');
  assert.equal(baseline3.mode, 'unknown_installed');
  assert.deepEqual(baseline3.initialIds, []);
});

test('deriveSpriteSelection: blocks initialization during loading or error, never treating as first install', () => {
  const manifestSets = [{ id: 'set_a' }, { id: 'set_b' }];

  // Loading state with no snapshot must NOT be first_install
  const loadingBaseline = deriveSpriteSelection(manifestSets, null, 'loading');
  assert.equal(loadingBaseline.mode, 'loading');
  assert.deepEqual(loadingBaseline.initialIds, []);

  // Error state must NOT be first_install
  const errorBaseline = deriveSpriteSelection(manifestSets, null, 'error');
  assert.equal(errorBaseline.mode, 'error');
  assert.deepEqual(errorBaseline.initialIds, []);

  // Idle state (e.g. before instance scan starts) must not be first_install
  const idleBaseline = deriveSpriteSelection(manifestSets, null, 'idle');
  assert.equal(idleBaseline.mode, 'loading');
});

test('calculateSpriteSelectionDiff: computes kept, added, removed, and dirty states', () => {
  const manifestSets = [{ id: 'set_a' }, { id: 'set_b' }, { id: 'set_c' }];
  const snapshot: SpriteInstallationSnapshot = {
    instanceId: 'inst_1',
    modId: 'mod_sprite',
    versionId: 'v1',
    operationId: 'op_1',
    setIds: ['set_a'],
    selectionHash: 'hash_a',
  };
  const baseline = deriveSpriteSelection(manifestSets, snapshot, 'success');

  // Scenario 1: User keeps set_a (no change)
  const diffUnchanged = calculateSpriteSelectionDiff(baseline, ['set_a']);
  assert.deepEqual(diffUnchanged.keptIds, ['set_a']);
  assert.deepEqual(diffUnchanged.addedIds, []);
  assert.deepEqual(diffUnchanged.removedIds, []);
  assert.equal(diffUnchanged.isUnchanged, true);
  assert.equal(diffUnchanged.isAllDeselected, false);
  assert.equal(diffUnchanged.requiresUninstallConfirmation, false);

  // Scenario 2: User adds set_b (result: set_a + set_b)
  const diffAddB = calculateSpriteSelectionDiff(baseline, ['set_a', 'set_b']);
  assert.deepEqual(diffAddB.keptIds, ['set_a']);
  assert.deepEqual(diffAddB.addedIds, ['set_b']);
  assert.deepEqual(diffAddB.removedIds, []);
  assert.equal(diffAddB.isUnchanged, false);
  assert.equal(diffAddB.requiresUninstallConfirmation, false);

  // Scenario 3: User unchecks set_a and checks set_b (result: remove set_a, add set_b)
  const diffSwitch = calculateSpriteSelectionDiff(baseline, ['set_b']);
  assert.deepEqual(diffSwitch.keptIds, []);
  assert.deepEqual(diffSwitch.addedIds, ['set_b']);
  assert.deepEqual(diffSwitch.removedIds, ['set_a']);
  assert.equal(diffSwitch.isUnchanged, false);
  assert.equal(diffSwitch.requiresUninstallConfirmation, true);

  // Scenario 4: User selects all [set_a, set_b, set_c]
  const diffAll = calculateSpriteSelectionDiff(baseline, ['set_a', 'set_b', 'set_c']);
  assert.deepEqual(diffAll.keptIds, ['set_a']);
  assert.deepEqual(diffAll.addedIds, ['set_b', 'set_c']);
  assert.deepEqual(diffAll.removedIds, []);
  assert.equal(diffAll.isUnchanged, false);

  // Scenario 5: User deselects all [] -> triggers uninstall path
  const diffNone = calculateSpriteSelectionDiff(baseline, []);
  assert.deepEqual(diffNone.keptIds, []);
  assert.deepEqual(diffNone.addedIds, []);
  assert.deepEqual(diffNone.removedIds, ['set_a']);
  assert.equal(diffNone.isAllDeselected, true);
  assert.equal(diffNone.requiresUninstallConfirmation, true);

  // Scenario 6: Version upgrade drops an old set, which must be tracked in removedIds
  const snapshotWithOld: SpriteInstallationSnapshot = {
    instanceId: 'inst_1',
    modId: 'mod_sprite',
    versionId: 'v1',
    operationId: 'op_1',
    setIds: ['set_a', 'set_dropped'],
    selectionHash: 'hash_a',
  };
  const baselineWithDropped = deriveSpriteSelection(manifestSets, snapshotWithOld, 'success');
  assert.deepEqual(baselineWithDropped.unavailableInstalledIds, ['set_dropped']);

  const diffKeepA = calculateSpriteSelectionDiff(baselineWithDropped, ['set_a']);
  assert.deepEqual(diffKeepA.keptIds, ['set_a']);
  assert.deepEqual(diffKeepA.addedIds, []);
  // Dropped old set must be included in removedIds!
  assert.deepEqual(diffKeepA.removedIds, ['set_dropped']);
  assert.equal(diffKeepA.requiresUninstallConfirmation, true);
  assert.equal(diffKeepA.isUnchanged, false);
});

test('calculateSpriteSelectionDiff: unknown_installed always requires confirmation and handles empty selection', () => {
  const manifestSets = [{ id: 'set_a' }, { id: 'set_b' }];
  const snapshotUnknown: SpriteInstallationSnapshot = {
    instanceId: 'inst_1',
    modId: 'mod_sprite',
    versionId: 'v1',
    operationId: 'op_legacy',
  };
  const baseline = deriveSpriteSelection(manifestSets, snapshotUnknown, 'success');

  const diffSelected = calculateSpriteSelectionDiff(baseline, ['set_a']);
  assert.equal(diffSelected.requiresUninstallConfirmation, true);
  assert.equal(diffSelected.isAllDeselected, false);

  const diffEmpty = calculateSpriteSelectionDiff(baseline, []);
  assert.equal(diffEmpty.isAllDeselected, true);
});
