import assert from 'node:assert/strict';
import test from 'node:test';

import { compareVersions, resolveHasUpdate, summarizeIntegrity, type IntegrityTotals } from './modHealth';

test('compareVersions compares numeric segments and pads missing ones', () => {
  assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.0', '1.3.0'), -1);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('2.0', '2.0.0'), 0);
  assert.equal(compareVersions('v1.2.3', '1.2.4'), -1);
  assert.equal(compareVersions('1.2.3-beta.1', '1.2.3'), 0);
  assert.equal(compareVersions('nightly', '1.0.0'), null);
});

test('resolveHasUpdate only claims an update when the catalog version is genuinely newer', () => {
  const base = { installedVersionId: 'ver_1', installedVersion: '1.2.0' };

  assert.equal(resolveHasUpdate({ ...base, latestVersionId: 'ver_2', latestVersion: '1.3.0' }), true);
  assert.equal(resolveHasUpdate({ ...base, latestVersionId: 'ver_1', latestVersion: '1.2.0' }), false);
  assert.equal(resolveHasUpdate({ ...base, latestVersionId: 'ver_2', latestVersion: '1.1.0' }), false);
  // 标识不同但版本号相同（重新上传同版本）：不算更新。
  assert.equal(resolveHasUpdate({ ...base, latestVersionId: 'ver_9', latestVersion: '1.2.0' }), false);
});

test('resolveHasUpdate stays false when there is nothing provable', () => {
  const installed = { installedVersionId: 'ver_1', installedVersion: '1.2.0' };

  // 目录里没有这个模组 / 没有可发布的版本。
  assert.equal(resolveHasUpdate({ ...installed }), false);
  assert.equal(resolveHasUpdate({ ...installed, latestVersionId: 'ver_2', latestVersion: '' }), false);
  // 本地版本未知：未托管、散落项。
  assert.equal(resolveHasUpdate({ installedVersionId: '', installedVersion: '未托管', latestVersionId: 'ver_2', latestVersion: '1.3.0' }), false);
  assert.equal(resolveHasUpdate({ installedVersionId: '', installedVersion: '', latestVersionId: 'ver_2', latestVersion: '1.3.0' }), false);
  // 版本号都不可解析时，只能靠标识是否相同下结论。
  assert.equal(resolveHasUpdate({ installedVersionId: 'a', installedVersion: 'nightly', latestVersionId: 'b', latestVersion: 'canary' }), true);
  assert.equal(resolveHasUpdate({ installedVersionId: 'a', installedVersion: 'nightly', latestVersionId: 'a', latestVersion: 'canary' }), false);
});

function totals(overrides: Partial<IntegrityTotals> = {}): IntegrityTotals {
  return {
    modCount: 2,
    checkedFiles: 12,
    driftedFiles: 0,
    overriddenFiles: 0,
    unmanagedFiles: 0,
    unreadableMods: [],
    ...overrides,
  };
}

test('summarizeIntegrity reports a clean ledger without inventing numbers', () => {
  const summary = summarizeIntegrity(totals());
  assert.equal(summary.tone, 'info');
  assert.match(summary.text, /托管文件 12 个，全部与账本一致/);
});

test('summarizeIntegrity separates drift, layered overrides, and files without a ledger', () => {
  const summary = summarizeIntegrity(totals({ driftedFiles: 3, overriddenFiles: 2, unmanagedFiles: 7 }));
  assert.equal(summary.tone, 'warn');
  assert.match(summary.text, /托管文件 12 个，其中 3 个哈希与账本不一致/);
  assert.match(summary.text, /2 个文件被其他模组覆盖（分层结果，非漂移）/);
  // 没有账本的散落文件不能被算进「与账本一致」。
  assert.match(summary.text, /7 个散落文件没有安装账本，未参与比对/);
  assert.doesNotMatch(summary.text, /全部与账本一致/);
});

test('summarizeIntegrity refuses to claim an all-clear when nothing was checked', () => {
  const empty = summarizeIntegrity(totals({ modCount: 0 }));
  assert.equal(empty.tone, 'warn');
  assert.match(empty.text, /当前没有可校验的已安装模组/);

  const noLedger = summarizeIntegrity(totals({ checkedFiles: 0, unmanagedFiles: 4 }));
  assert.equal(noLedger.tone, 'warn');
  assert.match(noLedger.text, /没有任何托管文件可供比对/);

  const unreadable = summarizeIntegrity(totals({ unreadableMods: ['A', 'B'] }));
  assert.equal(unreadable.tone, 'warn');
  assert.match(unreadable.text, /2 个模组读取清单失败/);
});
