/**
 * Determines whether a navigation tab is supported and enabled in the desktop client.
 */
export function isAllowedNavTab(tab: string): boolean {
  return tab === 'catalog' || tab === 'instances' || tab === 'installed' || tab === 'priority' || tab === 'operations';
}

export interface PriorityValidationResult {
  valid: boolean;
  value?: number;
  error?: string;
}

export interface PriorityDisplayEntry {
  priority: number;
  order: number;
  mod_id: string;
  installation_id: string;
}

export function compareGoStringsDescending(first: string, second: string): number {
  const encoder = new TextEncoder();
  const firstBytes = encoder.encode(first);
  const secondBytes = encoder.encode(second);
  for (let index = 0; index < Math.min(firstBytes.length, secondBytes.length); index++) {
    if (firstBytes[index] !== secondBytes[index]) return secondBytes[index] - firstBytes[index];
  }
  return secondBytes.length - firstBytes.length;
}

export function comparePriorityDisplay(first: PriorityDisplayEntry, second: PriorityDisplayEntry): number {
  return (
    second.priority - first.priority ||
    second.order - first.order ||
    compareGoStringsDescending(first.mod_id, second.mod_id) ||
    compareGoStringsDescending(first.installation_id, second.installation_id)
  );
}

/**
 * Validates a priority string or number strictly as an integer.
 * Rejects floats (e.g. "1.5"), trailing characters (e.g. "1abc"), NaN, and empty strings.
 */
export function validatePriorityInput(input: string | number): PriorityValidationResult {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || !Number.isInteger(input)) {
      return { valid: false, error: '优先级必须为合法整数' };
    }
    return { valid: true, value: input };
  }

  const trimmed = String(input).trim();
  if (trimmed === '') {
    return { valid: false, error: '优先级不能为空' };
  }

  // Strict regex match for optional sign followed by digits only
  if (!/^-?\d+$/.test(trimmed)) {
    return { valid: false, error: '优先级必须为纯整数格式，不能包含小数或非数字字符' };
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    return { valid: false, error: '数值超出合法整数范围' };
  }

  return { valid: true, value: parsed };
}

export interface PriorityDraftDiff {
  hasChanges: boolean;
  changedMods: Array<{
    mod_id: string;
    previous: number;
    current: number;
  }>;
  draftMap: Record<string, number>;
}

/**
 * Computes difference between authoritative baseline priorities and current draft priorities.
 * Returns hasChanges = false if every draft value matches its baseline.
 */
export function computePriorityDraftDiff(
  baseline: Record<string, number>,
  draft: Record<string, number>
): PriorityDraftDiff {
  const changedMods: PriorityDraftDiff['changedMods'] = [];
  const draftMap: Record<string, number> = { ...baseline, ...draft };

  for (const modId of Object.keys(draftMap)) {
    const baseVal = baseline[modId] ?? 0;
    const draftVal = draftMap[modId] ?? baseVal;
    if (draftVal !== baseVal) {
      changedMods.push({
        mod_id: modId,
        previous: baseVal,
        current: draftVal,
      });
    }
  }

  return {
    hasChanges: changedMods.length > 0,
    changedMods,
    draftMap,
  };
}

export interface PriorityRequestTracker {
  setInstance: (instanceId: string) => void;
  createRequest: () => { instanceId: string; sequence: number };
  isResponseValid: (token: { instanceId: string; sequence: number }) => boolean;
  invalidate: () => void;
  getCurrentInstance: () => string;
}

/**
 * Request sequence and active instance tracker to ignore stale async responses
 * and isolate state between MAS instances.
 */
export function createPriorityRequestTracker(initialInstanceId = ''): PriorityRequestTracker {
  let activeInstanceId = initialInstanceId;
  let currentSequence = 0;

  return {
    setInstance(instanceId: string) {
      activeInstanceId = instanceId;
      currentSequence++;
    },
    createRequest() {
      currentSequence++;
      return {
        instanceId: activeInstanceId,
        sequence: currentSequence,
      };
    },
    isResponseValid(token: { instanceId: string; sequence: number }) {
      return (
        token.instanceId === activeInstanceId &&
        token.sequence === currentSequence
      );
    },
    invalidate() {
      currentSequence++;
    },
    getCurrentInstance() {
      return activeInstanceId;
    },
  };
}

