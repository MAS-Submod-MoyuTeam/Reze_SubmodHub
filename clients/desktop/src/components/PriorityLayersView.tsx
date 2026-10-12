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
        const msg = err?.message || String(err) || '读取模组优先级总览失败';
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
        author: installed?.author_name || '未知作者',
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

    const res = validatePriorityInput(value);
    if (!res.valid) {
      setInputErrors((prev) => ({ ...prev, [modId]: res.error || '非法输入' }));
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
        showToast('检测到调整阻断项，请核对右侧预览报告');
      } else {
        showToast('预览计算完成，请检查受影响的文件变更清单');
      }
    } catch (err: any) {
      if (!trackerRef.current.isResponseValid(token)) return;
      const msg = err?.message || String(err) || '优先级变更预览失败';
      setPreviewError(msg);
      showToast(`预览失败: ${msg}`);
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
    });
  }, [
    previewPlan,
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
      setPreviewError('请先计算并确认变更预览');
      return;
    }

    if (!applyCheck.canApply) {
      setRightTab('preview');
      setPreviewError(applyCheck.reason || '当前预览不可直接应用，请重新计算并确认变更预览');
      showToast(applyCheck.reason || '无法应用变更');
      return;
    }

    setIsApplying(true);
    try {
      // Execute plan on backend
      await ExecutePlan({
        plan_id: previewPlan.plan_id,
        confirmed: true,
      });

      showToast('新模组优先级配置已成功应用并写入 MAS 磁盘');

      // Refresh authoritative data
      try {
        await loadOverview(currentInstanceId);
        await onRefreshInstalled({ forced: true });
      } catch (refreshErr) {
        showToast('已应用，状态刷新失败，请手动刷新');
      }
    } catch (err: any) {
      const msg = err?.message || String(err) || '应用失败';
      showToast(`应用失败: ${msg}`);
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
    return formatPriorityPlanActions(previewPlan.actions, modTitleMap);
  }, [previewPlan, modTitleMap]);

  const hasBlockers = Boolean(previewPlan?.blockers && previewPlan.blockers.length > 0);

  const renderActionBadge = (action: string) => {
    switch (action) {
      case 'OVERWRITE':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60 font-mono">
            覆写 (OVERWRITE)
          </span>
        );
      case 'METADATA_ONLY':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800/60 font-mono">
            转移所有权 (METADATA)
          </span>
        );
      case 'RESTORE':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-950/80 text-sky-300 border border-sky-800/60 font-mono">
            还原 (RESTORE)
          </span>
        );
      case 'DELETE':
      case 'REMOVE':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800/60 font-mono">
            删除 (DELETE)
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
      <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-neutral-100">
              模组优先级
            </h2>
            {overview && (
              <span className="text-[11px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 font-mono">
                Gen {overview.generation}
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            管理 MAS 同名文件的覆盖优先级。数值越大越优先生效；同优先级时后安装的模组优先生效。未生效文件会保留，卸载或调整优先级后可恢复。
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs shrink-0">
          <button
            onClick={() => loadOverview(currentInstanceId)}
            disabled={loadingOverview || isApplying}
            title="重新获取当前 MAS 实例的优先级数据"
            className="p-1.5 rounded-lg bg-neutral-800 text-neutral-300 hover:text-white disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingOverview ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handleReset}
            disabled={(!hasChanges && !hasInputErrors) || isApplying}
            className="px-3 py-1.5 rounded-lg bg-neutral-800 text-neutral-300 hover:text-white disabled:opacity-40 transition-colors flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>撤销重置</span>
          </button>

          <button
            onClick={handlePreview}
            disabled={!hasChanges || hasInputErrors || previewLoading || isApplying}
            className="px-3.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white disabled:opacity-40 transition-colors flex items-center gap-1.5 font-medium"
          >
            {previewLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
            ) : (
              <Eye className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span>生成预览</span>
          </button>

          <button
            onClick={handleApply}
            disabled={!applyCheck.canApply}
            title={applyCheck.reason || '应用新优先级并写入 MAS 磁盘'}
            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-40 transition-colors flex items-center gap-1.5 shadow-xs"
          >
            {isApplying ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>{isApplying ? '正在写盘应用...' : '应用并写入磁盘'}</span>
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
              当前模组优先级（由高至低生效）
            </span>
            <span className="font-mono text-[11px]">
              {hasChanges ? (
                <span className="text-amber-400 font-semibold">
                  有 {draftDiff.changedMods.length} 个模组已修改草稿
                </span>
              ) : (
                <span className="text-neutral-500">与磁盘当前状态一致</span>
              )}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {loadingOverview && !overview && (
              <div className="h-64 flex flex-col items-center justify-center text-neutral-500 text-xs gap-2">
                <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                <span>正在加载实例模组优先级与覆盖关系...</span>
              </div>
            )}

            {overviewError && (
              <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-800/60 text-rose-300 text-xs space-y-2">
                <div className="flex items-center gap-2 font-bold">
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                  <span>加载失败</span>
                </div>
                <p>{overviewError}</p>
                <button
                  onClick={() => loadOverview(currentInstanceId)}
                  className="px-3 py-1 rounded bg-rose-900/60 hover:bg-rose-800 text-white font-medium text-[11px] transition-colors"
                >
                  重试
                </button>
              </div>
            )}

            {!loadingOverview && !overviewError && sortedMods.length === 0 && (
              <div className="h-64 flex flex-col items-center justify-center text-neutral-500 text-xs text-center p-6 space-y-2">
                <Layers className="w-8 h-8 text-neutral-600 mb-1" />
                <p className="font-medium text-neutral-400">当前 MAS 实例暂无受管模组</p>
                <p className="text-[11px] text-neutral-500 max-w-sm">
                  仅由 SubmodHub 托管安装的模组参与模组优先级管理。请先从模组目录安装模组。
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
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 truncate">
                      <span className="w-6 text-center font-mono font-bold text-xs text-neutral-400">
                        #{index + 1}
                      </span>
                      <div className="truncate">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-neutral-100 text-xs truncate">
                            {item.title}
                          </span>
                          <span className="text-[10px] text-neutral-400 font-mono">
                            v{item.version}
                          </span>
                        </div>
                        <div className="text-[11px] text-neutral-400 mt-0.5 truncate flex items-center gap-2">
                          <span>{item.author}</span>
                          <span>·</span>
                          <span>{item.category === 'submod' ? '功能模组' : '外观材质包'}</span>
                          <span>·</span>
                          <span className="font-mono text-[10px] text-neutral-500">
                            生效文件: {item.active_files} / 总文件: {item.total_files}
                          </span>
                          {item.overridden_files > 0 && (
                            <span className="font-mono text-[10px] text-amber-500">
                              (被覆盖: {item.overridden_files})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Priority Value Input & Stepper */}
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex flex-col items-end">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-neutral-400">优先级:</span>
                          <input
                            type="text"
                            value={rawVal}
                            onChange={(e) => handleInputChange(item.mod_id, e.target.value)}
                            aria-label={`${item.title} 优先级`}
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
                            原值: {item.priority}
                          </div>
                        )}
                      </div>

                      {/* Step delta buttons */}
                      <div className="flex items-center gap-0.5 bg-neutral-950 p-0.5 rounded-lg border border-neutral-800">
                        <button
                          onClick={() => handleStepDelta(item.mod_id, 10)}
                          title="提高优先级 (+10)"
                          className="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-colors"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleStepDelta(item.mod_id, -10)}
                          title="降低优先级 (-10)"
                          className="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-colors"
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
                className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  rightTab === 'preview'
                    ? 'bg-neutral-800 text-neutral-100 shadow-xs'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <Eye className="w-3 h-3 text-emerald-400" />
                <span>变更计划预览</span>
                {formattedActions.length > 0 && (
                  <span className="text-[10px] px-1 py-0.2 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono">
                    {formattedActions.length}
                  </span>
                )}
              </button>

              <button
                onClick={() => setRightTab('conflicts')}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  rightTab === 'conflicts'
                    ? 'bg-neutral-800 text-neutral-100 shadow-xs'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <FileText className="w-3 h-3 text-sky-400" />
                <span>共享与冲突路径</span>
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
                  placeholder="搜索路径..."
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
                    <span>PreviewPriority 覆盖校验机制</span>
                  </div>
                  <p className="text-[11px] text-neutral-400 leading-relaxed">
                    调整优先级前系统通过只读规划器计算受影响文件的归属变化，确保无损还原，并在检测到外部篡改或冲突时主动阻断。
                  </p>
                </div>

                {previewLoading && (
                  <div className="p-8 flex flex-col items-center justify-center text-xs text-neutral-400 gap-2">
                    <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                    <span>正在计算受影响文件与生效归属转移...</span>
                  </div>
                )}

                {previewError && (
                  <div className="p-3.5 rounded-lg bg-rose-950/30 border border-rose-800/80 text-rose-300 text-xs space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 text-rose-400" />
                      <span>预览计算失败</span>
                    </div>
                    <p className="text-[11px]">{previewError}</p>
                  </div>
                )}

                {/* Preview Blockers */}
                {previewPlan?.blockers && previewPlan.blockers.length > 0 && (
                  <div className="p-3.5 rounded-lg bg-rose-950/30 border border-rose-800/80 text-rose-300 text-xs space-y-2">
                    <div className="font-bold flex items-center gap-1.5 text-rose-400">
                      <AlertTriangle className="w-4 h-4" />
                      <span>存在阻断项（无法应用变更）</span>
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
                      <span>潜在风险提醒</span>
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
                      <div className="text-[11px] text-neutral-400">覆写写入</div>
                      <div className="text-sm font-mono font-bold text-amber-400 mt-0.5">
                        {previewPlan.summary.writes_new || 0}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-neutral-900 border border-neutral-800">
                      <div className="text-[11px] text-neutral-400">恢复活动模组</div>
                      <div className="text-sm font-mono font-bold text-sky-400 mt-0.5">
                        {previewPlan.summary.restores_layer || 0}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-neutral-900 border border-neutral-800">
                      <div className="text-[11px] text-neutral-400">同内容所有权转移</div>
                      <div className="text-sm font-mono font-bold text-purple-400 mt-0.5">
                        {previewPlan.summary.metadata_only || 0}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-neutral-900 border border-neutral-800">
                      <div className="text-[11px] text-neutral-400">还原基底原始包</div>
                      <div className="text-sm font-mono font-bold text-emerald-400 mt-0.5">
                        {previewPlan.summary.restores_original || 0}
                      </div>
                    </div>
                  </div>
                )}

                {/* Actions list */}
                {previewPlan && formattedActions.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider flex items-center justify-between">
                      <span>文件变更动作列表</span>
                      <span className="font-mono text-emerald-400">{formattedActions.length} 处变动</span>
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
                              原胜出: <span className="text-neutral-300 font-bold">{item.previousWinner}</span>
                            </span>
                            <span className="text-neutral-500">→</span>
                            <span className="text-neutral-400">
                              新胜出: <span className="text-emerald-400 font-bold">{item.nextWinner}</span>
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
                    <p className="font-semibold text-neutral-200">无文件写盘变更</p>
                    <p className="text-[11px] text-neutral-500">
                      当前优先级的调整未引发同名文件胜出者切换，或仅作为未来冲突预备。
                    </p>
                  </div>
                )}

                {!previewPlan && !previewLoading && (
                  <div className="p-6 rounded-lg bg-neutral-900/40 border border-neutral-800 text-center text-xs text-neutral-400 space-y-2">
                    <Info className="w-5 h-5 text-neutral-500 mx-auto" />
                    {hasChanges ? (
                      <div>
                        <p className="font-semibold text-neutral-200">检测到草稿变更</p>
                        <p className="text-[11px] text-neutral-500 mt-1">
                          请点击上方的「生成预览」按钮，计算变更对磁盘文件的实际影响。
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p className="font-semibold text-neutral-300">当前无草稿变动</p>
                        <p className="text-[11px] text-neutral-500 mt-1">
                          在左侧修改模组优先级数值后，即可实时在此查看文件覆盖详情。
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
                  <span>检测到的跨模组重叠路径</span>
                  <span className="font-mono text-sky-400">{filteredPaths.length} 条</span>
                </div>

                {filteredPaths.length === 0 && (
                  <div className="p-6 rounded-lg bg-neutral-900/40 border border-neutral-800 text-center text-xs text-neutral-400 space-y-1">
                    <FileText className="w-5 h-5 text-neutral-500 mx-auto mb-1" />
                    <p className="font-semibold text-neutral-300">无重叠路径匹配</p>
                    <p className="text-[11px] text-neutral-500">
                      当前实例中模组文件彼此独立，未检测到相同目标路径竞争。
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
                          检测到外部修改漂移
                        </span>
                      )}
                    </div>

                    <div className="pt-2 border-t border-neutral-800 text-[11px] font-sans space-y-1.5">
                      <div className="text-neutral-400 flex items-center justify-between">
                        <span>
                          当前生效归属:{' '}
                          <span className="text-neutral-200 font-semibold">{modTitleMap[pe.active_owner] || pe.active_owner || '无'}</span>
                        </span>
                        <span className="text-[10px] text-neutral-500 font-mono">
                          {pe.layers?.length || 0} 个模组参与覆盖
                        </span>
                      </div>

                      {pe.layers && pe.layers.length > 0 && (
                        <div className="bg-neutral-950 p-2 rounded border border-neutral-800/80 space-y-1 font-mono text-[10px]">
                          <div className="text-neutral-500 text-[9px] uppercase tracking-wider mb-1">
                            参与模组（由高至低生效）
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
                              <span>优先级 {layer.priority}</span>
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
