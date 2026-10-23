import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  describeRecoveryAvailability,
  TransactionDetailModal,
  buildDiagnostics,
} from './TransactionDetailModal';
import type { Operation } from '../types/client';

function makeOperation(override?: Partial<Operation>): Operation {
  return {
    operation_id: 'op_detail_1',
    installation_id: 'inst_1',
    mod_id: 'submod_detail_1',
    mod_title: 'Detail Test Submod',
    version_id: 'ver_1',
    version_str: '1.2.0',
    kind: 'install',
    state: 'committed',
    phase: 'committed',
    progress: {
      stage: '操作已成功提交',
      processed_files: 8,
      total_files: 8,
      bytes_processed: 0,
      total_bytes: 0,
      percent: 100,
    },
    backup_id: 'snapshot_op_detail_1',
    created_at: '2026-10-23T16:00:00Z',
    updated_at: '2026-10-23T16:00:10Z',
    can_rollback: false,
    ...override,
  };
}

function renderDetail(op: Operation): string {
  return renderToStaticMarkup(
    <TransactionDetailModal op={op} onClose={() => {}} onRecoverOperation={() => {}} />
  );
}

test('describeRecoveryAvailability: only missing material on a live transaction reads as a fault', () => {
  assert.deepEqual(describeRecoveryAvailability(makeOperation({ state: 'recoverable', can_rollback: true })), {
    label: '恢复材料可用：可安全回滚',
    tone: 'ready',
  });
  assert.deepEqual(describeRecoveryAvailability(makeOperation({ state: 'committed', can_rollback: false })), {
    label: '事务已提交：无回滚材料',
    tone: 'finished',
  });
  assert.deepEqual(describeRecoveryAvailability(makeOperation({ state: 'rolled_back', can_rollback: false })), {
    label: '事务已回滚：无待处理变更',
    tone: 'finished',
  });
  assert.deepEqual(
    describeRecoveryAvailability(makeOperation({ state: 'needs_manual_recovery', can_rollback: false })),
    { label: '恢复材料缺失：需人工处理', tone: 'blocked' }
  );
});

test('TransactionDetailModal: a finished transaction never claims a missing recovery material', () => {
  const html = renderDetail(makeOperation({ state: 'committed', can_rollback: false }));

  assert.match(html, /role="dialog"/);
  assert.match(html, /事务已提交：无回滚材料/);
  assert.doesNotMatch(html, /恢复材料缺失/);
  // Committed transactions have no rollback action to offer.
  assert.doesNotMatch(html, /安全回滚/);
});

test('TransactionDetailModal: conflict path and hashes render only when the backend supplies them', () => {
  const conflict = renderDetail(
    makeOperation({
      state: 'needs_manual_recovery',
      can_rollback: true,
      conflict_path: 'game/submods/ExtraPlus/extraplus.rpy',
      expected_hash: 'a'.repeat(64),
      actual_hash: 'b'.repeat(64),
      error: { code: 'external_change', message: '目标文件已被外部修改' },
    })
  );

  assert.match(conflict, /冲突文件路径/);
  assert.match(conflict, /game\/submods\/ExtraPlus\/extraplus\.rpy/);
  assert.match(conflict, /Ledger 期望 SHA-256/);
  assert.match(conflict, /磁盘实测 SHA-256/);
  assert.match(conflict, /恢复材料可用：可安全回滚/);
  assert.match(conflict, /重新校验并安全回滚/);

  const healthy = renderDetail(makeOperation({ state: 'committed', can_rollback: false }));

  // Regression: conflict_path used to mirror the journal's LastPath, so every
  // committed operation advertised a conflict that never happened.
  assert.doesNotMatch(healthy, /冲突文件路径/);
  assert.doesNotMatch(healthy, /Ledger 期望 SHA-256/);
  assert.doesNotMatch(healthy, /磁盘实测 SHA-256/);
});

test('TransactionDetailModal: no byte counters, because the backend never fills them', () => {
  const html = renderDetail(
    makeOperation({
      progress: {
        stage: '正在应用文件变更 (3/8)',
        processed_files: 3,
        total_files: 8,
        bytes_processed: 0,
        total_bytes: 0,
        percent: 37,
      },
    })
  );

  assert.doesNotMatch(html, /字节/);
  assert.doesNotMatch(html, /NaN/);
  // File-level progress is still the real signal and must stay visible.
  assert.match(html, /3 \/ 8 文件 · 37%/);
});

test('TransactionDetailModal: the JSON disclosure and the copy payload are the same document', () => {
  const op = makeOperation({ state: 'needs_manual_recovery', can_rollback: true, conflict_path: 'a/b.rpy' });
  const html = renderDetail(op);
  const payload = buildDiagnostics(op);

  assert.match(html, /复制诊断信息/);
  assert.deepEqual(JSON.parse(payload).operation, JSON.parse(JSON.stringify(op)));
  // The disclosure prints the whole payload (exported_at included), not just the operation.
  assert.ok(html.includes('&quot;exported_at&quot;'), 'expected the exported_at wrapper in the disclosure');
  assert.ok(html.includes('&quot;conflict_path&quot;'), 'expected operation fields in the disclosure');
});
