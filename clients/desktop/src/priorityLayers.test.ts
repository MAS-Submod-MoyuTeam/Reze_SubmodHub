import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePriorityInput,
  computePriorityDraftDiff,
  createPriorityRequestTracker,
  formatPriorityPlanActions,
  areDraftPrioritiesEqual,
  canApplyPriorityPlan,
} from './priorityLayers.js';

test('validatePriorityInput rejects non-integers, floats, and dirty strings', () => {
  const invalidCases = ['1.5', '1abc', '', '   ', 'NaN', '1e5', 'foo', 1.25, NaN, Infinity];
  for (const input of invalidCases) {
    const res = validatePriorityInput(input);
    assert.equal(res.valid, false, 'expected input to be invalid: ' + input);
    assert.ok(res.error, 'expected error message for: ' + input);
  }
});

test('validatePriorityInput accepts valid integers in range', () => {
  const validCases: Array<[string | number, number]> = [
    [0, 0],
    ['0', 0],
    [50, 50],
    ['50', 50],
    ['-10', -10],
    [-10, -10],
    ['100', 100],
    ['1000', 1000],
  ];
  for (const [input, expected] of validCases) {
    const res = validatePriorityInput(input);
    assert.equal(res.valid, true, 'expected input to be valid: ' + input);
    assert.equal(res.value, expected);
  }
});

test('computePriorityDraftDiff calculates dirty state and detects reverting to baseline', () => {
  const baseline: Record<string, number> = { mod_a: 10, mod_b: 20 };

  // 1. Initial state (no changes)
  let diff = computePriorityDraftDiff(baseline, {});
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.changedMods.length, 0);

  // 2. Draft changed mod_a to 30
  diff = computePriorityDraftDiff(baseline, { mod_a: 30 });
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.changedMods.length, 1);
  assert.deepEqual(diff.changedMods[0], { mod_id: 'mod_a', previous: 10, current: 30 });

  // 3. Draft changed mod_a back to 10 (reverted to baseline)
  diff = computePriorityDraftDiff(baseline, { mod_a: 10 });
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.changedMods.length, 0);
});

test('createPriorityRequestTracker isolates instances and ignores stale responses', () => {
  const tracker = createPriorityRequestTracker('inst_1');

  const req1 = tracker.createRequest();
  assert.equal(tracker.isResponseValid(req1), true);

  // req2 is fired
  const req2 = tracker.createRequest();
  assert.equal(tracker.isResponseValid(req1), false, 'stale req1 must be invalid');
  assert.equal(tracker.isResponseValid(req2), true, 'latest req2 must be valid');

  // Switch instance
  tracker.setInstance('inst_2');
  assert.equal(tracker.isResponseValid(req2), false, 'response from inst_1 must be invalid after switching to inst_2');

  const req3 = tracker.createRequest();
  assert.equal(tracker.isResponseValid(req3), true);
});

test('cross-instance delayed response cannot overwrite new instance overview and baseline', async () => {
  // Stable tracker as used in PriorityLayersView
  const tracker = createPriorityRequestTracker('inst_A');

  interface TestOverview {
    instance: string;
    mods: Array<{ mod_id: string; priority: number }>;
  }

  class TestState {
    overview: TestOverview | null = null;
    baseline: Record<string, number> = {};
    draft: Record<string, number> = {};

    getOverview(): TestOverview | null {
      return this.overview;
    }
  }

  const state = new TestState();

  const loadOverviewForInstance = async (
    instanceId: string,
    delayMs: number,
    data: TestOverview
  ): Promise<boolean> => {
    const token = tracker.createRequest();
    await new Promise((r) => setTimeout(r, delayMs));

    if (!tracker.isResponseValid(token)) {
      return false; // Stale response discarded!
    }

    state.overview = data;
    const map: Record<string, number> = {};
    data.mods.forEach((m) => {
      map[m.mod_id] = m.priority;
    });
    state.baseline = map;
    state.draft = { ...map };
    return true;
  };

  // 1. inst_A starts a slow overview request (50ms)
  const promiseA = loadOverviewForInstance('inst_A', 50, {
    instance: 'inst_A',
    mods: [{ mod_id: 'mod_old', priority: 10 }],
  });

  // 2. User quickly switches instance to inst_B (10ms later)
  await new Promise((r) => setTimeout(r, 10));
  tracker.setInstance('inst_B');
  // Component clears old overview, baseline, and draft on instance switch
  state.overview = null;
  state.baseline = {};
  state.draft = {};

  // 3. inst_B starts a fast overview request (15ms)
  const promiseB = loadOverviewForInstance('inst_B', 15, {
    instance: 'inst_B',
    mods: [{ mod_id: 'mod_new', priority: 99 }],
  });

  const [resA, resB] = await Promise.all([promiseA, promiseB]);

  // Request A should be rejected and not write anything
  assert.equal(resA, false, 'delayed response from inst_A must be discarded');
  // Request B should be accepted
  assert.equal(resB, true, 'response for active inst_B must be accepted');

  // Verify state belongs exclusively to inst_B
  assert.equal(state.getOverview()?.instance, 'inst_B');
  const expectedBaseline: Record<string, number> = { mod_new: 99 };
  const expectedDraft: Record<string, number> = { mod_new: 99 };
  assert.deepEqual(state.baseline, expectedBaseline);
  assert.deepEqual(state.draft, expectedDraft);
  assert.equal(state.baseline['mod_old'], undefined, 'old instance mod must not leak into baseline');
});

