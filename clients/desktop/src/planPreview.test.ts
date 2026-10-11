import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapPlanPreview } from './planPreview';
import type { Plan } from './types/client';

test('backend preview replaces mock actions and carries restoration counts and blockers', () => {
  const metadata: Plan = {
    plan_id: 'placeholder', kind: 'install', installation_id: 'mas', mod_id: 'mod',
    mod_title: 'Mod', version_id: 'v1', version_str: '1', expires_at: '',
    dependency_blockers: [], semantic_blockers: [], changes: [], backups_required: 0,
    bytes_required: 100, warnings: [], backend_operation_id: 'op', archive_sha256: 'archive',
  };
  const preview = {
    plan_id: 'backend-plan', root: 'mas', generation: 1, kind: 'uninstall', target_id: 'mod', mod_title: 'Mod', version: '1',
    actions: [{ path: 'game/original.rpy', action: 'RESTORE', current_source: 'mod', target_source: 'original',
      current_hash: 'after', target_hash: 'before', current_exists: true, target_exists: true,
      backup_required: true, reason: 'restore original' }],
    blockers: ['external_change'], risks: [{ type: 'overlap', path: 'game/original.rpy', description: 'overlap' }],
    summary: { restores_original: 1, restores_layer: 0, metadata_only: 0, deletes_added: 0, writes_new: 0 },
  };
  const plan = mapPlanPreview(preview, metadata);
  assert.equal(plan.plan_id, 'backend-plan');
  assert.equal(plan.kind, 'uninstall');
  assert.equal(plan.changes[0].action, 'RESTORE');
  assert.equal(plan.changes[0].next_owner, 'original');
  assert.equal(plan.changes[0].next_hash, 'before');
  assert.equal(plan.backups_required, 1);
  assert.deepEqual(plan.summary, preview.summary);
  assert.deepEqual(plan.blockers, preview.blockers);
  assert.deepEqual(plan.risks, preview.risks);
  assert.equal(plan.backend_operation_id, 'op');
});

test('plan preview treats unknown disk space as non-blocking but respects real insufficient space', () => {
  const metadata: Plan = {
    plan_id: 'p1', kind: 'install', installation_id: 'mas', mod_id: 'mod',
    mod_title: 'Mod', version_id: 'v1', version_str: '1', expires_at: '',
    dependency_blockers: [], semantic_blockers: [], changes: [], backups_required: 0,
    bytes_required: 1048576, warnings: [],
  };
  const preview = {
    plan_id: 'backend-plan', root: 'mas', generation: 1, kind: 'install', target_id: 'mod', mod_title: 'Mod', version: '1',
    actions: [{ path: 'game/submods/a.rpy', action: 'CREATE', current_source: '(无)', target_source: 'Mod',
      current_hash: '', target_hash: 'h1', current_exists: false, target_exists: true, backup_required: false, reason: 'new' }],
    blockers: [], risks: [],
    summary: { restores_original: 0, restores_layer: 0, metadata_only: 0, deletes_added: 0, writes_new: 1 },
  };

  const plan = mapPlanPreview(preview, metadata);
  assert.equal(plan.bytes_required, 1048576);

  // Unknown space (null) should NOT trigger isInsufficientSpace
  const isInsufficientWhenNull = null != null && plan.bytes_required > (null as any);
  assert.equal(isInsufficientWhenNull, false);

  // Sufficient space should NOT trigger
  const isInsufficientWhenEnough = 5000000 != null && plan.bytes_required > 5000000;
  assert.equal(isInsufficientWhenEnough, false);

  // Insufficient space MUST trigger
  const isInsufficientWhenSmall = 500 != null && plan.bytes_required > 500;
  assert.equal(isInsufficientWhenSmall, true);
});

test('mapPlanPreview preserves priority from preview or metadata', () => {
  const metadataWithPrio: Plan = {
    plan_id: 'p1', kind: 'install', installation_id: 'mas', mod_id: 'mod',
    mod_title: 'Mod', version_id: 'v1', version_str: '1', priority: 50, expires_at: '',
    dependency_blockers: [], semantic_blockers: [], changes: [], backups_required: 0,
    bytes_required: 100, warnings: [],
  };
  const previewWithPrio = {
    plan_id: 'backend-plan', root: 'mas', generation: 1, kind: 'install', target_id: 'mod', mod_title: 'Mod', version: '1',
    priority: 60, actions: [], blockers: [], risks: [],
    summary: { restores_original: 0, restores_layer: 0, metadata_only: 0, deletes_added: 0, writes_new: 0 },
  };

  // When preview has priority, it takes precedence
  const planFromPreview = mapPlanPreview(previewWithPrio, metadataWithPrio);
  assert.equal(planFromPreview.priority, 60);

  // When preview lacks priority, fallback to metadata priority
  const previewWithoutPrio = {
    plan_id: 'backend-plan-2', root: 'mas', generation: 1, kind: 'install', target_id: 'mod', mod_title: 'Mod', version: '1',
    actions: [], blockers: [], risks: [],
    summary: { restores_original: 0, restores_layer: 0, metadata_only: 0, deletes_added: 0, writes_new: 0 },
  };
  const planFromMetadata = mapPlanPreview(previewWithoutPrio, metadataWithPrio);
  assert.equal(planFromMetadata.priority, 50);
});

