import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createInstalledLoadCoordinator,
  isActionBlocked,
} from './installedLoading';

test('initial status is idle without misleading empty or 0 count state', () => {
  const coordinator = createInstalledLoadCoordinator();
  assert.equal(coordinator.getModsStatus(), 'idle');
  assert.equal(coordinator.getSpritepacksStatus(), 'idle');
  assert.equal(coordinator.getModsError(), null);
  assert.equal(coordinator.getSpritepacksError(), null);
  assert.equal(coordinator.isModsInitialLoading(), false);
  assert.equal(coordinator.isSpritepacksInitialLoading(), false);
  assert.equal(coordinator.getActiveInstanceId(), null);
});

test('first scan transitions to loading with isInitialLoading true', () => {
  const coordinator = createInstalledLoadCoordinator('inst-1');
  const token = coordinator.beginModsScan('inst-1');
  assert.ok(token);
  assert.equal(token.instanceId, 'inst-1');
  assert.equal(coordinator.getModsStatus(), 'loading');
  assert.equal(coordinator.isModsInitialLoading(), true);
  assert.equal(coordinator.isModsRefreshing(), false);

  const completed = coordinator.completeModsScan(token, [{ id: 'mod-1' }]);
  assert.equal(completed, true);
  assert.equal(coordinator.getModsStatus(), 'success');
  assert.equal(coordinator.isModsInitialLoading(), false);
  assert.equal(coordinator.isModsRefreshing(), false);
});

test('refresh on same instance transitions to loading with isRefreshing true, keeping initialLoading false', () => {
  const coordinator = createInstalledLoadCoordinator('inst-1');
  const token1 = coordinator.beginModsScan('inst-1');
  assert.ok(token1);
  coordinator.completeModsScan(token1, [{ id: 'mod-1' }]);

  const token2 = coordinator.beginModsScan('inst-1');
  assert.ok(token2);
  assert.equal(coordinator.getModsStatus(), 'loading');
  assert.equal(coordinator.isModsInitialLoading(), false);
  assert.equal(coordinator.isModsRefreshing(), true);

  coordinator.completeModsScan(token2, [{ id: 'mod-1' }, { id: 'mod-2' }]);
  assert.equal(coordinator.getModsStatus(), 'success');
  assert.equal(coordinator.isModsRefreshing(), false);
});

test('switching instance invalidates pending scan from old instance', () => {
  const coordinator = createInstalledLoadCoordinator('inst-A');
  const tokenA = coordinator.beginModsScan('inst-A');
  assert.ok(tokenA);
  assert.equal(coordinator.isModsInitialLoading(), true);

  // Switch to inst-B via instance switch entrypoint
  coordinator.resetForInstance('inst-B');
  const tokenB = coordinator.beginModsScan('inst-B');
  assert.ok(tokenB);
  assert.equal(coordinator.isModsInitialLoading(), true);

  // Old scan from inst-A finishes later
  const resA = coordinator.completeModsScan(tokenA, [{ id: 'old-mod' }]);
  assert.equal(resA, false, 'Late completion from old instance should be rejected');
  assert.equal(coordinator.getModsStatus(), 'loading', 'Status should still reflect active inst-B request');

  // inst-B completes
  const resB = coordinator.completeModsScan(tokenB, [{ id: 'new-mod' }]);
  assert.equal(resB, true);
  assert.equal(coordinator.getModsStatus(), 'success');
});

test('late error from superseded instance request is ignored', () => {
  const coordinator = createInstalledLoadCoordinator('inst-A');
  const tokenA = coordinator.beginModsScan('inst-A');
  assert.ok(tokenA);

  coordinator.resetForInstance('inst-B');
  const tokenB = coordinator.beginModsScan('inst-B');
  assert.ok(tokenB);

  // Error from old tokenA returns
  const failedA = coordinator.failModsScan(tokenA, 'inst-A disconnected');
  assert.equal(failedA, false, 'Late failure from superseded instance should be ignored');
  assert.equal(coordinator.getModsStatus(), 'loading', 'Should remain loading inst-B');
  assert.equal(coordinator.getModsError(), null);

  // Failure for current tokenB is accepted
  const failedB = coordinator.failModsScan(tokenB, 'inst-B failed');
  assert.equal(failedB, true);
  assert.equal(coordinator.getModsStatus(), 'error');
  assert.equal(coordinator.getModsError(), 'inst-B failed');
});