test('effect cleanup invalidation cancels in-flight requests on unmount or fast-switch', async () => {
  const tracker = createPriorityRequestTracker('inst_A');
  let stateUpdated = false;

  const inFlightPromise = (async () => {
    const token = tracker.createRequest();
    await new Promise((r) => setTimeout(r, 30));
    if (!tracker.isResponseValid(token)) {
      return;
    }
    stateUpdated = true;
  })();

  // Simulate component unmount / effect cleanup before response arrives
  tracker.invalidate();

  await inFlightPromise;
  assert.equal(stateUpdated, false, 'in-flight request must be aborted when effect cleans up');
});

test('in-flight preview response discarded if draft is modified or reverted before response returns', async () => {
  const tracker = createPriorityRequestTracker('inst_A');
  let previewPlan: { plan_id: string; priorities: Record<string, number> } | null = null;

  const simulatePreviewRequest = async (
    draftToPreview: Record<string, number>,
    delayMs: number
  ): Promise<boolean> => {
    const token = tracker.createRequest();
    await new Promise((r) => setTimeout(r, delayMs));

    if (!tracker.isResponseValid(token)) {
      return false; // Stale preview cancelled by draft change!
    }

    previewPlan = {
      plan_id: 'plan_preview',
      priorities: draftToPreview,
    };
    return true;
  };

  // 1. User starts preview for A=30 (takes 40ms)
  const previewPromise = simulatePreviewRequest({ mod_a: 30 }, 40);

  // 2. 10ms later, user changes draft input to A=40 -> invalidates tracker immediately
  await new Promise((r) => setTimeout(r, 10));
  tracker.invalidate();

  const previewAccepted = await previewPromise;
  assert.equal(previewAccepted, false, 'stale preview for A=30 must be dropped');
  assert.equal(previewPlan, null, 'preview plan must not be populated with stale A=30');
});

test('raw input preserves invalid input for display and blocks preview and apply', () => {
  const baseline: Record<string, number> = { mod_a: 10, mod_b: 20 };
  const draft: Record<string, number> = { ...baseline };
  const rawInputs: Record<string, string> = {};
  const inputErrors: Record<string, string> = {};
  let previewPlan: { plan_id: string } | null = { plan_id: 'preview_1' };

  // Helper simulating handleInputChange
  const handleInputChange = (modId: string, rawValue: string) => {
    rawInputs[modId] = rawValue;
    // Invalidate stale preview plan on any edit
    previewPlan = null;

    const res = validatePriorityInput(rawValue);
    if (!res.valid) {
      inputErrors[modId] = res.error || '非法输入';
      return;
    }
    delete inputErrors[modId];
    draft[modId] = res.value!;
  };

  // User types invalid float '1.5' into mod_a
  handleInputChange('mod_a', '1.5');

  // 1. Raw input is preserved for input element display
  assert.equal(rawInputs['mod_a'], '1.5');
  // 2. Draft numeric priority is NOT corrupted with NaN or unvalidated float
  assert.equal(draft['mod_a'], 10);
  // 3. Error is registered
  assert.ok(inputErrors['mod_a']);
  // 4. Preview plan is immediately invalidated
  assert.equal(previewPlan, null);

  // 5. Verification: hasInputErrors blocks apply and preview
  const hasInputErrors = Object.keys(inputErrors).length > 0;
  assert.equal(hasInputErrors, true);

  const canApply = !hasInputErrors && computePriorityDraftDiff(baseline, draft).hasChanges;
  assert.equal(canApply, false, 'apply must be blocked when input errors exist');

  // 6. User fixes the input to valid integer '35'
  handleInputChange('mod_a', '35');
  assert.equal(rawInputs['mod_a'], '35');
  assert.equal(draft['mod_a'], 35);
  assert.equal(inputErrors['mod_a'], undefined);

  const hasInputErrorsAfterFix = Object.keys(inputErrors).length > 0;
  const canApplyAfterFix = !hasInputErrorsAfterFix && computePriorityDraftDiff(baseline, draft).hasChanges;
  assert.equal(canApplyAfterFix, true, 'apply should be permitted once input error is resolved and changes exist');
});

