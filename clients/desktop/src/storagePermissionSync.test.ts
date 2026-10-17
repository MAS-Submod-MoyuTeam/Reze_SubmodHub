import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createStoragePermissionSyncer,
  isInstanceAuthorized,
  reconcileInstanceState,
  shouldResetOperationState,
  subscribeStorageStateChanged,
} from './storagePermissionSync';
import type { AndroidStorageAccessStatus, MASInstancesState } from './wails';

test('isInstanceAuthorized returns true only when valid and game_exists are both true', () => {
  assert.equal(isInstanceAuthorized({ status: { valid: true, game_exists: true } }), true);
  assert.equal(isInstanceAuthorized({ status: { valid: false, game_exists: true } }), false);
  assert.equal(isInstanceAuthorized({ status: { valid: true, game_exists: false } }), false);
  assert.equal(isInstanceAuthorized({ status: { valid: false, game_exists: false } }), false);
  assert.equal(isInstanceAuthorized(null), false);
  assert.equal(isInstanceAuthorized(undefined), false);
});

test('createStoragePermissionSyncer: refreshes instances when permission is revoked (denied)', async () => {
  let storageState = 'granted';
  let isRefreshing = false;
  let syncedState: MASInstancesState | null = null;

  const mockGetStorageAccess = async (): Promise<AndroidStorageAccessStatus> => ({
    state: 'denied',
    root: '/storage/emulated/0/MAS',
    game_path: '/storage/emulated/0/MAS/game',
  });

  const mockListInstances = async (): Promise<MASInstancesState> => ({
    instances: [
      {
        id: 'android-mas',
        label: 'MAS (Android)',
        root: '/storage/emulated/0/MAS',
        status: { valid: false, game_exists: false, submods: 0 },
      },
    ],
    active_id: 'android-mas',
  });

  const syncer = createStoragePermissionSyncer({
    isAndroid: true,
    getStorageAccess: mockGetStorageAccess,
    listInstances: mockListInstances,
    syncInstances: (state) => {
      syncedState = state;
    },
    setStorageState: (state) => {
      storageState = state;
    },
    setIsStorageRefreshing: (refreshing) => {
      isRefreshing = refreshing;
    },
  });

  await syncer();

  assert.equal(storageState, 'denied');
  assert.equal(isRefreshing, false);
  assert.ok(syncedState !== null);
  assert.equal((syncedState as MASInstancesState).instances[0].status.valid, false);
});

test('createStoragePermissionSyncer: refreshes instances when permission is granted', async () => {
  let storageState = 'denied';
  let isRefreshing = false;
  let syncedState: MASInstancesState | null = null;

  const mockGetStorageAccess = async (): Promise<AndroidStorageAccessStatus> => ({
    state: 'granted',
    root: '/storage/emulated/0/MAS',
    game_path: '/storage/emulated/0/MAS/game',
  });

  const mockListInstances = async (): Promise<MASInstancesState> => ({
    instances: [
      {
        id: 'android-mas',
        label: 'MAS (Android)',
        root: '/storage/emulated/0/MAS',
        status: { valid: true, game_exists: true, submods: 5 },
      },
    ],
    active_id: 'android-mas',
  });

  const syncer = createStoragePermissionSyncer({
    isAndroid: true,
    getStorageAccess: mockGetStorageAccess,
    listInstances: mockListInstances,
    syncInstances: (state) => {
      syncedState = state;
    },
    setStorageState: (state) => {
      storageState = state;
    },
    setIsStorageRefreshing: (refreshing) => {
      isRefreshing = refreshing;
    },
  });

  await syncer();

  assert.equal(storageState, 'granted');
  assert.equal(isRefreshing, false);
  assert.ok(syncedState !== null);
  assert.equal((syncedState as MASInstancesState).instances[0].status.valid, true);
});

