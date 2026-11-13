import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldAlert,
  AlertTriangle,
  Clock,
  ArrowRight,
  FileCheck,
  CheckCircle2,
  Lock,
  Sparkles,
} from 'lucide-react';
import { Plan, Installation } from '../types/client';
import { m } from './Motion';
import { overlayVariants } from '../../../../ui/motion-presets';
import { useI18n } from '../i18n';

interface PlanPreviewModalProps {
  plan: Plan | null;
  activeInstallation: Installation;
  isGameRunning: boolean;
  onClose: () => void;
  onApplyPlan: (planId: string) => void;
  onOpenRecovery?: () => void;
}

export const PlanPreviewModal: React.FC<PlanPreviewModalProps> = ({
  plan,
  activeInstallation,
  isGameRunning,
  onClose,
  onApplyPlan,
  onOpenRecovery,
}) => {
  const { t } = useI18n();
  const [timeLeft, setTimeLeft] = useState(300); // 5 minutes validity countdown
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false);
  const [uninstallConfirmed, setUninstallConfirmed] = useState(false);
  const [unsupportedConfirmed, setUnsupportedConfirmed] = useState(false);

  useEffect(() => {
    if (!plan) return;
    setOverwriteConfirmed(false);
    setUninstallConfirmed(false);
    setUnsupportedConfirmed(false);
    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [plan?.plan_id]);

  if (!plan) return null;

  const spriteCtx = plan.sprite_selection_context;
  const hasUninstallRemovals = Boolean(
    spriteCtx &&
    ((spriteCtx.removed_ids && spriteCtx.removed_ids.length > 0) ||
      (spriteCtx.unavailable_installed_ids && spriteCtx.unavailable_installed_ids.length > 0) ||
      spriteCtx.unknown_legacy_selection)
  );

  const hasDependencyBlockers = plan.dependency_blockers.length > 0;
  const hasSemanticBlockers = plan.semantic_blockers.length > 0;
  const hasBackendBlockers = (plan.blockers?.length ?? 0) > 0;
  const hasExternalChange = plan.blockers?.some((blocker) => blocker.startsWith('external_change'));
  const isBlockedByGame = isGameRunning;
  const isInvalidRoot = !activeInstallation.is_valid || activeInstallation.permission_state !== 'authorized';
  const isInsufficientSpace = activeInstallation.disk_available_bytes != null && plan.bytes_required > activeInstallation.disk_available_bytes;
  const isExpired = timeLeft <= 0;
  const hasOverwrites = plan.changes.some((c) => c.action === 'OVERWRITE') || Boolean(plan.risks?.some((r) => r.type === 'overwriting_external_file'));
  // 归档里有路径没被识别成 MAS 安装路径时，后端根本不写它们。这里如实列出，
  // 否则用户看到的是“安装成功”，磁盘上却少了一部分文件。
  const unsupportedRisks = (plan.risks || []).filter((r) => r.type === 'package_unsupported');
  const hasUnsupported = unsupportedRisks.length > 0;
  // 精灵包里 characters/*.gift 是“已解锁”标记，后端一律不安装。这里只做告知，
  // 不需要用户确认：忽略它们是设计行为，不是需要担责的选择。
  const ignoredGiftRisks = (plan.risks || []).filter((r) => r.type === 'package_ignored_gifts');
  const hasIgnoredGifts = ignoredGiftRisks.length > 0;

  const canConfirm =
    !hasDependencyBlockers &&
    !hasSemanticBlockers &&
    !hasBackendBlockers &&
    !isBlockedByGame &&
    !isInvalidRoot &&
    !isInsufficientSpace &&
    !isExpired &&
    (!hasOverwrites || overwriteConfirmed) &&
    (!hasUnsupported || unsupportedConfirmed) &&
    (!hasUninstallRemovals || uninstallConfirmed);

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'CREATE':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 font-mono">
            {t('planPreview.actionCreate')}
          </span>
        );
      case 'OVERWRITE':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60 font-mono">
            {t('planPreview.actionOverwrite')}
          </span>
        );
      case 'REMOVE':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800/60 font-mono">
            {t('planPreview.actionRemove')}
          </span>
        );
      case 'RESTORE':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-950/80 text-sky-300 border border-sky-800/60 font-mono">
            {t('planPreview.actionRestore')}
          </span>
        );
      case 'METADATA_ONLY':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700 font-mono">
            {t('planPreview.actionMetadata')}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <m.div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-xs select-none" variants={overlayVariants}>
      <div className="bg-neutral-900 border border-neutral-700/80 rounded-xl w-full max-w-4xl max-h-[92dvh] sm:max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-3 sm:p-4 border-b border-neutral-800 bg-neutral-900/90 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800/80 uppercase shrink-0">
                {t(`planPreview.kind.${plan.kind}`, {})}
              </span>
              <h2 className="text-sm sm:text-base font-bold text-neutral-100 break-words">
                {plan.mod_title} <span className="font-mono text-emerald-400">{plan.version_str}</span>
              </h2>
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-400 mt-1 font-mono flex-wrap">
              <span className="break-all">{t('planPreview.planID', { id: plan.plan_id })}</span>
              <span aria-hidden="true" className="hidden sm:inline">·</span>
              <span className={`flex items-center gap-1 ${isExpired ? 'text-rose-400 font-bold' : 'text-amber-400'}`}>
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span>{isExpired ? t('planPreview.expired') : t('planPreview.timeLeft', { time: formatSeconds(timeLeft) })}</span>
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 sm:p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors shrink-0"
            title={t('planPreview.closeTitle')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Storage and Target Summary */}
        <div className="px-4 py-2.5 bg-neutral-950/80 border-b border-neutral-800/80 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs shrink-0">
          <div>
            <span className="text-neutral-400 block text-[11px]">{t('planPreview.targetDir')}</span>
            <span className="text-neutral-200 font-medium truncate block" title={activeInstallation.path_hint}>
              {activeInstallation.label}
            </span>
          </div>

          <div>
            <span className="text-neutral-400 block text-[11px]">{t('planPreview.bytesRequired')}</span>
            <span className="font-mono text-neutral-200 tabular-nums">
              {formatBytes(plan.bytes_required)}
            </span>
          </div>

          <div>
            <span className="text-neutral-400 block text-[11px]">{t('planPreview.backupsRequired')}</span>
            <span className="font-mono text-neutral-200 tabular-nums">
              {t('planPreview.backupsValue', { count: plan.backups_required })}
            </span>
          </div>

          <div>
            <span className="text-neutral-400 block text-[11px]">{t('planPreview.diskFree')}</span>
            <span className="font-mono text-emerald-400 tabular-nums">
              {activeInstallation.disk_available_bytes != null
                ? `${(activeInstallation.disk_available_bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
                : t('planPreview.unknown')}
            </span>
          </div>
        </div>

        {/* Plan Summary Counters */}
        {plan.summary && (
          <div className="px-4 py-2 bg-neutral-950/90 border-b border-neutral-800/80 flex flex-wrap items-center gap-4 text-xs font-mono">
            <span className="text-sky-300">{t('planPreview.restoresOriginal', { count: plan.summary.restores_original })}</span>
            <span className="text-emerald-300">{t('planPreview.restoresLayer', { count: plan.summary.restores_layer })}</span>
            <span className="text-neutral-400">{t('planPreview.metadataOnly', { count: plan.summary.metadata_only })}</span>
            <span className="text-rose-300">{t('planPreview.deletesAdded', { count: plan.summary.deletes_added })}</span>
            <span className="text-amber-300">{t('planPreview.writesNew', { count: plan.summary.writes_new })}</span>
          </div>
        )}

        {/* Scrollable inspection area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* CRITICAL BLOCKERS */}
          {/* 1. Game Running Blocker */}
          {isGameRunning && (
            <div className="p-3.5 rounded-lg bg-amber-950/80 border border-amber-700/80 flex items-start gap-3 text-xs text-amber-200">
              <Lock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-amber-300">
                  {t('planPreview.gameRunningTitle')}
                </div>
                <div className="mt-1 leading-relaxed text-amber-200/90">
                  {t('planPreview.gameRunningBody1')} <code>game/</code>{' '}
                  {t('planPreview.gameRunningBody2')} <strong>{t('planPreview.gameRunningBodyStrong')}</strong>
                  {t('planPreview.gameRunningBody3')}
                </div>
              </div>
            </div>
          )}

          {/* 2. Backend Blocker */}
          {hasBackendBlockers && (
            <div className="p-3.5 rounded-lg bg-rose-950/80 border border-rose-800 flex items-start gap-3 text-xs text-rose-200">
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-rose-300">
                  {hasExternalChange ? t('planPreview.externalChangeTitle') : t('planPreview.planBlockedTitle')}
                </div>
                <div className="mt-1 space-y-1 font-mono">
                  {plan.blockers?.map((blk, idx) => (
                    <div key={idx} className="text-rose-200/90">• {blk}</div>
                  ))}
                  {hasExternalChange && <p>{t('planPreview.externalChangeHint')}</p>}
                </div>
                {hasExternalChange && onOpenRecovery && <button type="button" onClick={onOpenRecovery} className="mt-2 px-3 py-2 rounded bg-rose-900">{t('planPreview.checkUnfinished')}</button>}
              </div>
            </div>
          )}

          {/* 3. Dependency Missing Blocker */}
          {hasDependencyBlockers && (
            <div className="p-3.5 rounded-lg bg-rose-950/80 border border-rose-800 flex items-start gap-3 text-xs text-rose-200">
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-rose-300">
                  {t('planPreview.dependencyMissingTitle')}
                </div>
                <div className="mt-1 space-y-1 font-mono">
                  {plan.dependency_blockers.map((blk) => (
                    <div key={blk.mod_id} className="text-rose-200/90">
                      • {t('planPreview.dependencyMissingItem', { title: blk.mod_title, range: blk.required_range })} {blk.reason}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 4. Semantic Conflict Blocker */}
          {hasSemanticBlockers && (
            <div className="p-3.5 rounded-lg bg-rose-950/80 border border-rose-800 flex items-start gap-3 text-xs text-rose-200">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-rose-300">
                  {t('planPreview.semanticConflictTitle')}
                </div>
                <div className="mt-1 space-y-1 font-mono">
                  {plan.semantic_blockers.map((sc, idx) => (
                    <div key={idx} className="text-rose-200/90">
                      • {t('planPreview.semanticConflictA')} <code>{sc.identifier}</code> {t('planPreview.semanticConflictB')} <strong>{sc.conflicting_with}</strong> {t('planPreview.semanticConflictC')} {sc.details}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Spritepack Selection Summary */}
          {(plan.category === 'spritepack' || (plan.sprite_set_ids && plan.sprite_set_ids.length > 0) || Boolean(spriteCtx)) && (
            <div className="p-3.5 rounded-lg bg-emerald-950/40 border border-emerald-800/80 flex items-start gap-3 text-xs">
              <Sparkles className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <div className="font-semibold text-emerald-300">
                  {plan.kind === 'uninstall'
                    ? t('planPreview.uninstallSummaryTitle')
                    : t('planPreview.partialInstallSummaryTitle')}
                </div>
                <div className="text-neutral-300 leading-relaxed">
                  {plan.kind === 'uninstall' ? (
                    <>
                      {t('planPreview.uninstallSummaryA')}{' '}
                      <span className="font-semibold text-rose-400">
                        {spriteCtx?.unknown_legacy_selection
                          ? t('planPreview.unknownLegacyCount')
                          : (spriteCtx?.removed_ids?.length ?? spriteCtx?.baseline_ids?.length ?? 0)}
                      </span>{' '}
                      {t('planPreview.uninstallSummaryB')}{' '}
                      <span className="font-semibold text-neutral-100">{plan.changes.length}</span>{' '}
                      {t('planPreview.summaryFileChanges')}
                    </>
                  ) : (
                    <>
                      {t('planPreview.partialSummaryA')}{' '}
                      <span className="font-semibold text-emerald-400">
                        {plan.selected_sprite_set_count ?? plan.sprite_set_ids?.length ?? 0}
                      </span>{' '}
                      {t('planPreview.partialSummaryB')}{' '}
                      <span className="font-semibold text-neutral-100">{plan.changes.length}</span>{' '}
                      {t('planPreview.summaryFileChanges')}
                    </>
                  )}
                </div>
                {plan.sprite_set_ids && plan.sprite_set_ids.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] pt-1">
                    <span className="text-neutral-400">{t('planPreview.keptSetIds')}</span>
                    {plan.sprite_set_ids.map((id) => (
                      <span key={id} className="px-1.5 py-0.5 rounded bg-emerald-900/60 text-emerald-200 border border-emerald-700/60">
                        {id}
                      </span>
                    ))}
                  </div>
                )}
                {spriteCtx?.removed_ids && spriteCtx.removed_ids.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] pt-1">
                    <span className="text-rose-400">
                      {plan.kind === 'uninstall' ? t('planPreview.removedSetIds') : t('planPreview.removedOldSetIds')}
                    </span>
                    {spriteCtx.removed_ids.map((id) => (
                      <span key={id} className="px-1.5 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800/80">
                        {id}
                      </span>
                    ))}
                  </div>
                )}
                {spriteCtx?.unavailable_installed_ids && spriteCtx.unavailable_installed_ids.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] pt-1">
                    <span className="text-amber-400">{t('planPreview.unavailableSetIds')}</span>
                    {spriteCtx.unavailable_installed_ids.map((id) => (
                      <span key={id} className="px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/80">
                        {id}
                      </span>
                    ))}
                  </div>
                )}
                {plan.sprite_selection_hash && (
                  <div className="text-[11px] font-mono text-neutral-400">
                    {t('planPreview.selectionHash')}: <span className="text-neutral-300">{plan.sprite_selection_hash.slice(0, 16)}...</span>
                  </div>
                )}
                <div className="text-[11px] text-neutral-400 leading-normal pt-1">
                  {t('planPreview.spritepackNote')}
                </div>
              </div>
            </div>
          )}

          {/* Uninstall Removals Confirmation Checkbox */}
          {hasUninstallRemovals && (
            <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800/80 flex items-center justify-between text-xs text-rose-200">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>
                  {spriteCtx?.unknown_legacy_selection
                    ? (plan.kind === 'uninstall'
                        ? t('planPreview.legacyUninstallHint')
                        : t('planPreview.legacyPartialHint'))
                    : (plan.kind === 'uninstall'
                        ? t('planPreview.fullUninstallHint', { count: spriteCtx?.removed_ids?.length || 0 })
                        : t('planPreview.partialUninstallHint', { count: [...(spriteCtx?.removed_ids || []), ...(spriteCtx?.unavailable_installed_ids || [])].length }))}
                </span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer font-medium select-none text-rose-300 bg-rose-900/40 px-2.5 py-1 rounded border border-rose-700/60 hover:bg-rose-900/60 transition-colors">
                <input
                  type="checkbox"
                  checked={uninstallConfirmed}
                  onChange={(e) => setUninstallConfirmed(e.target.checked)}
                  className="rounded text-rose-500 focus:ring-rose-500 bg-neutral-900 border-neutral-700"
                />
                <span>
                  {plan.kind === 'uninstall'
                    ? (spriteCtx?.unknown_legacy_selection
                        ? t('planPreview.confirmLegacyUninstall')
                        : t('planPreview.confirmFullUninstall'))
                    : t('planPreview.confirmPartialUninstall')}
                </span>
              </label>
            </div>
          )}

          {/* Overwrite Confirmation Checkbox */}
          {hasOverwrites && (
            <div className="p-3 rounded-lg bg-amber-950/60 border border-amber-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-amber-200">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>{t('planPreview.overwriteHint')}</span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer font-medium select-none text-amber-300 bg-amber-900/40 px-2.5 py-1.5 rounded border border-amber-700/60 hover:bg-amber-900/60 transition-colors shrink-0 self-start sm:self-center">
                <input
                  type="checkbox"
                  checked={overwriteConfirmed}
                  onChange={(e) => setOverwriteConfirmed(e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-500 bg-neutral-900 border-neutral-700"
                />
                <span>{t('planPreview.confirmOverwrite')}</span>
              </label>
            </div>
          )}

          {/* Unsupported archive entries: the scanner drops them, so the user has
              to see that the package is not fully understood before confirming. */}
          {hasUnsupported && (
            <div className="p-3.5 rounded-lg bg-amber-950/60 border border-amber-800/80 flex flex-col gap-2.5 text-xs text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-semibold text-amber-300">
                    {t('planPreview.unsupportedTitle')}
                  </div>
                  <div className="font-mono text-amber-200/90 space-y-1">
                    {unsupportedRisks.map((r, idx) => <div key={idx}>• {r.description}</div>)}
                  </div>
                  <p className="text-amber-200/80 leading-relaxed">
                    {t('planPreview.unsupportedBodyA')}
                    <code className="mx-1">mod/</code>
                    <code className="mx-1">src/</code>
                    {t('planPreview.unsupportedBodyB')}
                  </p>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer font-medium select-none text-amber-300 bg-amber-900/40 px-2.5 py-1.5 rounded border border-amber-700/60 hover:bg-amber-900/60 transition-colors self-start">
                <input
                  type="checkbox"
                  checked={unsupportedConfirmed}
                  onChange={(e) => setUnsupportedConfirmed(e.target.checked)}
                  className="rounded text-amber-500 focus:ring-amber-500 bg-neutral-900 border-neutral-700"
                />
                <span>{t('planPreview.confirmUnsupported')}</span>
              </label>
            </div>
          )}

          {/* Ignored spritepack gift tokens: informational only, nothing to
              confirm — the installer never writes these paths. */}
          {hasIgnoredGifts && (
            <div className="p-3.5 rounded-lg bg-neutral-900/70 border border-neutral-700 flex items-start gap-3 text-xs">
              <AlertTriangle className="w-5 h-5 text-neutral-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold text-neutral-200">
                  {t('planPreview.ignoredGiftsTitle')}
                </div>
                <div className="font-mono text-neutral-400 space-y-1">
                  {ignoredGiftRisks.map((r, idx) => <div key={idx}>• {r.description}</div>)}
                </div>
                <p className="text-neutral-400 leading-relaxed">
                  {t('planPreview.ignoredGiftsBody')}
                </p>
              </div>
            </div>
          )}

          {/* Safe confirmation notice if ready */}
          {canConfirm && (
            <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/60 flex items-center gap-2.5 text-xs text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{t('planPreview.allChecksPassed')}</span>
            </div>
          )}

          {/* Generated compile caches kept out of the ledger */}
          {plan.derived_paths && plan.derived_paths.length > 0 && (
            <div className="p-3.5 rounded-lg bg-neutral-900/70 border border-neutral-700 flex items-start gap-3 text-xs">
              <FileCheck className="w-5 h-5 text-neutral-400 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <div className="font-semibold text-neutral-300">
                  {t('planPreview.derivedTitle', { count: plan.derived_paths.length })}
                </div>
                <p className="text-neutral-400 leading-relaxed">
                  {t('planPreview.derivedBody')}
                </p>
                <ul className="font-mono text-[11px] text-neutral-400 space-y-0.5 max-h-24 overflow-y-auto">
                  {plan.derived_paths.map((path) => (
                    <li key={path} className="break-all">• {path}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Generated Ren'Py / Python Cache Cleanup */}
          {plan.cleanup_paths && plan.cleanup_paths.length > 0 && (
            <div className="p-3.5 rounded-lg bg-sky-950/40 border border-sky-800/80 flex items-start gap-3 text-xs">
              <FileCheck className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <div className="font-semibold text-sky-300">
                  {t('planPreview.cleanupTitle', { count: plan.cleanup_paths.length })}
                </div>
                <p className="text-neutral-300 leading-relaxed">
                  {t('planPreview.cleanupBody')}
                </p>
                <ul className="font-mono text-[11px] text-neutral-300 space-y-0.5 max-h-32 overflow-y-auto">
                  {plan.cleanup_paths.map((path) => (
                    <li key={path} className="break-all">• {path}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Detailed File Changes List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-neutral-300">
              <span className="font-semibold">{t('planPreview.changeListTitle', { count: plan.changes.length })}</span>
              <span className="text-neutral-400 text-[11px]">
                {t('planPreview.changeListHint')}
              </span>
            </div>

            <div className="border border-neutral-800 rounded-lg overflow-x-auto font-mono text-xs">
              <table className="w-full text-left min-w-[560px]">
                <thead className="bg-neutral-950 text-neutral-400 text-[11px] border-b border-neutral-800">
                  <tr>
                    <th className="py-2 px-3">{t('planPreview.colAction')}</th>
                    <th className="py-2 px-3">{t('planPreview.colPath')}</th>
                    <th className="py-2 px-3">{t('planPreview.colOwner')}</th>
                    <th className="py-2 px-3">{t('planPreview.colBackup')}</th>
                    <th className="py-2 px-3">{t('planPreview.colReason')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/60 bg-neutral-900/40">
                  {plan.changes.map((c, i) => (
                    <tr key={i} className="hover:bg-neutral-800/30">
                      <td className="py-2 px-3 whitespace-nowrap">
                        {getActionBadge(c.action)}
                      </td>
                      <td className="py-2 px-3 text-neutral-200 truncate max-w-xs" title={c.target_path}>
                        {c.target_path}
                      </td>
                      <td className="py-2 px-3 text-neutral-400 text-[11px] whitespace-nowrap">
                        {c.previous_owner || t('planPreview.ownerNone')} <ArrowRight className="w-2.5 h-2.5 inline mx-0.5" /> {c.next_owner || t('planPreview.ownerRemoved')}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {c.backup_required ? (
                          <span className="text-emerald-400 text-[11px] flex items-center gap-1">
                            <FileCheck className="w-3.5 h-3.5" />
                            <span>{t('planPreview.backupNeeded')}</span>
                          </span>
                        ) : (
                          <span className="text-neutral-400 text-[11px]">{t('planPreview.backupNotNeeded')}</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-neutral-400 text-[11px] truncate max-w-[160px]" title={c.reason}>
                        {c.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-3 sm:p-4 border-t border-neutral-800 bg-neutral-900/95 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-neutral-400 break-words leading-relaxed min-w-0">
            {!canConfirm ? (
              <span className="text-rose-400 font-medium">
                {isGameRunning
                  ? t('planPreview.blockedGameRunning')
                  : isInvalidRoot
                  ? t('planPreview.blockedInvalidRoot')
                  : isInsufficientSpace
                  ? t('planPreview.blockedNoSpace')
                  : hasBackendBlockers
                  ? t('planPreview.blockedBackend', { blockers: plan.blockers?.join('; ') ?? '' })
                  : isExpired
                  ? t('planPreview.blockedExpired')
                  : hasOverwrites && !overwriteConfirmed
                  ? t('planPreview.blockedOverwrite')
                  : hasUnsupported && !unsupportedConfirmed
                  ? t('planPreview.blockedUnsupported')
                  : hasUninstallRemovals && !uninstallConfirmed
                  ? (plan.kind === 'uninstall'
                      ? t('planPreview.blockedUninstall')
                      : t('planPreview.blockedPartialUninstall'))
                  : t('planPreview.blockedOther')}
              </span>
            ) : (
              <span className="text-emerald-400 font-medium">
                {t('planPreview.readyToWrite')}
              </span>
            )}
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-2.5 shrink-0 w-full sm:w-auto">
            <button
              onClick={onClose}
              className="min-h-[44px] sm:min-h-0 px-4 py-2 text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700/80 rounded-lg transition-colors flex items-center justify-center cursor-pointer text-center"
            >
              {t('planPreview.discard')}
            </button>
            <button
              onClick={() => {
                if (canConfirm) {
                  onApplyPlan(plan.plan_id);
                }
              }}
              disabled={!canConfirm}
              className={`min-h-[44px] sm:min-h-0 px-5 py-2 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-2 shadow-sm text-center ${
                canConfirm
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
                  : 'bg-neutral-800 text-neutral-400 cursor-not-allowed border border-neutral-700/50'
              }`}
            >
              {!canConfirm && isGameRunning && <Lock className="w-3.5 h-3.5 shrink-0" />}
              <span className="truncate">{t('planPreview.applyPlan')}</span>
            </button>
          </div>
        </div>
      </div>
    </m.div>
  );
};
