import { Events } from '@wailsio/runtime';
import type { AndroidStorageAccessStatus, MASInstancesState } from './wails';

export type InstanceSyncReason = 'switch' | 'permission_refresh' | 'refresh' | 'init';

export interface InstanceReconciliationParams {
  currentActiveId: string;
  currentAuthorized: boolean;
  nextActiveId: string;
  nextAuthorized: boolean;
  reason?: InstanceSyncReason;
  forceReset?: boolean;
}

export interface InstanceReconciliationResult {
  instanceChanged: boolean;
  permissionRevoked: boolean;
  permissionGranted: boolean;
  shouldResetOperations: boolean;
  shouldTriggerScan: boolean;
}

export function reconcileInstanceState(params: InstanceReconciliationParams): InstanceReconciliationResult {
  const instanceChanged = params.nextActiveId !== params.currentActiveId;
  const permissionRevoked = !instanceChanged && params.currentAuthorized && !params.nextAuthorized;
  const permissionGranted = !instanceChanged && !params.currentAuthorized && params.nextAuthorized;

  let shouldResetOperations = false;
  if (params.forceReset) {
    shouldResetOperations = true;
  } else if (instanceChanged) {
    shouldResetOperations = true;
  } else if (permissionRevoked) {
    shouldResetOperations = true;
  }

  let shouldTriggerScan = false;
  if (params.nextAuthorized) {
    if (instanceChanged || permissionGranted) {
      shouldTriggerScan = true;
    }
  }

  return {
    instanceChanged,
    permissionRevoked,
    permissionGranted,
    shouldResetOperations,
    shouldTriggerScan,
  };
}

export function shouldResetOperationState(params: {
  currentActiveId: string;
  currentAuthorized: boolean;
  nextActiveId: string;
  nextAuthorized: boolean;
  forceReset?: boolean;
}): boolean {
  return reconcileInstanceState(params).shouldResetOperations;
}

export interface StoragePermissionSyncerDependencies {
  isAndroid: boolean;
  getStorageAccess: () => Promise<AndroidStorageAccessStatus>;
  listInstances: () => Promise<MASInstancesState>;
  syncInstances?: (state: MASInstancesState, options?: { reason?: InstanceSyncReason; forceReset?: boolean }) => void;
  refreshInstanceState?: (state: MASInstancesState) => void;
  setStorageState: (state: string) => void;
  setIsStorageRefreshing: (refreshing: boolean) => void;
}

export function createStoragePermissionSyncer(deps: StoragePermissionSyncerDependencies) {
  return async function checkStoragePermission() {
    if (!deps.isAndroid) return;
    deps.setIsStorageRefreshing(true);
    const sync = (state: MASInstancesState) => {
      if (deps.refreshInstanceState) {
        deps.refreshInstanceState(state);
      } else if (deps.syncInstances) {
        deps.syncInstances(state, { reason: 'permission_refresh' });
      }
    };
    try {
      const res = await deps.getStorageAccess();
      deps.setStorageState(res.state);
      const state = await deps.listInstances();
      sync(state);
    } catch {
      deps.setStorageState('error');
      try {
        const state = await deps.listInstances();
        sync(state);
      } catch {
        // ignore
      }
    } finally {
      deps.setIsStorageRefreshing(false);
    }
  };
}

export function isInstanceAuthorized(instance?: { status?: { valid: boolean; game_exists: boolean } } | null): boolean {
  return Boolean(instance?.status?.valid && instance?.status?.game_exists);
}

export function subscribeStorageStateChanged(
  onChanged: () => void,
  options?: {
    eventsOn?: (eventName: string, callback: (event?: unknown) => void) => () => void;
    windowTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  }
): () => void {
  const eventsOn = options?.eventsOn ?? Events.On;
  const windowTarget = options?.windowTarget ?? (typeof window !== 'undefined' ? window : undefined);

  let unsubWails: (() => void) | undefined;
  try {
    unsubWails = eventsOn('submodhub:storage_state_changed', () => onChanged());
  } catch (err) {
    console.warn('Failed to subscribe to Wails storage_state_changed event:', err);
  }

  const domListener = () => { onChanged(); };
  if (windowTarget) {
    windowTarget.addEventListener('submodhub:storage_state_changed', domListener);
  }

  return () => {
    if (unsubWails) {
      unsubWails();
    }
    if (windowTarget) {
      windowTarget.removeEventListener('submodhub:storage_state_changed', domListener);
    }
  };
}