test('createStoragePermissionSyncer: falls back to error state and attempts instance sync on exception', async () => {
  let storageState = 'pending';
  let isRefreshing = false;
  let syncedState: MASInstancesState | null = null;

  const mockGetStorageAccess = async (): Promise<AndroidStorageAccessStatus> => {
    throw new Error('JNI call failed');
  };

  const mockListInstances = async (): Promise<MASInstancesState> => ({
    instances: [
      {
        id: 'android-mas',
        label: 'MAS (Android)',
        root: '/storage/emulated/0/MAS',
        status: { valid: false, game_exists: false, submods: 0 },
      },
    ],
    active_id: 'android-mas',
  });

  const syncer = createStoragePermissionSyncer({
    isAndroid: true,
    getStorageAccess: mockGetStorageAccess,
    listInstances: mockListInstances,
    syncInstances: (state) => {
      syncedState = state;
    },
    setStorageState: (state) => {
      storageState = state;
    },
    setIsStorageRefreshing: (refreshing) => {
      isRefreshing = refreshing;
    },
  });

  await syncer();

  assert.equal(storageState, 'error');
  assert.equal(isRefreshing, false);
  assert.ok(syncedState !== null);
  assert.equal((syncedState as MASInstancesState).instances[0].status.valid, false);
});

test('subscribeStorageStateChanged: registers Wails event and unsubscribes cleanly', () => {
  let registeredEvent = '';
  let listener: ((event?: unknown) => void) | null = null;
  let unsubscribed = false;
  let changeFired = 0;

  const mockEventsOn = (eventName: string, cb: (event?: unknown) => void) => {
    registeredEvent = eventName;
    listener = cb;
    return () => {
      unsubscribed = true;
    };
  };

  const cleanup = subscribeStorageStateChanged(() => {
    changeFired++;
  }, {
    eventsOn: mockEventsOn,
  });

  assert.equal(registeredEvent, 'submodhub:storage_state_changed');
  assert.ok(listener !== null);
  assert.equal(changeFired, 0);

  // Trigger event via listener
  if (typeof listener === 'function') {
    (listener as () => void)();
  } else {
    assert.fail('listener was not assigned');
  }
  assert.equal(changeFired, 1);

  // Teardown
  cleanup();
  assert.equal(unsubscribed, true);
});

test('subscribeStorageStateChanged: registers window event listener fallback and cleans up', () => {
  let domListeners: Record<string, () => void> = {};
  let removedListeners: string[] = [];

  const mockWindow = {
    addEventListener: (event: string, cb: () => void) => {
      domListeners[event] = cb;
    },
    removeEventListener: (event: string) => {
      removedListeners.push(event);
      delete domListeners[event];
    },
  };

  let changeFired = 0;
  const cleanup = subscribeStorageStateChanged(() => {
    changeFired++;
  }, {
    eventsOn: () => () => {},
    windowTarget: mockWindow as any,
  });

  assert.ok('submodhub:storage_state_changed' in domListeners);
  domListeners['submodhub:storage_state_changed']();
  assert.equal(changeFired, 1);

  cleanup();
  assert.ok(removedListeners.includes('submodhub:storage_state_changed'));
  assert.equal('submodhub:storage_state_changed' in domListeners, false);
});

test('reconcileInstanceState: active instance unchanged and still authorized does NOT reset operations or scan', () => {
  const result = reconcileInstanceState({
    currentActiveId: 'android-mas',
    currentAuthorized: true,
    nextActiveId: 'android-mas',
    nextAuthorized: true,
    reason: 'permission_refresh',
  });

  assert.equal(result.instanceChanged, false);
  assert.equal(result.permissionRevoked, false);
  assert.equal(result.permissionGranted, false);
  assert.equal(result.shouldResetOperations, false);
  assert.equal(result.shouldTriggerScan, false);
});

test('reconcileInstanceState: active instance unchanged and permission revoked DOES reset operations without scan', () => {
  const result = reconcileInstanceState({
    currentActiveId: 'android-mas',
    currentAuthorized: true,
    nextActiveId: 'android-mas',
    nextAuthorized: false,
    reason: 'permission_refresh',
  });

  assert.equal(result.instanceChanged, false);
  assert.equal(result.permissionRevoked, true);
  assert.equal(result.permissionGranted, false);
  assert.equal(result.shouldResetOperations, true);
  assert.equal(result.shouldTriggerScan, false);
});

