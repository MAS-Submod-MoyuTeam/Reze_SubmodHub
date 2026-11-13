import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Loader2,
  FolderArchive,
  ArrowRight,
  X,
  Clock,
  HelpCircle,
} from 'lucide-react';
import type { ExecutionSession } from '../types/client';
import { useI18n } from '../i18n';

interface ExecutionProgressBarProps {
  session: ExecutionSession;
  onDismiss?: () => void;
  onViewInOperations?: () => void;
  onRecover?: (operationId: string) => void;
}

export const ExecutionProgressBar: React.FC<ExecutionProgressBarProps> = ({
  session,
  onDismiss,
  onViewInOperations,
  onRecover,
}) => {
  const { t } = useI18n();
  const op = session.operation;
  const isFinished = session.is_finished;
  const state = op.state;
  const phase = op.phase || state;
  const progress = op.progress || {
    stage: '',
    current_file: '',
    processed_files: 0,
    total_files: 0,
    bytes_processed: 0,
    total_bytes: 0,
    percent: 0,
  };
  const percent = progress.percent || 0;

  const isSuccess = state === 'committed' || phase === 'committed';
  const isNeedsManual = state === 'needs_manual_recovery' || phase === 'needs_manual_recovery';
  const isQueryFailed = state === 'query_failed' || phase === 'query_failed';
  const isFailed = isNeedsManual || state === 'rolled_back' || isQueryFailed || (!!session.error && !isSuccess);

  // Compute title
  // 卸载与安装是两条不同的动词路径，先取一次词再套模板，避免模板里再嵌三元。
  const verb = session.kind === 'uninstall' ? t('progress.uninstallVerb') : t('progress.installVerb');
  let actionTitle = t('progress.running', { action: verb, title: session.mod_title });
  if (isSuccess) {
    actionTitle = t('progress.succeeded', { action: verb, title: session.mod_title });
  } else if (isNeedsManual) {
    actionTitle = t('progress.needsManual', { title: session.mod_title });
  } else if (state === 'rolled_back') {
    actionTitle = t('progress.rolledBack', { title: session.mod_title });
  } else if (isQueryFailed) {
    actionTitle = t('progress.stateUnknown', { title: session.mod_title });
  } else if (session.error) {
    actionTitle = t('progress.failed', { title: session.mod_title });
  }

  // 阶段描述：后端只给稳定的阶段码（`progress.stage.*`），这里按当前语言翻译。
  // 注意「还没开始」这个状态也靠 code 判断，而不是比较界面上显示的文字——
  // 用文案当协议的话，一改文案逻辑就会静默失效。
  let stageDescription: string;
  if (isSuccess && session.communication_error) {
    stageDescription = t('progress.committedButCommsError', { error: session.communication_error });
  } else if (!progress.stage || progress.stage === 'progress.stage.initialized') {
    if (phase === 'planned') {
      stageDescription = t('progress.stagePlanned');
    } else if (phase === 'prepared') {
      stageDescription = t('progress.stagePrepared', { snapshot: op.backup_id || 'snapshot' });
    } else if (phase === 'committing') {
      stageDescription = t('progress.stageCommitting');
    } else if (isQueryFailed) {
      stageDescription = t('progress.stageQueryFailed');
    } else {
      stageDescription = t('progress.stageInitialized');
    }
  } else {
    // 后端给的阶段码直接查字典；万一是未知 code，translate 会回落成 code 本身，
    // 至少不会显示成空白，也便于发现前后端版本不一致。
    stageDescription = t(progress.stage, {
      processed: progress.processed_files,
      total: progress.total_files,
    });
  }

  // Status icon
  const renderIcon = () => {
    if (isSuccess) {
      return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
    }
    if (isNeedsManual) {
      return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 animate-bounce" />;
    }
    if (isQueryFailed) {
      return <HelpCircle className="w-4 h-4 text-amber-400 shrink-0" />;
    }
    if (state === 'rolled_back' || (!isSuccess && session.error)) {
      return <RotateCcw className="w-4 h-4 text-rose-400 shrink-0" />;
    }
    return <Loader2 className="w-4 h-4 text-sky-400 shrink-0 animate-spin" />;
  };

  // Progress bar styling
  let barColor = 'bg-emerald-500';
  if (isNeedsManual) {
    barColor = 'bg-amber-500';
  } else if (isQueryFailed) {
    barColor = 'bg-amber-500/80';
  } else if (state === 'rolled_back' || (!isSuccess && session.error)) {
    barColor = 'bg-rose-500';
  }

  const showIndeterminate = !isFinished && op.progress.total_files <= 0;
  const displayPercent = isSuccess ? 100 : showIndeterminate ? 25 : percent;

  return (
    <div
      role="status"
      aria-label={t('progress.ariaLabel')}
      className="shrink-0 border-b border-neutral-800 bg-neutral-900/95 px-4 py-2.5 text-xs text-neutral-200 backdrop-blur-xs"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          {renderIcon()}
          <span className="font-semibold text-neutral-100 truncate">{actionTitle}</span>
          <span className="text-neutral-400 text-[11px] truncate hidden md:inline">
            — {stageDescription}
          </span>
          {op.backup_id && (
            <span
              className="hidden lg:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700/60 text-[10px] text-neutral-300 font-mono"
              title={t('progress.snapshotTitle', { snapshot: op.backup_id })}
            >
              <FolderArchive className="w-3 h-3 text-neutral-400" />
              <span>{op.backup_id}</span>
            </span>
          )}
          {session.communication_error && (
            <span
              className="hidden lg:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-950/70 border border-amber-800/70 text-[10px] text-amber-300 font-sans"
              title={t('progress.commsErrorTitle', { error: session.communication_error })}
            >
              <span>{t('progress.commsErrorBadge', { state: isSuccess ? t('progress.committed') : t('progress.unknown') })}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0 text-[11px] self-end sm:self-auto font-mono">
          {op.progress.total_files > 0 ? (
            <span className="tabular-nums text-neutral-300">
              {t('progress.fileCounter', { percent, done: op.progress.processed_files, total: op.progress.total_files })}
            </span>
          ) : (
            <span className="text-neutral-400 font-sans">
              {isSuccess ? t('progress.phaseDone') : isQueryFailed ? t('progress.phaseUnknown') : isFinished ? t('progress.phaseAborted') : t('progress.phasePreparing')}
            </span>
          )}

          {/* Quick Action: View in operations */}
          {onViewInOperations && (
            <button
              onClick={onViewInOperations}
              className="text-neutral-400 hover:text-neutral-200 transition-colors flex items-center gap-1 font-sans text-xs underline underline-offset-2 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
              title={t('progress.viewLogTitle')}
            >
              <span>{t('progress.viewLog')}</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}

          {/* Quick Action: Recovery retry if manual recovery required */}
          {isNeedsManual && onRecover && op.can_rollback && (
            <button
              onClick={() => onRecover(session.operation_id)}
              className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-neutral-950 font-sans font-semibold transition-colors flex items-center gap-1 text-[11px] active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
              title={t('progress.rollbackTitle')}
            >
              <RotateCcw className="w-3 h-3" />
              <span>{t('progress.rollback')}</span>
            </button>
          )}

          {/* Dismiss button when finished */}
          {isFinished && onDismiss && (
            <button
              onClick={onDismiss}
              className="text-neutral-500 hover:text-neutral-300 transition-colors p-0.5 rounded active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
              title={t('progress.closeTitle')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Progress track */}
      <div
        className="h-1.5 overflow-hidden rounded bg-neutral-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={displayPercent}
      >
        <div
          className={`h-full ${barColor} transition-[width] duration-200 ${
            showIndeterminate ? 'animate-pulse' : ''
          }`}
          style={{ width: `${displayPercent}%` }}
        />
      </div>

      {/* Mobile / Narrow screen stage & current file hint */}
      {op.progress.current_file && !isFinished && (
        <div className="mt-1 text-[10px] text-neutral-400 truncate font-mono">
          {t('progress.writing', { file: op.progress.current_file })}
        </div>
      )}
    </div>
  );
};
