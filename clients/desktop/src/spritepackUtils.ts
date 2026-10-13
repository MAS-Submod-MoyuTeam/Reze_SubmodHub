export function normalizeSpriteSetIDs(ids?: string[] | null): string[] {
  if (!Array.isArray(ids)) return [];
  const clean = ids
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0);
  return Array.from(new Set(clean)).sort();
}

export function isSpriteSelectionValid(
  selectedSets: string[],
  manifestSets: Array<{ id: string }>,
  loading: boolean,
  error?: string | null,
): boolean {
  if (loading || Boolean(error)) return false;
  if (selectedSets.length === 0 || manifestSets.length === 0) return false;
  return selectedSets.every((id) => manifestSets.some((set) => set.id === id));
}

export interface SpriteInstallationSnapshot {
  instanceId: string;
  modId: string;
  versionId: string;
  operationId: string;
  setIds?: string[];
  selectionHash?: string;
}

export type SelectionBaselineMode =
  | 'first_install'
  | 'known_installed'
  | 'unknown_installed'
  | 'loading'
  | 'error';

export interface SelectionBaseline {
  mode: SelectionBaselineMode;
  initialIds: string[];
  installedIds: string[];
  unavailableInstalledIds: string[];
}

export interface SpriteSelectionDiff {
  mode: SelectionBaselineMode;
  draftIds: string[];
  installedIds: string[];
  keptIds: string[];
  addedIds: string[];
  removedIds: string[];
  unavailableInstalledIds: string[];
  isUnchanged: boolean;
  isAllDeselected: boolean;
  requiresUninstallConfirmation: boolean;
  summaryText: string;
}

/**
 * Pure function to derive baseline selection state from public manifest sets,
 * the current instance's installation snapshot, and installation loading status.
 */
export function deriveSpriteSelection(
  manifestSets: Array<{ id: string }>,
  snapshot?: SpriteInstallationSnapshot | null,
  loadingStatus: string = 'success'
): SelectionBaseline {
  const normStatus = (loadingStatus || '').toLowerCase();
  if (normStatus === 'loading' || normStatus === 'idle') {
    return {
      mode: 'loading',
      initialIds: [],
      installedIds: [],
      unavailableInstalledIds: [],
    };
  }
  if (normStatus === 'error') {
    return {
      mode: 'error',
      initialIds: [],
      installedIds: [],
      unavailableInstalledIds: [],
    };
  }

  const manifestIds = normalizeSpriteSetIDs(manifestSets.map((s) => s?.id));

  // 1. 首次安装：当前实例成功加载且确实无此模组安装记录
  if (!snapshot || !snapshot.operationId || !snapshot.operationId.trim()) {
    return {
      mode: 'first_install',
      initialIds: manifestIds,
      installedIds: [],
      unavailableInstalledIds: [],
    };
  }

  // 2. 检查旧安装记录是否有可验证的选择
  const hasSets = Array.isArray(snapshot.setIds) && snapshot.setIds.length > 0;
  const hasHash = typeof snapshot.selectionHash === 'string' && snapshot.selectionHash.trim().length > 0;
  const installedNormalized = normalizeSpriteSetIDs(snapshot.setIds);

  if (!hasSets || !hasHash || installedNormalized.length === 0) {
    // 3. unknown_installed: 初始不勾选，不默认全选
    return {
      mode: 'unknown_installed',
      initialIds: [],
      installedIds: [],
      unavailableInstalledIds: [],
    };
  }

  // 4. known_installed: initialIds 为已安装与当前公开集合交集；缺失 ID 归入 unavailableInstalledIds
  const manifestSet = new Set(manifestIds);
  const initialIds = installedNormalized.filter((id) => manifestSet.has(id));
  const unavailableInstalledIds = installedNormalized.filter((id) => !manifestSet.has(id));

  return {
    mode: 'known_installed',
    initialIds,
    installedIds: installedNormalized,
    unavailableInstalledIds,
  };
}

/**
 * Pure function to calculate diffs between selection baseline and current draft.
 */
export function calculateSpriteSelectionDiff(
  baseline: SelectionBaseline,
  draftIds: string[]
): SpriteSelectionDiff {
  const normalizedDraft = normalizeSpriteSetIDs(draftIds);

  if (baseline.mode === 'first_install') {
    return {
      mode: baseline.mode,
      draftIds: normalizedDraft,
      installedIds: [],
      keptIds: [],
      addedIds: normalizedDraft,
      removedIds: [],
      unavailableInstalledIds: [],
      isUnchanged: false,
      isAllDeselected: normalizedDraft.length === 0,
      requiresUninstallConfirmation: false,
      summaryText: `已选 ${normalizedDraft.length} 个外观套装`,
    };
  }

  if (baseline.mode === 'known_installed') {
    const installedSet = new Set(baseline.installedIds);
    const draftSet = new Set(normalizedDraft);

    const keptIds = baseline.installedIds.filter((id) => draftSet.has(id));
    const addedIds = normalizedDraft.filter((id) => !installedSet.has(id));
    const removedFromPublic = baseline.installedIds.filter((id) => !draftSet.has(id));
    const removedIds = normalizeSpriteSetIDs([
      ...removedFromPublic,
      ...baseline.unavailableInstalledIds,
    ]);

    const isUnchanged =
      addedIds.length === 0 &&
      removedIds.length === 0 &&
      normalizedDraft.length === baseline.installedIds.length;
    const isAllDeselected = normalizedDraft.length === 0;
    const requiresUninstallConfirmation = removedIds.length > 0;

    return {
      mode: baseline.mode,
      draftIds: normalizedDraft,
      installedIds: baseline.installedIds,
      keptIds,
      addedIds,
      removedIds,
      unavailableInstalledIds: baseline.unavailableInstalledIds,
      isUnchanged,
      isAllDeselected,
      requiresUninstallConfirmation,
      summaryText: `保留 ${keptIds.length} 个 / 新增 ${addedIds.length} 个 / 卸载 ${removedIds.length} 个`,
    };
  }

  if (baseline.mode === 'unknown_installed') {
    return {
      mode: baseline.mode,
      draftIds: normalizedDraft,
      installedIds: [],
      keptIds: [],
      addedIds: normalizedDraft,
      removedIds: [],
      unavailableInstalledIds: [],
      isUnchanged: false,
      isAllDeselected: normalizedDraft.length === 0,
      requiresUninstallConfirmation: true,
      summaryText: `已选 ${normalizedDraft.length} 个套装（将替换旧安装内容）`,
    };
  }

  return {
    mode: baseline.mode,
    draftIds: normalizedDraft,
    installedIds: [],
    keptIds: [],
    addedIds: [],
    removedIds: [],
    unavailableInstalledIds: [],
    isUnchanged: false,
    isAllDeselected: true,
    requiresUninstallConfirmation: false,
    summaryText: '状态加载中或异常',
  };
}