test('reconcileInstanceState: active instance unchanged and permission newly granted triggers scan without resetting operations', () => {
  const result = reconcileInstanceState({
    currentActiveId: 'android-mas',
    currentAuthorized: false,
    nextActiveId: 'android-mas',
    nextAuthorized: true,
    reason: 'permission_refresh',
  });

  assert.equal(result.instanceChanged, false);
  assert.equal(result.permissionRevoked, false);
  assert.equal(result.permissionGranted, true);
  assert.equal(result.shouldResetOperations, false);
  assert.equal(result.shouldTriggerScan, true);
});

test('reconcileInstanceState: active instance changed resets operations and triggers scan if next is authorized', () => {
  const result = reconcileInstanceState({
    currentActiveId: 'android-mas',
    currentAuthorized: true,
    nextActiveId: 'custom-mas',
    nextAuthorized: true,
    reason: 'switch',
  });

  assert.equal(result.instanceChanged, true);
  assert.equal(result.permissionRevoked, false);
  assert.equal(result.shouldResetOperations, true);
  assert.equal(result.shouldTriggerScan, true);
});

test('reconcileInstanceState: active instance changed to unauthorized resets operations without scanning', () => {
  const result = reconcileInstanceState({
    currentActiveId: 'android-mas',
    currentAuthorized: true,
    nextActiveId: 'unverified',
    nextAuthorized: false,
    reason: 'switch',
  });

  assert.equal(result.instanceChanged, true);
  assert.equal(result.permissionRevoked, false);
  assert.equal(result.shouldResetOperations, true);
  assert.equal(result.shouldTriggerScan, false);
});

test('reconcileInstanceState: forceReset forces operations reset regardless of instance match', () => {
  const result = reconcileInstanceState({
    currentActiveId: 'android-mas',
    currentAuthorized: true,
    nextActiveId: 'android-mas',
    nextAuthorized: true,
    forceReset: true,
  });

  assert.equal(result.instanceChanged, false);
  assert.equal(result.shouldResetOperations, true);
});

test('shouldResetOperationState matches reconcileInstanceState.shouldResetOperations', () => {
  assert.equal(
    shouldResetOperationState({
      currentActiveId: 'android-mas',
      currentAuthorized: true,
      nextActiveId: 'android-mas',
      nextAuthorized: true,
    }),
    false
  );

  assert.equal(
    shouldResetOperationState({
      currentActiveId: 'android-mas',
      currentAuthorized: true,
      nextActiveId: 'android-mas',
      nextAuthorized: false,
    }),
    true
  );

  assert.equal(
    shouldResetOperationState({
      currentActiveId: 'android-mas',
      currentAuthorized: true,
      nextActiveId: 'other-mas',
      nextAuthorized: true,
    }),
    true
  );
});

test('createStoragePermissionSyncer: prefers refreshInstanceState over syncInstances when provided', async () => {
  let refreshedState: MASInstancesState | null = null;
  let syncedState: MASInstancesState | null = null;

  const mockGetStorageAccess = async (): Promise<AndroidStorageAccessStatus> => ({
    state: 'granted',
    root: '/storage/emulated/0/MAS',
    game_path: '/storage/emulated/0/MAS/game',
  });

  const mockListInstances = async (): Promise<MASInstancesState> => ({
    instances: [
      {
        id: 'android-mas',
        label: 'MAS (Android)',
        root: '/storage/emulated/0/MAS',
        status: { valid: true, game_exists: true, submods: 3 },
      },
    ],
    active_id: 'android-mas',
  });

  const syncer = createStoragePermissionSyncer({
    isAndroid: true,
    getStorageAccess: mockGetStorageAccess,
    listInstances: mockListInstances,
    refreshInstanceState: (state) => {
      refreshedState = state;
    },
    syncInstances: (state) => {
      syncedState = state;
    },
    setStorageState: () => {},
    setIsStorageRefreshing: () => {},
  });

  await syncer();

  assert.ok(refreshedState !== null);
  assert.equal(syncedState, null);
  assert.equal((refreshedState as MASInstancesState).active_id, 'android-mas');
});