test('formatPriorityPlanActions annotates same-hash transfers vs content replacements', () => {
  const actions = [
    {
      path: 'game/diff.rpy',
      action: 'OVERWRITE',
      current_source: 'mod_b',
      target_source: 'mod_a',
      current_hash: 'aaa111',
      target_hash: 'bbb222',
    },
    {
      path: 'game/same.png',
      action: 'METADATA_ONLY',
      current_source: 'mod_b',
      target_source: 'mod_a',
      current_hash: 'ccc333',
      target_hash: 'CCC333', // case-insensitive hash match
    },
  ];

  const formatted = formatPriorityPlanActions(actions);
  assert.equal(formatted.length, 2);

  assert.equal(formatted[0].isSameHashTransfer, false);
  assert.equal(formatted[0].previousWinner, 'mod_b');
  assert.equal(formatted[0].nextWinner, 'mod_a');

  assert.equal(formatted[1].isSameHashTransfer, true);
  assert.ok(formatted[1].reason.includes('归属模组切换'));
});

test('areDraftPrioritiesEqual checks key count and values', () => {
  assert.equal(areDraftPrioritiesEqual(null, {}), false);
  assert.equal(areDraftPrioritiesEqual({}, null), false);
  assert.equal(areDraftPrioritiesEqual({ a: 10 }, { a: 10 }), true);
  assert.equal(areDraftPrioritiesEqual({ a: 10, b: 20 }, { a: 10, b: 20 }), true);
  assert.equal(areDraftPrioritiesEqual({ a: 10 }, { a: 20 }), false);
  assert.equal(areDraftPrioritiesEqual({ a: 10 }, { a: 10, b: 20 }), false);
});

test('canApplyPriorityPlan enforces preview-first and blocks bypass', () => {
  const baseParams = {
    previewPlan: null,
    previewDraftMap: null,
    previewInstanceId: 'inst_1',
    previewGeneration: 1,
    currentDraftMap: { mod_a: 30, mod_b: 20 },
    currentInstanceId: 'inst_1',
    currentGeneration: 1,
    hasChanges: true,
    hasInputErrors: false,
    previewLoading: false,
    isApplying: false,
  };

  // 1. Without previewPlan: blocked with explicit message
  let res = canApplyPriorityPlan(baseParams);
  assert.equal(res.canApply, false);
  assert.equal(res.reason, '请先计算并确认变更预览');

  // 2. With valid previewPlan matching current draft
  const validPlan = { plan_id: 'plan_1', generation: 1, blockers: [] };
  const validParams = {
    ...baseParams,
    previewPlan: validPlan,
    previewDraftMap: { mod_a: 30, mod_b: 20 },
  };
  res = canApplyPriorityPlan(validParams);
  assert.equal(res.canApply, true);

  // 3. Draft modified after preview (e.g. mod_a changed to 40)
  res = canApplyPriorityPlan({
    ...validParams,
    currentDraftMap: { mod_a: 40, mod_b: 20 },
  });
  assert.equal(res.canApply, false);
  assert.ok(res.reason?.includes('草稿已变更'));

  // 4. Plan has blockers
  res = canApplyPriorityPlan({
    ...validParams,
    previewPlan: { ...validPlan, blockers: ['external_change_detected'] },
  });
  assert.equal(res.canApply, false);
  assert.ok(res.reason?.includes('存在阻断项'));

  // 5. Preview is currently loading
  res = canApplyPriorityPlan({
    ...validParams,
    previewLoading: true,
  });
  assert.equal(res.canApply, false);
  assert.ok(res.reason?.includes('正在计算'));

  // 6. Instance switched
  res = canApplyPriorityPlan({
    ...validParams,
    currentInstanceId: 'inst_2',
  });
  assert.equal(res.canApply, false);
  assert.ok(res.reason?.includes('实例已切换'));

  // 7. Generation changed (e.g. another mod was installed or uninstalled)
  res = canApplyPriorityPlan({
    ...validParams,
    currentGeneration: 2,
  });
  assert.equal(res.canApply, false);
  assert.ok(res.reason?.includes('状态版本已变更'));

  // 8. No changes
  res = canApplyPriorityPlan({
    ...validParams,
    hasChanges: false,
  });
  assert.equal(res.canApply, false);

  // 9. Input errors
  res = canApplyPriorityPlan({
    ...validParams,
    hasInputErrors: true,
  });
  assert.equal(res.canApply, false);
});