test('error on first scan sets error status and clears loading', () => {
  const coordinator = createInstalledLoadCoordinator('inst-1');
  const token = coordinator.beginModsScan('inst-1');
  assert.ok(token);

  const failed = coordinator.failModsScan(token, '磁盘读取受限');
  assert.equal(failed, true);
  assert.equal(coordinator.getModsStatus(), 'error');
  assert.equal(coordinator.getModsError(), '磁盘读取受限');
  assert.equal(coordinator.isModsInitialLoading(), false);
  assert.equal(coordinator.isModsRefreshing(), false);
});

test('error on refresh sets error status but caller can preserve previous list', () => {
  const coordinator = createInstalledLoadCoordinator('inst-1');
  const token1 = coordinator.beginModsScan('inst-1');
  assert.ok(token1);
  coordinator.completeModsScan(token1, [{ id: 'mod-1' }]);

  const token2 = coordinator.beginModsScan('inst-1');
  assert.ok(token2);
  coordinator.failModsScan(token2, '扫描超时');
  assert.equal(coordinator.getModsStatus(), 'error');
  assert.equal(coordinator.getModsError(), '扫描超时');
  assert.equal(coordinator.isModsRefreshing(), false);
});

test('spritepacks scan lifecycle is independent of mods scan', () => {
  const coordinator = createInstalledLoadCoordinator('inst-1');
  const modToken = coordinator.beginModsScan('inst-1');
  const spriteToken = coordinator.beginSpritepacksScan('inst-1');
  assert.ok(modToken);
  assert.ok(spriteToken);

  assert.equal(coordinator.getModsStatus(), 'loading');
  assert.equal(coordinator.getSpritepacksStatus(), 'loading');

  // Mod scan fails, spritepacks succeed
  coordinator.failModsScan(modToken, 'mod_failed');
  assert.equal(coordinator.getModsStatus(), 'error');
  assert.equal(coordinator.getSpritepacksStatus(), 'loading');

  coordinator.completeSpritepacksScan(spriteToken, [{ name: 'hair' }]);
  assert.equal(coordinator.getSpritepacksStatus(), 'success');
});

test('deduplicates concurrent refresh if already scanning same instance and target', () => {
  const coordinator = createInstalledLoadCoordinator('inst-1');
  const token1 = coordinator.beginModsScan('inst-1');
  assert.ok(token1);

  // Attempt second scan on same instance before first completes
  const token2 = coordinator.beginModsScan('inst-1');
  assert.equal(token2, null, 'Concurrent scan for same instance should be debounced / deduplicated');

  // Once first completes, a new refresh can start
  coordinator.completeModsScan(token1, []);
  const token3 = coordinator.beginModsScan('inst-1');
  assert.ok(token3, 'Subsequent scan should be allowed after previous finishes');
});

test('unverified / empty instance transitions to idle and resets hasEverLoaded', () => {
  const coordinator = createInstalledLoadCoordinator('inst-1');
  const token1 = coordinator.beginModsScan('inst-1');
  assert.ok(token1);
  coordinator.completeModsScan(token1, []);
  assert.equal(coordinator.getModsStatus(), 'success');

  coordinator.resetForInstance('unverified');
  assert.equal(coordinator.getModsStatus(), 'idle');
  assert.equal(coordinator.getSpritepacksStatus(), 'idle');
  assert.equal(coordinator.isModsInitialLoading(), false);

  // beginScan on unverified returns null
  assert.equal(coordinator.beginModsScan('unverified'), null);
  assert.equal(coordinator.beginSpritepacksScan('unverified'), null);
  assert.equal(coordinator.beginModsScan(''), null);
});

