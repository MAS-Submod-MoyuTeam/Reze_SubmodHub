export type LoadingStatus = 'idle' | 'loading' | 'success' | 'error';

export interface ScanToken {
  type: 'mods' | 'spritepacks';
  instanceId: string;
  sequence: number;
}

export interface ScanOptions {
  forced?: boolean;
}

interface QueuedScanRequest {
  instanceId: string;
  resolve: (token: ScanToken | null) => void;
}

interface TargetState {
  status: LoadingStatus;
  activeInstanceId: string | null;
  loadedInstanceId: string | null;
  currentSequence: number;
  inFlightSequence: number | null;
  error: string | null;
  hasQueuedForced: boolean;
  queuedRequests: QueuedScanRequest[];
}

export function createInstalledLoadCoordinator(initialInstanceId?: string | null) {
  const initId = initialInstanceId && initialInstanceId !== 'unverified' ? initialInstanceId : null;
  const modsState: TargetState = {
    status: 'idle',
    activeInstanceId: initId,
    loadedInstanceId: null,
    currentSequence: 0,
    inFlightSequence: null,
    error: null,
    hasQueuedForced: false,
    queuedRequests: [],
  };

  const spritepacksState: TargetState = {
    status: 'idle',
    activeInstanceId: initId,
    loadedInstanceId: null,
    currentSequence: 0,
    inFlightSequence: null,
    error: null,
    hasQueuedForced: false,
    queuedRequests: [],
  };

  function drainQueuedScan(type: 'mods' | 'spritepacks') {
    const state = type === 'mods' ? modsState : spritepacksState;
    if (state.queuedRequests.length === 0) {
      state.hasQueuedForced = false;
      return;
    }

    const nextReq = state.queuedRequests.shift();
    if (!nextReq) return;

    if (!state.activeInstanceId || state.activeInstanceId === 'unverified' || nextReq.instanceId !== state.activeInstanceId) {
      nextReq.resolve(null);
      drainQueuedScan(type);
      return;
    }

    state.currentSequence += 1;
    const seq = state.currentSequence;
    state.inFlightSequence = seq;
    state.status = 'loading';
    state.error = null;
    state.hasQueuedForced = state.queuedRequests.length > 0;

    nextReq.resolve({
      type,
      instanceId: state.activeInstanceId,
      sequence: seq,
    });
  }

  function beginScan(
    type: 'mods' | 'spritepacks',
    instanceId: string,
    options?: ScanOptions
  ): ScanToken | null {
    if (!instanceId || instanceId === 'unverified') {
      return null;
    }

    const state = type === 'mods' ? modsState : spritepacksState;

    // Scan requests that do not belong to the current active instance are directly rejected
    // instead of implicitly switching the active instance.
    if (!state.activeInstanceId || state.activeInstanceId !== instanceId) {
      return null;
    }

    if (state.inFlightSequence !== null) {
      if (!options?.forced) {
        // Deduplicate ordinary concurrent scan for same target and same instance
        return null;
      }
      // If forced scan requested synchronously, bump sequence immediately and supersede in-flight
      state.currentSequence += 1;
      const seq = state.currentSequence;
      state.inFlightSequence = seq;
      state.status = 'loading';
      state.error = null;
      state.hasQueuedForced = false;
      return {
        type,
        instanceId,
        sequence: seq,
      };
    }

    state.currentSequence += 1;
    const seq = state.currentSequence;
    state.inFlightSequence = seq;
    state.status = 'loading';
    state.error = null;

    return {
      type,
      instanceId,
      sequence: seq,
    };
  }

  function waitForScan(
    type: 'mods' | 'spritepacks',
    instanceId: string,
    options?: ScanOptions
  ): Promise<ScanToken | null> {
    if (!instanceId || instanceId === 'unverified') {
      return Promise.resolve(null);
    }

    const state = type === 'mods' ? modsState : spritepacksState;

    // Scan requests that do not belong to the current active instance are directly rejected.
    if (!state.activeInstanceId || state.activeInstanceId !== instanceId) {
      return Promise.resolve(null);
    }

    if (state.inFlightSequence !== null) {
      if (!options?.forced) {
        // Deduplicate concurrent scan for same target and same instance
        return Promise.resolve(null);
      }
      // Data changed during in-flight scan: mark current in-flight scan as superseded
      // so its stale results will not commit, and queue this forced refresh
      state.hasQueuedForced = true;
      return new Promise<ScanToken | null>((resolve) => {
        state.queuedRequests.push({ instanceId, resolve });
      });
    }

    return Promise.resolve(beginScan(type, instanceId, options));
  }

  function completeScan<T>(token: ScanToken, _result: T): boolean {
    const state = token.type === 'mods' ? modsState : spritepacksState;
    if (
      token.instanceId !== state.activeInstanceId ||
      token.sequence !== state.currentSequence
    ) {
      return false;
    }

    if (state.hasQueuedForced) {
      // In-flight scan was started before a data mutation that requested a forced refresh.
      // Reject stale pre-mutation result and drain the queued scan.
      state.inFlightSequence = null;
      drainQueuedScan(token.type);
      return false;
    }

    state.inFlightSequence = null;
    state.loadedInstanceId = token.instanceId;
    state.status = 'success';
    state.error = null;
    drainQueuedScan(token.type);
    return true;
  }

  function failScan(token: ScanToken, errorMessage: string): boolean {
    const state = token.type === 'mods' ? modsState : spritepacksState;
    if (
      token.instanceId !== state.activeInstanceId ||
      token.sequence !== state.currentSequence
    ) {
      return false;
    }

    if (state.hasQueuedForced) {
      // Obsolete scan failed, but queued fresh scan will take over
      state.inFlightSequence = null;
      drainQueuedScan(token.type);
      return false;
    }

    state.inFlightSequence = null;
    state.status = 'error';
    state.error = errorMessage;
    drainQueuedScan(token.type);
    return true;
  }

  function resetForInstance(instanceId: string | null | undefined) {
    const valid = !!instanceId && instanceId !== 'unverified';

    modsState.currentSequence += 1;
    modsState.inFlightSequence = null;
    modsState.error = null;
    modsState.activeInstanceId = valid ? (instanceId as string) : null;
    modsState.loadedInstanceId = null;
    modsState.status = 'idle';
    modsState.hasQueuedForced = false;
    const queuedMods = modsState.queuedRequests;
    modsState.queuedRequests = [];
    for (const req of queuedMods) {
      req.resolve(null);
    }

    spritepacksState.currentSequence += 1;
    spritepacksState.inFlightSequence = null;
    spritepacksState.error = null;
    spritepacksState.activeInstanceId = valid ? (instanceId as string) : null;
    spritepacksState.loadedInstanceId = null;
    spritepacksState.status = 'idle';
    spritepacksState.hasQueuedForced = false;
    const queuedSprites = spritepacksState.queuedRequests;
    spritepacksState.queuedRequests = [];
    for (const req of queuedSprites) {
      req.resolve(null);
    }
  }

  return {
    beginModsScan: (instanceId: string, options?: ScanOptions) => beginScan('mods', instanceId, options),
    waitForModsScan: (instanceId: string, options?: ScanOptions) => waitForScan('mods', instanceId, options),
    completeModsScan: <T>(token: ScanToken, result: T) => completeScan(token, result),
    failModsScan: (token: ScanToken, error: string) => failScan(token, error),

    beginSpritepacksScan: (instanceId: string, options?: ScanOptions) => beginScan('spritepacks', instanceId, options),
    waitForSpritepacksScan: (instanceId: string, options?: ScanOptions) => waitForScan('spritepacks', instanceId, options),
    completeSpritepacksScan: <T>(token: ScanToken, result: T) => completeScan(token, result),
    failSpritepacksScan: (token: ScanToken, error: string) => failScan(token, error),

    hasQueuedModsScan: () => modsState.hasQueuedForced || modsState.queuedRequests.length > 0,
    hasQueuedSpritepacksScan: () => spritepacksState.hasQueuedForced || spritepacksState.queuedRequests.length > 0,

    resetForInstance,
    setActiveInstance: (instanceId: string | null | undefined) => resetForInstance(instanceId),
    getActiveInstanceId: () => modsState.activeInstanceId,

    getModsStatus: () => modsState.status,
    getModsError: () => modsState.error,
    isModsInitialLoading: () =>
      modsState.status === 'loading' && modsState.loadedInstanceId !== modsState.activeInstanceId,
    isModsRefreshing: () =>
      modsState.status === 'loading' && modsState.loadedInstanceId === modsState.activeInstanceId,

    getSpritepacksStatus: () => spritepacksState.status,
    getSpritepacksError: () => spritepacksState.error,
    isSpritepacksInitialLoading: () =>
      spritepacksState.status === 'loading' &&
      spritepacksState.loadedInstanceId !== spritepacksState.activeInstanceId,
    isSpritepacksRefreshing: () =>
      spritepacksState.status === 'loading' &&
      spritepacksState.loadedInstanceId === spritepacksState.activeInstanceId,
  };
}

export type InstalledLoadCoordinator = ReturnType<typeof createInstalledLoadCoordinator>;

export function isActionBlocked(
  status: LoadingStatus,
  hasValidInstance: boolean,
  isInitialLoading = false,
  isRefreshing = false
): boolean {
  return (
    !hasValidInstance ||
    isInitialLoading ||
    isRefreshing ||
    status === 'loading' ||
    status === 'error'
  );
}

