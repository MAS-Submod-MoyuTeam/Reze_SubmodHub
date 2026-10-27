import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TRANSACTION_IN_PROGRESS,
  describeLaunchFailure,
  hasInProgressTransaction,
  isOperationInProgress,
  isTransactionInProgressError,
} from './launchGuard';
import type { Operation, OperationState } from './types/client';

function operation(state: OperationState): Operation {
  return {
    operation_id: `op_${state}`,
    installation_id: 'mas-1',
    mod_id: 'mod_1',
    mod_title: 'Mod',
    version_id: 'ver_1',
    version_str: '1.0.0',
    kind: 'install',
    state,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    progress: {
      stage: '',
      processed_files: 0,
      total_files: 0,
      bytes_processed: 0,
      total_bytes: 0,
      percent: 0,
    },
  };
}

test('只要存在非终态事务，启动入口就必须被围栏', () => {
  assert.equal(hasInProgressTransaction([]), false);
  assert.equal(isOperationInProgress(operation('planned')), true);
  assert.equal(isOperationInProgress(operation('recoverable')), true);
  assert.equal(hasInProgressTransaction([operation('committed'), operation('recoverable')]), true);
});

test('终态事务不阻止启动游戏', () => {
  for (const state of ['committed', 'rolled_back', 'needs_manual_recovery', 'query_failed'] as OperationState[]) {
    assert.equal(isOperationInProgress(operation(state)), false, `${state} 应视为已结束`);
  }
  assert.equal(hasInProgressTransaction([operation('committed'), operation('rolled_back')]), false);
});

test('按稳定错误码识别事务拦截，不依赖错误文本拼接', () => {
  assert.equal(isTransactionInProgressError(new Error(TRANSACTION_IN_PROGRESS)), true);
  assert.equal(isTransactionInProgressError(new Error('transaction_in_progress: refused')), true);
  assert.equal(isTransactionInProgressError('transaction_in_progress'), true);
  assert.equal(isTransactionInProgressError(new Error('mas_executable_missing')), false);
  assert.equal(isTransactionInProgressError(null), false);
});

test('事务拦截的提示说明原因与下一步，其他失败保留原始错误码', () => {
  const blocked = describeLaunchFailure(new Error(TRANSACTION_IN_PROGRESS));
  assert.match(blocked, /事务进行中/);
  assert.match(blocked, /等待事务提交或回滚完成/);

  assert.equal(describeLaunchFailure(new Error('mas_executable_missing')), '启动失败：mas_executable_missing');
});