test('forced scan via waitForSpritepacksScan queues while in-flight and rejects stale in-flight scan result', async () => {
  const coordinator = createInstalledLoadCoordinator('inst-1');
  const token1 = coordinator.beginSpritepacksScan('inst-1');
  assert.ok(token1);
  assert.equal(token1.sequence, 1);

  // While token1 scan is in-flight, a spritepack is deleted and a forced refresh is requested
  const token2Promise = coordinator.waitForSpritepacksScan('inst-1', { forced: true });
  assert.equal(coordinator.hasQueuedSpritepacksScan(), true);

  // Stale token1 completes with pre-deletion data; it must be rejected!
  const completedStale = coordinator.completeSpritepacksScan(token1, [{ name: 'deleted-sprite' }]);
  assert.equal(completedStale, false, 'Pre-mutation scan result must be rejected when forced refresh was queued');
  assert.equal(coordinator.getSpritepacksStatus(), 'loading');

  // The queued forced refresh must resolve with a fresh token
  const token2 = await token2Promise;
  assert.ok(token2);
  assert.equal(token2.sequence, 2);
  assert.equal(coordinator.getSpritepacksStatus(), 'loading');

  // The fresh token completes with authoritative data
  const completedFresh = coordinator.completeSpritepacksScan(token2, [{ name: 'remaining-sprite' }]);
  assert.equal(completedFresh, true);
  assert.equal(coordinator.getSpritepacksStatus(), 'success');
  assert.equal(coordinator.hasQueuedSpritepacksScan(), false);
});

test('forced scan via synchronous beginSpritepacksScan supersedes in-flight scan', () => {
  const coordinator = createInstalledLoadCoordinator('inst-1');
  const token1 = coordinator.beginSpritepacksScan('inst-1');
  assert.ok(token1);
  assert.equal(token1.sequence, 1);

  // Synchronous forced scan replaces sequence immediately
  const token2 = coordinator.beginSpritepacksScan('inst-1', { forced: true });
  assert.ok(token2);
  assert.equal(token2.sequence, 2);

  // token1 is now obsolete and rejected
  assert.equal(coordinator.completeSpritepacksScan(token1, [{ name: 'old' }]), false);
  // token2 is accepted
  assert.equal(coordinator.completeSpritepacksScan(token2, [{ name: 'new' }]), true);
  assert.equal(coordinator.getSpritepacksStatus(), 'success');
});

test('switching instance cancels queued forced refresh', async () => {
  const coordinator = createInstalledLoadCoordinator('inst-1');
  const token1 = coordinator.beginModsScan('inst-1');
  assert.ok(token1);

  const queuedPromise = coordinator.waitForModsScan('inst-1', { forced: true });
  coordinator.resetForInstance('inst-2');

  const queuedToken = await queuedPromise;
  assert.equal(queuedToken, null, 'Queued request should resolve to null on instance switch');
  assert.equal(coordinator.hasQueuedModsScan(), false);
});

test('in-flight failure with queued forced refresh does not set error and runs queued scan', async () => {
  const coordinator = createInstalledLoadCoordinator('inst-1');
  const token1 = coordinator.beginModsScan('inst-1');
  assert.ok(token1);

  const queuedPromise = coordinator.waitForModsScan('inst-1', { forced: true });
  const failedOld = coordinator.failModsScan(token1, 'disk error before delete');
  assert.equal(failedOld, false, 'Obsolete failure should not leak to state');
  assert.notEqual(coordinator.getModsStatus(), 'error');
  assert.equal(coordinator.getModsStatus(), 'loading');

  const token2 = await queuedPromise;
  assert.ok(token2);
  assert.equal(coordinator.completeModsScan(token2, [{ id: 'mod-1' }]), true);
  assert.equal(coordinator.getModsStatus(), 'success');
});

test('scan request for non-active instance is rejected without changing active instance', () => {
  const coordinator = createInstalledLoadCoordinator('inst-A');
  assert.equal(coordinator.getActiveInstanceId(), 'inst-A');

  // Attempt to scan inst-B without switching instance
  const tokenB = coordinator.beginModsScan('inst-B');
  assert.equal(tokenB, null, 'beginModsScan for non-active instance must be rejected');
  assert.equal(coordinator.getActiveInstanceId(), 'inst-A', 'Active instance must remain inst-A');

  const spriteTokenB = coordinator.beginSpritepacksScan('inst-B');
  assert.equal(spriteTokenB, null, 'beginSpritepacksScan for non-active instance must be rejected');
  assert.equal(coordinator.getActiveInstanceId(), 'inst-A');
});

