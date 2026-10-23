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
  let actionTitle = `正在执行${session.kind === 'uninstall' ? '卸载' : '安装'}：${session.mod_title}`;
  if (isSuccess) {
    actionTitle = `${session.kind === 'uninstall' ? '卸载' : '安装'}成功：${session.mod_title}`;
  } else if (isNeedsManual) {
    actionTitle = `需人工恢复：${session.mod_title}`;
  } else if (state === 'rolled_back') {
    actionTitle = `操作已安全回滚：${session.mod_title}`;
  } else if (isQueryFailed) {
    actionTitle = `状态未知（查询失败）：${session.mod_title}`;
  } else if (session.error) {
    actionTitle = `执行失败：${session.mod_title}`;
  }

  // Compute description text
  let stageDescription = progress.stage;
  if (isSuccess && session.communication_error) {
    stageDescription = `事务已提交，但客户端通信异常：${session.communication_error}`;
  } else if (!stageDescription || stageDescription === '操作已初始化') {
    if (phase === 'planned') {
      stageDescription = '计划已确认，正在初始化写入事务...';
    } else if (phase === 'prepared') {
      stageDescription = `快照就绪 (${op.backup_id || 'snapshot'})，准备原子写入...`;
    } else if (phase === 'committing') {
      stageDescription = '正在提交清单与持久化记录...';
    } else if (isQueryFailed) {
      stageDescription = '后端状态查询失败，无法确认事务是否已提交';
    }
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
      aria-label="执行写入进度"
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
              title={`对应保护快照标识: ${op.backup_id}`}
            >
              <FolderArchive className="w-3 h-3 text-neutral-400" />
              <span>{op.backup_id}</span>
            </span>
          )}
          {session.communication_error && (
            <span
              className="hidden lg:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-950/70 border border-amber-800/70 text-[10px] text-amber-300 font-sans"
              title={`通信响应异常: ${session.communication_error}`}
            >
              <span>通信异常 ({isSuccess ? '后端已提交' : '状态未知'})</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0 text-[11px] self-end sm:self-auto font-mono">
          {op.progress.total_files > 0 ? (
            <span className="tabular-nums text-neutral-300">
              {percent}% · {op.progress.processed_files} / {op.progress.total_files} 文件
            </span>
          ) : (
            <span className="text-neutral-400 font-sans">
              {isSuccess ? '全部完成' : isQueryFailed ? '结果未知' : isFinished ? '事务终止' : '准备写入'}
            </span>
          )}

          {/* Quick Action: View in operations */}
          {onViewInOperations && (
            <button
              onClick={onViewInOperations}
              className="text-neutral-400 hover:text-neutral-200 transition-colors flex items-center gap-1 font-sans text-xs underline underline-offset-2"
              title="前往本地操作日志查看详情与快照"
            >
              <span>查看日志</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          )}

          {/* Quick Action: Recovery retry if manual recovery required */}
          {isNeedsManual && onRecover && op.can_rollback && (
            <button
              onClick={() => onRecover(session.operation_id)}
              className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-neutral-950 font-sans font-semibold transition-colors flex items-center gap-1 text-[11px]"
              title="重新校验并安全回滚"
            >
              <RotateCcw className="w-3 h-3" />
              <span>安全回滚</span>
            </button>
          )}

          {/* Dismiss button when finished */}
          {isFinished && onDismiss && (
            <button
              onClick={onDismiss}
              className="text-neutral-500 hover:text-neutral-300 transition-colors p-0.5 rounded"
              title="关闭进度横条"
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
          写入中: {op.progress.current_file}
        </div>
      )}
    </div>
  );
};
