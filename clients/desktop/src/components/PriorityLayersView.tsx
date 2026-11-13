import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Layers,
  ArrowUp,
  ArrowDown,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Search,
  RefreshCw,
  Loader2,
  Save,
  Eye,
  FileText,
  Sliders,
  ShieldCheck,
  Info,
} from 'lucide-react';
import { InstalledItem } from '../types/client';
import { darkSegmentClass } from './segmentStyles';
import { useI18n } from '../i18n';
import {
  GetPriorityOverview,
  PreviewPriority,
  ExecutePlan,
  PriorityOverview,
  PriorityPathEntry,
} from '../wails';
import {
  validatePriorityInput,
  computePriorityDraftDiff,
  createPriorityRequestTracker,
  formatPriorityPlanActions,
  canApplyPriorityPlan,
  FormattedPriorityDiff,
  comparePriorityDisplay,
} from '../priorityLayers';

export interface PriorityLayersViewProps {
  installedMods: InstalledItem[];
  currentInstanceId: string;
  onRefreshInstalled: (options?: { forced?: boolean }) => Promise<void>;
  showToast: (msg: string) => void;
}

export const PriorityLayersView: React.FC<PriorityLayersViewProps> = ({
  installedMods,
  currentInstanceId,
  onRefreshInstalled,
  showToast,
}) => {
  const { t } = useI18n();
  // Tracker for isolating MAS instances and discarding stale async responses
  const trackerRef = useRef(createPriorityRequestTracker(currentInstanceId));

  // Overview data from GetPriorityOverview
  const [overview, setOverview] = useState<PriorityOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  // Authoritative baseline priorities loaded from backend overview
  const [baselinePriorities, setBaselinePriorities] = useState<Record<string, number>>({});

  // Draft priorities (numeric) and user-typed raw strings for active inputs
  const [draftPriorities, setDraftPriorities] = useState<Record<string, number>>({});
  const [rawInputs, setRawInputs] = useState<Record<string, string>>({});
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});

  // Preview state from PreviewPriority
  const [previewPlan, setPreviewPlan] = useState<any | null>(null);
  const [previewDraftMap, setPreviewDraftMap] = useState<Record<string, number> | null>(null);
  const [previewInstanceId, setPreviewInstanceId] = useState<string | null>(null);
  const [previewGeneration, setPreviewGeneration] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Execution state for ExecutePlan
  const [isApplying, setIsApplying] = useState(false);

  // Right column active tab ('preview' vs 'conflicts') and path search
  const [rightTab, setRightTab] = useState<'preview' | 'conflicts'>('preview');
  const [pathSearchQuery, setPathSearchQuery] = useState('');

  // Update tracker instance on instance switch
  useEffect(() => {
    trackerRef.current.setInstance(currentInstanceId);
  }, [currentInstanceId]);

  // Load priority overview from backend
  const loadOverview = useCallback(
    async (instanceId: string) => {
      setLoadingOverview(true);
      setOverviewError(null);
      const token = trackerRef.current.createRequest();

      try {
        const data = await GetPriorityOverview();
        if (!trackerRef.current.isResponseValid(token)) {
          return;
        }

        if (data) {
          setOverview(data);
          const baseMap: Record<string, number> = {};
          (data.mods || []).forEach((m) => {
            baseMap[m.mod_id] = m.priority;
          });
          setBaselinePriorities(baseMap);
          setDraftPriorities({ ...baseMap });
        } else {
          setOverview(null);
          setBaselinePriorities({});
          setDraftPriorities({});
        }

        // Clear draft edits, input errors, and any stale preview
        setRawInputs({});
        setInputErrors({});
        setPreviewPlan(null);
        setPreviewDraftMap(null);
        setPreviewInstanceId(null);
        setPreviewGeneration(null);
        setPreviewError(null);
      } catch (err: any) {
        if (!trackerRef.current.isResponseValid(token)) return;
        const msg = err?.message || String(err) || t('priorityView.loadFailed');
        setOverviewError(msg);
      } finally {
        if (trackerRef.current.isResponseValid(token)) {
          setLoadingOverview(false);
        }
      }
    },
    []
  );

  // Initial load and reload when currentInstanceId changes
  useEffect(() => {
    loadOverview(currentInstanceId);
    return () => {
      trackerRef.current.invalidate();
    };
  }, [currentInstanceId, loadOverview]);

  // Managed mods lookup from installedMods
  const installedManagedMap = useMemo(() => {
    const map = new Map<string, InstalledItem>();
    for (const m of installedMods) {
      if (m.is_managed) {
        map.set(m.mod_id, m);
      }
    }
    return map;
  }, [installedMods]);

  // Combine overview.mods with installedMods metadata
  const managedModList = useMemo(() => {
    if (!overview || !overview.mods) return [];

    return overview.mods.map((modInfo) => {
      const installed = installedManagedMap.get(modInfo.mod_id);
      return {
        ...modInfo,
        title: modInfo.title || installed?.title || modInfo.mod_id,
        version: modInfo.version || installed?.installed_version || '1.0.0',
        author: installed?.author_name || t('priorityView.unknownAuthor'),
        category: installed?.category || 'submod',
      };
    });
  }, [overview, installedManagedMap]);

  // Compute draft diff vs baseline
  const draftDiff = useMemo(() => {
    return computePriorityDraftDiff(baselinePriorities, draftPriorities);
  }, [baselinePriorities, draftPriorities]);

  const hasInputErrors = Object.keys(inputErrors).length > 0;
  const hasChanges = draftDiff.hasChanges;

  // Sorted mods: sorted by current draft priority descending, then order
  const sortedMods = useMemo(() => {
    return [...managedModList].sort((a, b) => {
      const prioA = draftPriorities[a.mod_id] ?? a.priority;
      const prioB = draftPriorities[b.mod_id] ?? b.priority;
      return comparePriorityDisplay(
        { ...a, priority: prioA },
        { ...b, priority: prioB }
      );
    });
  }, [managedModList, draftPriorities]);

  // Invalidate active preview on any draft input modification
  const invalidatePreview = useCallback(() => {
    trackerRef.current.invalidate();
    setPreviewPlan(null);
    setPreviewDraftMap(null);
    setPreviewInstanceId(null);
    setPreviewGeneration(null);
    setPreviewError(null);
  }, []);

  // Handle raw text input change
  const handleInputChange = (modId: string, value: string) => {
    invalidatePreview();
    setRawInputs((prev) => ({ ...prev, [modId]: value }));

    const res = validatePriorityInput(value, t);
    if (!res.valid) {
      setInputErrors((prev) => ({ ...prev, [modId]: res.error || t('priorityView.invalidInput') }));
    } else {
      setInputErrors((prev) => {
        const next = { ...prev };
        delete next[modId];
        return next;
      });
      setDraftPriorities((prev) => ({
        ...prev,
        [modId]: res.value!,
      }));
    }
  };

  // Handle step delta (+10, -10, +1, -1)
  const handleStepDelta = (modId: string, delta: number) => {
    invalidatePreview();
    const current = draftPriorities[modId] ?? baselinePriorities[modId] ?? 0;
    const nextVal = current + delta;

    setRawInputs((prev) => ({ ...prev, [modId]: String(nextVal) }));
    setInputErrors((prev) => {
      const next = { ...prev };
      delete next[modId];
      return next;
    });
    setDraftPriorities((prev) => ({
      ...prev,
      [modId]: nextVal,
    }));
  };

  // Reset draft priorities to baseline
  const handleReset = () => {
    invalidatePreview();
    setDraftPriorities({ ...baselinePriorities });
    setRawInputs({});
    setInputErrors({});
  };

  // Preview Priority Plan via PreviewPriority
  const handlePreview = async () => {
    if (!hasChanges || hasInputErrors || previewLoading || isApplying) return;

    setPreviewLoading(true);
    setPreviewError(null);
    setRightTab('preview');
    const token = trackerRef.current.createRequest();

    try {
      const plan = await PreviewPriority(draftDiff.draftMap);
      if (!trackerRef.current.isResponseValid(token)) return;

      setPreviewPlan(plan);
      setPreviewDraftMap({ ...draftDiff.draftMap });
      setPreviewInstanceId(currentInstanceId);
      setPreviewGeneration(overview?.generation ?? plan?.generation ?? null);

      if (plan.blockers && plan.blockers.length > 0) {
        showToast(t('priorityView.previewBlockedToast'));
      } else {
        showToast(t('priorityView.previewDoneToast'));
      }
    } catch (err: any) {
      if (!trackerRef.current.isResponseValid(token)) return;
      const msg = err?.message || String(err) || t('priorityView.previewFailed');
      setPreviewError(msg);
      showToast(t('priorityView.previewFailedToast', { message: msg }));
    } finally {
      if (trackerRef.current.isResponseValid(token)) {
        setPreviewLoading(false);
      }
    }
  };

  // Check if priority plan meets safety requirements to apply
  const applyCheck = useMemo(() => {
    return canApplyPriorityPlan({
      previewPlan,
      previewDraftMap,
      previewInstanceId,
      previewGeneration,
      currentDraftMap: draftDiff.draftMap,
      currentInstanceId,
      currentGeneration: overview?.generation,
      hasChanges,
      hasInputErrors,
      previewLoading,
      isApplying,
    }, t);
  }, [
    previewPlan, t,
    previewDraftMap,
    previewInstanceId,
    previewGeneration,
    draftDiff.draftMap,
    currentInstanceId,
    overview?.generation,
    hasChanges,
    hasInputErrors,
    previewLoading,
    isApplying,
  ]);

  // Apply Plan via ExecutePlan
  const handleApply = async () => {
    if (!previewPlan) {
      setRightTab('preview');
      setPreviewError(t('priorityView.needPreview'));
      return;
    }

    if (!applyCheck.canApply) {
      setRightTab('preview');
      setPreviewError(applyCheck.reason || t('priorityView.previewNotApplicable'));
      showToast(applyCheck.reason || t('priorityView.cannotApply'));
      return;
    }

    setIsApplying(true);
    try {
      // Execute plan on backend
      await ExecutePlan({
        plan_id: previewPlan.plan_id,
        confirmed: true,
      });

      showToast(t('priorityView.appliedToast'));

      // Refresh authoritative data
      try {
        await loadOverview(currentInstanceId);
        await onRefreshInstalled({ forced: true });
      } catch (refreshErr) {
        showToast(t('priorityView.appliedRefreshFailed'));
      }
    } catch (err: any) {
      const msg = err?.message || String(err) || t('priorityView.applyFailed');
      showToast(t('priorityView.applyFailedToast', { message: msg }));
    } finally {
      setIsApplying(false);
    }
  };

  // Title map to resolve mod_id / installation_id to display title
  const modTitleMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (overview?.mods) {
      for (const m of overview.mods) {
        if (m.mod_id && m.title) {
          map[m.mod_id] = m.title;
        }
        if (m.installation_id && m.title) {
          map[m.installation_id] = m.title;
        }
      }
    }
    if (installedMods) {
      for (const m of installedMods) {
        if (m.mod_id && m.title) {
          map[m.mod_id] = m.title;
        }
      }
    }
    return map;
  }, [overview, installedMods]);

  // Filtered conflicting paths in overview
  const filteredPaths = useMemo(() => {
    if (!overview || !overview.paths) return [];
    const query = pathSearchQuery.trim().toLowerCase();
    if (!query) return overview.paths;
    return overview.paths.filter(
      (p) =>
        p.path.toLowerCase().includes(query) ||
        p.active_owner.toLowerCase().includes(query) ||
        (modTitleMap[p.active_owner] && modTitleMap[p.active_owner].toLowerCase().includes(query))
    );
  }, [overview, pathSearchQuery, modTitleMap]);

  // Formatted diffs for right preview pane
  const formattedActions: FormattedPriorityDiff[] = useMemo(() => {
    if (!previewPlan || !previewPlan.actions) return [];
    return formatPriorityPlanActions(previewPlan.actions, modTitleMap, t);
  }, [previewPlan, modTitleMap]);

  const hasBlockers = Boolean(previewPlan?.blockers && previewPlan.blockers.length > 0);

  const renderActionBadge = (action: string) => {
    switch (action) {
      case 'OVERWRITE':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60 font-mono">
            {t('priorityView.badgeOverwrite')}
          </span>
        );
      case 'METADATA_ONLY':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800/60 font-mono">
            {t('priorityView.badgeReassign')}
          </span>
        );
      case 'RESTORE':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-950/80 text-sky-300 border border-sky-800/60 font-mono">
            {t('priorityView.badgeRestore')}
          </span>
        );
      case 'DELETE':
      case 'REMOVE':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800/60 font-mono">
            {t('priorityView.badgeDelete')}
          </span>
        );
      default:
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 font-mono">
            {action}
          </span>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-950">
      {/* Top Header */}
      <div className="p-3 sm:p-4 border-b border-neutral-800 bg-neutral-900/50 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-neutral-100">
              {t('priorityView.title')}
            </h2>
            {overview && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 font-mono">
                Gen {overview.generation}
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            {t('priorityView.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs shrink-0 w-full md:w-auto">
          <button
            onClick={() => loadOverview(currentInstanceId)}
            disabled={loadingOverview || isApplying}
            title={t('priorityView.refreshTitle')}
            className="p-2 sm:p-1.5 rounded-lg bg-neutral-800 text-neutral-300 hover:text-white disabled:opacity-40 transition-colors cursor-pointer min-h-[36px] sm:min-h-0 flex items-center justify-center active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingOverview ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handleReset}
            disabled={(!hasChanges && !hasInputErrors) || isApplying}
            className="px-3 py-1.5 rounded-lg bg-neutral-800 text-neutral-300 hover:text-white disabled:opacity-40 transition-colors flex items-center gap-1.5 cursor-pointer min-h-[36px] sm:min-h-0 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t('priorityView.reset')}</span>
          </button>

          <button
            onClick={handlePreview}
            disabled={!hasChanges || hasInputErrors || previewLoading || isApplying}
            className="px-3.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white disabled:opacity-40 transition-colors flex items-center gap-1.5 font-medium cursor-pointer min-h-[36px] sm:min-h-0 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
          >
            {previewLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
            ) : (
              <Eye className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span>{t('priorityView.generatePreview')}</span>
          </button>

          <button
            onClick={handleApply}
            disabled={!applyCheck.canApply}
            title={applyCheck.reason || t('priorityView.applyTitle')}
            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-40 transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer min-h-[36px] sm:min-h-0 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
          >
            {isApplying ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>{isApplying ? t('priorityView.applying') : t('priorityView.apply')}</span>
          </button>
        </div>
      </div>

      {/* Main split view: Mod Priority List on Left, Live Diff Preview / Conflicts on Right */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        {/* Left Column: Mods (7 cols) */}
        <div className="lg:col-span-7 border-r border-neutral-800 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-neutral-800 bg-neutral-900/30 flex items-center justify-between text-xs text-neutral-400">
            <span className="flex items-center gap-1.5 font-medium text-neutral-300">
              <Sliders className="w-3.5 h-3.5 text-neutral-400" />
              {t('priorityView.listTitle')}
            </span>
            <span className="font-mono text-[11px]">
              {hasChanges ? (
                <span className="text-amber-400 font-semibold">
                  {t('priorityView.draftChanged', { count: draftDiff.changedMods.length })}
                </span>
              ) : (
                <span className="text-neutral-500">{t('priorityView.inSync')}</span>
              )}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {loadingOverview && !overview && (
              <div className="h-64 flex flex-col items-center justify-center text-neutral-500 text-xs gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                <span>{t('priorityView.loading')}</span>
              </div>
            )}

            {overviewError && (
              <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/60 text-rose-300 text-xs space-y-2">
                <div className="flex items-center gap-2 font-bold">
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                  <span>{t('priorityView.loadFailedShort')}</span>
                </div>
                <p>{overviewError}</p>
                <button
                  onClick={() => loadOverview(currentInstanceId)}
                  className="px-3 py-1 rounded bg-rose-900/60 hover:bg-rose-800 text-white font-medium text-[11px] transition-colors active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                >
                  {t('priorityView.retry')}
                </button>
              </div>
            )}

            {!loadingOverview && !overviewError && sortedMods.length === 0 && (
              <div className="h-64 flex flex-col items-center justify-center text-neutral-500 text-xs text-center p-6 space-y-2">
                <Layers className="w-8 h-8 text-neutral-600 mb-1" />
                <p className="font-medium text-neutral-400">{t('priorityView.emptyTitle')}</p>
                <p className="text-[11px] text-neutral-500 max-w-sm">
                  {t('priorityView.emptyBody')}
                </p>
              </div>
            )}

            {sortedMods.map((item, index) => {
              const currentPriority = draftPriorities[item.mod_id] ?? item.priority;
              const isModified = currentPriority !== item.priority;
              const rawVal = rawInputs[item.mod_id] ?? String(currentPriority);
              const err = inputErrors[item.mod_id];

              return (
                <div
                  key={item.mod_id}
                  className={`p-3.5 rounded-xl border transition-all flex flex-col gap-2.5 ${
                    isModified
                      ? 'bg-amber-950/20 border-amber-800/80 shadow-xs'
                      : 'bg-neutral-900/80 border-neutral-800 hover:border-neutral-700'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <span className="w-6 text-center font-mono font-bold text-xs text-neutral-400 shrink-0 mt-0.5">
                        #{index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-neutral-100 text-xs break-words max-w-[200px] sm:max-w-none" title={item.title}>
                            {item.title}
                          </span>
                          <span className="text-[10px] text-neutral-400 font-mono shrink-0">
                            v{item.version}
                          </span>
                        </div>
                        <div className="text-[11px] text-neutral-400 mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="truncate max-w-[120px]">{item.author}</span>
                          <span>·</span>
                          <span>{item.category === 'submod' ? t('priorityView.categorySubmod') : t('priorityView.categorySpritepack')}</span>
                          <span>·</span>
                          <span className="font-mono text-[10px] text-neutral-500 whitespace-nowrap">
                            {t('priorityView.filesActive', { active: item.active_files, total: item.total_files })}
                          </span>
                          {item.overridden_files > 0 && (
                            <span className="font-mono text-[10px] text-amber-500 whitespace-nowrap">
                              {t('priorityView.filesOverridden', { count: item.overridden_files })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Priority Value Input & Stepper */}
                    <div className="flex items-center justify-end gap-2 shrink-0 self-end sm:self-center pt-1 sm:pt-0">
                      <div className="flex flex-col items-end">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-neutral-400">{t('priorityView.priorityLabel')}</span>
                          <input
                            type="text"
                            value={rawVal}
                            onChange={(e) => handleInputChange(item.mod_id, e.target.value)}
                            aria-label={t('priorityView.priorityAria', { title: item.title })}
                            className={`w-16 px-2 py-1 rounded bg-neutral-950 border font-mono font-bold text-xs text-right text-emerald-400 focus:outline-hidden focus:ring-1 ${
                              err
                                ? 'border-rose-500 focus:ring-rose-500'
                                : isModified
                                ? 'border-amber-500 focus:ring-amber-500'
                                : 'border-neutral-700 focus:ring-emerald-500'
                            }`}
                          />
                        </div>
                        {isModified && !err && (
                          <div className="text-[10px] text-amber-400 font-mono mt-0.5">
                            {t('priorityView.originalValue', { value: item.priority })}
                          </div>
                        )}
                      </div>

                      {/* Step delta buttons */}
                      <div className="flex items-center gap-0.5 bg-neutral-950 p-0.5 rounded-lg border border-neutral-800">
                        <button
                          onClick={() => handleStepDelta(item.mod_id, 10)}
                          title={t('priorityView.raisePriority')}
                          className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-colors cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleStepDelta(item.mod_id, -10)}
                          title={t('priorityView.lowerPriority')}
                          className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-colors cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {err && (
                    <div className="text-[11px] text-rose-400 flex items-center gap-1 pl-9">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      <span>{err}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Tabbed Preview & Conflict Analysis (5 cols) */}
        <div className="lg:col-span-5 bg-neutral-950/70 flex flex-col overflow-hidden">
          {/* Tabs bar */}
          <div className="p-2.5 border-b border-neutral-800 bg-neutral-900/40 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-1 bg-neutral-900 p-0.5 rounded-lg border border-neutral-800">
              <button
                onClick={() => setRightTab('preview')}
                className={`${darkSegmentClass(rightTab === 'preview', 'px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5')} active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400`}
              >
                <Eye className="w-3 h-3 text-emerald-400" />
                <span>{t('priorityView.changesTitle')}</span>
                {formattedActions.length > 0 && (
                  <span className="text-[10px] px-1 py-0.2 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                    {formattedActions.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setRightTab('conflicts')}
                className={`${darkSegmentClass(rightTab === 'conflicts', 'px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5')} active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400`}
              >
                <FileText className="w-3 h-3 text-sky-400" />
                <span>{t('priorityView.pathsTitle')}</span>
                {overview?.paths && (
                  <span className="text-[10px] px-1 py-0.2 rounded-full bg-sky-950 text-sky-400 border border-sky-800 font-mono">
                    {overview.paths.length}
                  </span>
                )}
              </button>
            </div>

            {rightTab === 'conflicts' && (
              <div className="relative">
                <Search className="w-3 h-3 text-neutral-500 absolute left-2 top-2" />
                <input
                  type="text"
                  placeholder={t('priorityView.searchPaths')}
                  value={pathSearchQuery}
                  onChange={(e) => setPathSearchQuery(e.target.value)}
                  className="pl-6 pr-2 py-0.5 text-xs bg-neutral-900 border border-neutral-800 rounded text-neutral-200 placeholder-neutral-500 focus:outline-hidden focus:border-neutral-700 w-32 md:w-36"
                />
              </div>
            )}
          </div>

          {/* Right Tab Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {rightTab === 'preview' ? (
              <>
                {/* Notice header */}
                <div className="p-3 rounded-lg bg-neutral-900/80 border border-neutral-800 text-xs text-neutral-300 space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold text-neutral-200">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>{t('priorityView.previewMechanismTitle')}</span>
                  </div>
                  <p className="text-[11px] text-neutral-400 leading-relaxed">
                    {t('priorityView.previewMechanismBody')}
                  </p>
                </div>

                {previewLoading && (
                  <div className="p-8 flex flex-col items-center justify-center text-xs text-neutral-400 gap-2">
                    <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                    <span>{t('priorityView.previewComputing')}</span>
                  </div>
                )}

                {previewError && (
                  <div className="p-3.5 rounded-lg bg-rose-950/30 border border-rose-800/80 text-rose-300 text-xs space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-rose-400" />
                      <span>{t('priorityView.previewFailedTitle')}</span>
                    </div>
                    <p className="text-[11px]">{previewError}</p>
                  </div>
                )}

                {/* Preview Blockers */}
                {previewPlan?.blockers && previewPlan.blockers.length > 0 && (
                  <div className="p-3.5 rounded-lg bg-rose-950/30 border border-rose-800/80 text-rose-300 text-xs space-y-2">
                    <div className="font-bold flex items-center gap-1.5 text-rose-400">
                      <AlertTriangle className="w-4 h-4" />
                      <span>{t('priorityView.blockersTitle')}</span>
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-[11px]">
                      {previewPlan.blockers.map((blk: string, idx: number) => (
                        <li key={idx}>{blk}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Preview Risks */}
                {previewPlan?.risks && previewPlan.risks.length > 0 && (
                  <div className="p-3.5 rounded-lg bg-amber-950/30 border border-amber-800/80 text-amber-300 text-xs space-y-2">
                    <div className="font-bold flex items-center gap-1.5 text-amber-400">
                      <AlertTriangle className="w-4 h-4" />
                      <span>{t('priorityView.warningsTitle')}</span>
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-[11px]">
                      {previewPlan.risks.map((r: any, idx: number) => (
                        <li key={idx}>{r.description || r.type}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Preview Summary Pills */}
                {previewPlan && previewPlan.summary && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-lg bg-neutral-900 border border-neutral-800">
                      <div className="text-[11px] text-neutral-400">{t('priorityView.metricOverwrite')}</div>
                      <div className="text-sm font-mono font-bold text-amber-400 mt-0.5">
                        {previewPlan.summary.writes_new || 0}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-neutral-900 border border-neutral-800">
                      <div className="text-[11px] text-neutral-400">{t('priorityView.metricRestoreLayer')}</div>
                      <div className="text-sm font-mono font-bold text-sky-400 mt-0.5">
                        {previewPlan.summary.restores_layer || 0}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-neutral-900 border border-neutral-800">
                      <div className="text-[11px] text-neutral-400">{t('priorityView.metricReassign')}</div>
                      <div className="text-sm font-mono font-bold text-purple-400 mt-0.5">
                        {previewPlan.summary.metadata_only || 0}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-neutral-900 border border-neutral-800">
                      <div className="text-[11px] text-neutral-400">{t('priorityView.metricRestoreBase')}</div>
                      <div className="text-sm font-mono font-bold text-emerald-400 mt-0.5">
                        {previewPlan.summary.restores_original || 0}
                      </div>
                    </div>
                  </div>
                )}

                {/* Generated Ren'Py cache cleanup for rewritten scripts */}
                {previewPlan?.cleanup_paths?.length > 0 && (
                  <div className="p-2.5 rounded-lg bg-sky-950/40 border border-sky-800/80 text-[11px] text-neutral-300">
                    <div className="font-semibold text-sky-300">
                      {t('priorityView.cleanupPaths', { count: previewPlan.cleanup_paths.length })}
                    </div>
                    <div className="mt-1 font-mono max-h-24 overflow-y-auto space-y-0.5">
                      {previewPlan.cleanup_paths.map((path: string) => (
                        <div key={path} className="break-all">• {path}</div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions list */}
                {previewPlan && formattedActions.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center justify-between">
                      <span>{t('priorityView.actionListTitle')}</span>
                      <span className="font-mono text-emerald-400">{t('priorityView.actionCount', { count: formattedActions.length })}</span>
                    </div>

                    <div className="space-y-2">
                      {formattedActions.map((item, idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-lg bg-neutral-900/60 border border-neutral-800/80 space-y-2 text-xs font-mono"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-neutral-200 truncate font-semibold" title={item.path}>
                              {item.path}
                            </span>
                            {renderActionBadge(item.action)}
                          </div>

                          <div className="text-[11px] text-neutral-400 font-sans">
                            {item.reason}
                          </div>

                          <div className="pt-2 border-t border-neutral-800 text-[11px] flex items-center justify-between gap-2">
                            <span className="text-neutral-400">
                              {t('priorityView.prevWinner')} <span className="text-neutral-300 font-bold">{item.previousWinner}</span>
                            </span>
                            <span className="text-neutral-500">→</span>
                            <span className="text-neutral-400">
                              {t('priorityView.nextWinner')} <span className="text-emerald-400 font-bold">{item.nextWinner}</span>
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {previewPlan && formattedActions.length === 0 && !previewLoading && (
                  <div className="p-6 rounded-lg bg-neutral-900/40 border border-neutral-800 text-center text-xs text-neutral-400 space-y-1">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 mx-auto mb-1" />
                    <p className="font-semibold text-neutral-200">{t('priorityView.noChangesTitle')}</p>
                    <p className="text-[11px] text-neutral-500">
                      {t('priorityView.noChangesBody')}
                    </p>
                  </div>
                )}

                {!previewPlan && !previewLoading && (
                  <div className="p-6 rounded-lg bg-neutral-900/40 border border-neutral-800 text-center text-xs text-neutral-400 space-y-2">
                    <Info className="w-5 h-5 text-neutral-500 mx-auto" />
                    {hasChanges ? (
                      <div>
                        <p className="font-semibold text-neutral-200">{t('priorityView.draftChangedTitle')}</p>
                        <p className="text-[11px] text-neutral-500 mt-1">
                          {t('priorityView.draftChangedBody')}
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p className="font-semibold text-neutral-300">{t('priorityView.noDraftTitle')}</p>
                        <p className="text-[11px] text-neutral-500 mt-1">
                          {t('priorityView.noDraftBody')}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              /* Conflicts tab */
              <div className="space-y-3">
                <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center justify-between">
                  <span>{t('priorityView.overlapTitle')}</span>
                  <span className="font-mono text-sky-400">{t('priorityView.overlapCount', { count: filteredPaths.length })}</span>
                </div>

                {filteredPaths.length === 0 && (
                  <div className="p-6 rounded-lg bg-neutral-900/40 border border-neutral-800 text-center text-xs text-neutral-400 space-y-1">
                    <FileText className="w-5 h-5 text-neutral-500 mx-auto mb-1" />
                    <p className="font-semibold text-neutral-300">{t('priorityView.overlapEmptyTitle')}</p>
                    <p className="text-[11px] text-neutral-500">
                      {t('priorityView.overlapEmptyBody')}
                    </p>
                  </div>
                )}

                {filteredPaths.map((pe: PriorityPathEntry, idx: number) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-neutral-900/60 border border-neutral-800 space-y-2 text-xs font-mono"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sky-300 truncate font-semibold" title={pe.path}>
                        {pe.path}
                      </span>
                      {pe.drifted && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800/60 font-sans font-medium">
                          {t('priorityView.driftDetected')}
                        </span>
                      )}
                    </div>

                    <div className="pt-2 border-t border-neutral-800 text-[11px] font-sans space-y-1.5">
                      <div className="text-neutral-400 flex items-center justify-between">
                        <span>
                          {t('priorityView.activeOwner')}{' '}
                          <span className="text-neutral-200 font-semibold">{modTitleMap[pe.active_owner] || pe.active_owner || t('priorityView.none')}</span>
                        </span>
                        <span className="text-[10px] text-neutral-500 font-mono">
                          {t('priorityView.layersCount', { count: pe.layers?.length || 0 })}
                        </span>
                      </div>

                      {pe.layers && pe.layers.length > 0 && (
                        <div className="bg-neutral-950 p-2 rounded border border-neutral-800/80 space-y-1 font-mono text-[10px]">
                          <div className="text-neutral-500 text-[9px] uppercase tracking-wider mb-1">
                            {t('priorityView.participantsTitle')}
                          </div>
                          {[...(pe.layers ?? [])].sort(comparePriorityDisplay).map((layer, lIdx) => (
                            <div
                              key={layer.installation_id || lIdx}
                              className={`flex items-center justify-between py-0.5 px-1 rounded ${
                                layer.mod_id === pe.active_owner
                                  ? 'bg-emerald-950/40 text-emerald-300 font-bold'
                                  : 'text-neutral-400'
                              }`}
                            >
                              <span>
                                #{lIdx + 1} {modTitleMap[layer.mod_id] || layer.mod_id || layer.installation_id}
                              </span>
                              <span>{t('priorityView.layerPriority', { priority: layer.priority })}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
