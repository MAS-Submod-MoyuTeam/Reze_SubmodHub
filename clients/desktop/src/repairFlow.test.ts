import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPlanActionText, resolveModInstallationId } from './planExecution';
import type { InstalledItem, PlanKind } from './types/client';

test('resolveModInstallationId: resolves mod installation target rather than MAS instance ID', () => {
  const masInstanceId = 'default_mas_instance';

  // Case 1: installation_id exists from receipt (operation_id or mod_id)
  const item1: Pick<InstalledItem, 'installation_id' | 'managed_operation_id' | 'mod_id'> = {
    installation_id: 'op_install_submod_456',
    managed_operation_id: 'op_legacy_123',
    mod_id: 'submod_456',
  };
  const target1 = resolveModInstallationId(item1);
  assert.equal(target1, 'op_install_submod_456');
  assert.notEqual(target1, masInstanceId);

  // Case 2: installation_id undefined, falls back to managed_operation_id
  const item2: Pick<InstalledItem, 'installation_id' | 'managed_operation_id' | 'mod_id'> = {
    installation_id: undefined,
    managed_operation_id: 'op_legacy_123',
    mod_id: 'submod_456',
  };
  const target2 = resolveModInstallationId(item2);
  assert.equal(target2, 'op_legacy_123');
  assert.notEqual(target2, masInstanceId);

  // Case 3: only mod_id is present
  const item3: Pick<InstalledItem, 'installation_id' | 'managed_operation_id' | 'mod_id'> = {
    installation_id: undefined,
    managed_operation_id: undefined,
    mod_id: 'submod_456',
  };
  const target3 = resolveModInstallationId(item3);
  assert.equal(target3, 'submod_456');
  assert.notEqual(target3, masInstanceId);
});

test('getPlanActionText: distinguishes repair from uninstall, install, and update', () => {
  assert.equal(getPlanActionText('repair'), '修复');
  assert.equal(getPlanActionText('uninstall'), '卸载');
  assert.equal(getPlanActionText('install'), '安装');
  assert.equal(getPlanActionText('update'), '更新');

  // Verify failure message composition matches expectation
  const makeUncommittedError = (kind: PlanKind, state: string) =>
    `${getPlanActionText(kind)}事务执行未正常提交，状态为: ${state}`;

  assert.equal(makeUncommittedError('repair', 'uncommitted'), '修复事务执行未正常提交，状态为: uncommitted');
  assert.equal(makeUncommittedError('uninstall', 'uncommitted'), '卸载事务执行未正常提交，状态为: uncommitted');
  assert.equal(makeUncommittedError('install', 'blocked'), '安装事务执行未正常提交，状态为: blocked');
  assert.equal(makeUncommittedError('update', 'uncommitted'), '更新事务执行未正常提交，状态为: uncommitted');

  const makeToastError = (kind: PlanKind, message: string) =>
    `真实${getPlanActionText(kind)}失败：${message}`;

  assert.equal(makeToastError('repair', 'corrupted'), '真实修复失败：corrupted');
  assert.equal(makeToastError('uninstall', 'corrupted'), '真实卸载失败：corrupted');
});