test('operation lifecycle simulation: focus/storage refresh preserves polling, preview, and installed items while permission is valid', async () => {
  // Simulate App component's operation states
  let isPollingActive = true;
  let currentPlan: { id: string } | null = { id: 'plan-123' };
  let adoptTarget: { id: string } | null = { id: 'adopt-456' };
  let installedMods: string[] = ['mod-a', 'mod-b'];
  let scanCount = 0;

  let activeId = 'android-mas';
  let isAuthorized = true;

  const handleSync = (
    state: MASInstancesState,
    options?: { reason?: 'switch' | 'permission_refresh' | 'refresh'; forceReset?: boolean }
  ) => {
    const nextActiveId = state.active_id || 'unverified';
    const activeItem = state.instances.find((i) => i.id === nextActiveId);
    const nextAuth = isInstanceAuthorized(activeItem);

    const rec = reconcileInstanceState({
      currentActiveId: activeId,
      currentAuthorized: isAuthorized,
      nextActiveId,
      nextAuthorized: nextAuth,
      reason: options?.reason,
      forceReset: options?.forceReset,
    });

    activeId = nextActiveId;
    isAuthorized = nextAuth;

    if (rec.shouldResetOperations) {
      isPollingActive = false;
      currentPlan = null;
      adoptTarget = null;
      installedMods = [];
    }

    if (rec.shouldTriggerScan) {
      scanCount++;
    }
  };

  const validInstancesState: MASInstancesState = {
    instances: [
      {
        id: 'android-mas',
        label: 'MAS (Android)',
        root: '/storage/emulated/0/MAS',
        status: { valid: true, game_exists: true, submods: 2 },
      },
    ],
    active_id: 'android-mas',
  };

  // 1. Android window refocuses: permission checked, everything unchanged
  handleSync(validInstancesState, { reason: 'permission_refresh' });
  assert.equal(isPollingActive, true, 'Polling must remain active when permission is unchanged');
  assert.deepEqual(currentPlan, { id: 'plan-123' }, 'Plan preview must not be cleared on focus');
  assert.deepEqual(adoptTarget, { id: 'adopt-456' }, 'Adopt modal target must not be cleared on focus');
  assert.deepEqual(installedMods, ['mod-a', 'mod-b'], 'Installed items must not be wiped on focus');
  assert.equal(scanCount, 0, 'Should not redundantly rescan when permission and instance are unchanged');

  // 2. Permission revoked in background
  const revokedInstancesState: MASInstancesState = {
    instances: [
      {
        id: 'android-mas',
        label: 'MAS (Android)',
        root: '/storage/emulated/0/MAS',
        status: { valid: false, game_exists: false, submods: 0 },
      },
    ],
    active_id: 'android-mas',
  };
  handleSync(revokedInstancesState, { reason: 'permission_refresh' });
  assert.equal(isPollingActive, false, 'Polling should stop when permission is revoked');
  assert.equal(currentPlan, null, 'Plan preview should close when permission is revoked');
  assert.equal(adoptTarget, null, 'Adopt target should close when permission is revoked');
  assert.deepEqual(installedMods, [], 'Installed items should be cleared when permission is revoked');

  // 3. Permission re-granted: scan triggered without clearing non-existent state
  handleSync(validInstancesState, { reason: 'permission_refresh' });
  assert.equal(scanCount, 1, 'Scans should be triggered when permission is newly granted');

  // 4. Switching to another instance: resets operations and triggers scan for new instance
  currentPlan = { id: 'plan-new' };
  isPollingActive = true;
  const switchedInstancesState: MASInstancesState = {
    instances: [
      {
        id: 'android-mas',
        label: 'MAS (Android)',
        root: '/storage/emulated/0/MAS',
        status: { valid: true, game_exists: true, submods: 2 },
      },
      {
        id: 'custom-mas',
        label: 'MAS 2',
        root: '/storage/emulated/0/MAS2',
        status: { valid: true, game_exists: true, submods: 1 },
      },
    ],
    active_id: 'custom-mas',
  };
  handleSync(switchedInstancesState, { reason: 'switch' });
  assert.equal(activeId, 'custom-mas');
  assert.equal(isPollingActive, false, 'Polling must stop when switching instance');
  assert.equal(currentPlan, null, 'Plan preview must close when switching instance');
  assert.equal(scanCount, 2, 'Scan must run for newly activated instance');
});