test('waitForScan for non-active instance is rejected and does not cancel or interfere with current scan', async () => {
  const coordinator = createInstalledLoadCoordinator('inst-B');
  const tokenB = coordinator.beginModsScan('inst-B');
  assert.ok(tokenB);
  assert.equal(coordinator.getModsStatus(), 'loading');

  // Stale callback from inst-A attempts forced refresh for inst-A
  const staleTokenPromise = coordinator.waitForSpritepacksScan('inst-A', { forced: true });
  const staleToken = await staleTokenPromise;
  assert.equal(staleToken, null, 'waitForSpritepacksScan for non-active instance must resolve to null');
  assert.equal(coordinator.getActiveInstanceId(), 'inst-B', 'Active instance must remain inst-B');
  assert.equal(coordinator.hasQueuedSpritepacksScan(), false, 'Should not queue forced scan for stale instance');

  // inst-B scan completes normally
  const completedB = coordinator.completeModsScan(tokenB, [{ id: 'mod-b' }]);
  assert.equal(completedB, true);
  assert.equal(coordinator.getModsStatus(), 'success');
});

test('reproduction: stale delete callback for inst-A does not disturb inst-B scan after switch', async () => {
  const coordinator = createInstalledLoadCoordinator('inst-A');

  // Instance A initial scan completes
  const tokenA = coordinator.beginSpritepacksScan('inst-A');
  assert.ok(tokenA);
  coordinator.completeSpritepacksScan(tokenA, [{ name: 'hair-A' }]);
  assert.equal(coordinator.getSpritepacksStatus(), 'success');

  // DeleteSpritepack is initiated on inst-A...
  const deleteOpStartedFor = 'inst-A';

  // While DeleteSpritepack is in-flight, user switches to inst-B:
  coordinator.resetForInstance('inst-B');
  assert.equal(coordinator.getActiveInstanceId(), 'inst-B');

  // inst-B scan begins:
  const tokenB = coordinator.beginSpritepacksScan('inst-B');
  assert.ok(tokenB);
  assert.equal(coordinator.getSpritepacksStatus(), 'loading');

  // DeleteSpritepack finishes on old instance, stale callback attempts forced refresh for inst-A:
  const staleToken = await coordinator.waitForSpritepacksScan(deleteOpStartedFor, { forced: true });
  assert.equal(staleToken, null, 'Stale refresh request for inst-A must be rejected');

  // Coordinator must remain on inst-B with its scan in-flight, not superseded or queued
  assert.equal(coordinator.getActiveInstanceId(), 'inst-B');
  assert.equal(coordinator.hasQueuedSpritepacksScan(), false);
  assert.equal(coordinator.getSpritepacksStatus(), 'loading');

  // inst-B scan completes with B data:
  const completedB = coordinator.completeSpritepacksScan(tokenB, [{ name: 'hair-B' }]);
  assert.equal(completedB, true);
  assert.equal(coordinator.getSpritepacksStatus(), 'success');
});

test('isActionBlocked blocks dangerous operations during loading, error, and unverified instance', () => {
  // Invalid or unverified instance
  assert.equal(isActionBlocked('success', false), true, 'Must block when instance is invalid');
  assert.equal(isActionBlocked('idle', false), true, 'Must block when instance is invalid and idle');

  // Valid instance in error state
  assert.equal(isActionBlocked('error', true), true, 'Must block when data source is in error status');

  // Valid instance while loading
  assert.equal(isActionBlocked('loading', true), true, 'Must block when status is loading');
  assert.equal(isActionBlocked('loading', true, true, false), true, 'Must block during initial loading');
  assert.equal(isActionBlocked('loading', true, false, true), true, 'Must block during refreshing');

  // Valid instance with successful read
  assert.equal(isActionBlocked('success', true, false, false), false, 'Must allow operations when scan is successful');
});