export interface FormattedPriorityDiff {
  path: string;
  action: string;
  previousWinner: string;
  nextWinner: string;
  isSameHashTransfer: boolean;
  reason: string;
}

/**
 * Formats plan changes for readable UI presentation, distinguishing identical content
 * owner changes from content-replacing writes.
 */
export function formatPriorityPlanActions(
  actions: Array<{
    path: string;
    action: string;
    current_source: string;
    target_source: string;
    current_hash: string;
    target_hash: string;
    reason?: string;
  }>,
  titleMap?: Record<string, string>
): FormattedPriorityDiff[] {
  return actions.map((act) => {
    const isSameHash =
      act.current_hash !== '' &&
      act.target_hash !== '' &&
      act.current_hash.toLowerCase() === act.target_hash.toLowerCase();

    let displayReason = act.reason || '优先级生效模组切换';
    if (isSameHash) {
      displayReason = '归属模组切换（文件内容完全一致，无需重新写盘）';
    }

    const prevRaw = act.current_source || '无';
    const nextRaw = act.target_source || '无';

    const previousWinner = (titleMap && titleMap[prevRaw]) ? titleMap[prevRaw] : prevRaw;
    const nextWinner = (titleMap && titleMap[nextRaw]) ? titleMap[nextRaw] : nextRaw;

    return {
      path: act.path,
      action: act.action,
      previousWinner,
      nextWinner,
      isSameHashTransfer: isSameHash,
      reason: displayReason,
    };
  });
}

/**
 * Compares two draft maps strictly by keys and integer values.
 */
export function areDraftPrioritiesEqual(
  a: Record<string, number> | null | undefined,
  b: Record<string, number> | null | undefined
): boolean {
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

export interface PriorityApplyCheckParams {
  previewPlan: {
    plan_id?: string;
    generation?: number;
    blockers?: string[];
  } | null;
  previewDraftMap: Record<string, number> | null;
  previewInstanceId?: string | null;
  previewGeneration?: number | null;
  currentDraftMap: Record<string, number>;
  currentInstanceId?: string;
  currentGeneration?: number | null;
  hasChanges: boolean;
  hasInputErrors: boolean;
  previewLoading: boolean;
  isApplying: boolean;
}

export interface PriorityApplyCheckResult {
  canApply: boolean;
  reason?: string;
}

/**
 * Validates whether the priority plan can be applied to the filesystem.
 * Enforces preview-first safety: plan must exist, match current draft, have no blockers,
 * and MAS instance & generation must remain unchanged.
 */
export function canApplyPriorityPlan(params: PriorityApplyCheckParams): PriorityApplyCheckResult {
  if (params.isApplying) {
    return { canApply: false, reason: '正在应用写盘中' };
  }
  if (params.previewLoading) {
    return { canApply: false, reason: '正在计算变更预览' };
  }
  if (params.hasInputErrors) {
    return { canApply: false, reason: '存在格式错误的优先级输入' };
  }
  if (!params.hasChanges) {
    return { canApply: false, reason: '当前无优先级变动' };
  }
  if (!params.previewPlan) {
    return { canApply: false, reason: '请先计算并确认变更预览' };
  }
  if (
    params.previewInstanceId &&
    params.currentInstanceId &&
    params.previewInstanceId !== params.currentInstanceId
  ) {
    return { canApply: false, reason: 'MAS 实例已切换，请重新计算预览' };
  }
  if (
    params.previewGeneration != null &&
    params.currentGeneration != null &&
    params.previewGeneration !== params.currentGeneration
  ) {
    return { canApply: false, reason: 'MAS 状态版本已变更，请重新计算预览' };
  }
  if (
    params.previewPlan.generation != null &&
    params.currentGeneration != null &&
    params.previewPlan.generation !== params.currentGeneration
  ) {
    return { canApply: false, reason: 'MAS 状态版本已变更，请重新计算预览' };
  }
  if (!areDraftPrioritiesEqual(params.currentDraftMap, params.previewDraftMap)) {
    return { canApply: false, reason: '优先级草稿已变更，请重新计算预览' };
  }
  if (params.previewPlan.blockers && params.previewPlan.blockers.length > 0) {
    return { canApply: false, reason: `存在阻断项无法执行: ${params.previewPlan.blockers.join('; ')}` };
  }
  return { canApply: true };
}
