import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  HelpCircle,
  RotateCcw,
  Terminal,
} from 'lucide-react';
import { Operation } from '../types/client';

/** Copies text to the clipboard, falling back to a hidden textarea when the
 *  async Clipboard API is unavailable (older WebView2 / non-secure origins). */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

/** Single payload for both the copy button and the JSON disclosure, so the two
 *  can never drift apart. */
export function buildDiagnostics(op: Operation): string {
  return JSON.stringify({ exported_at: new Date().toISOString(), operation: op }, null, 2);
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

/** Recovery availability must not read as a fault on transactions that have
 *  already finished: a committed or rolled-back transaction legitimately has
 *  no rollback material left. A `query_failed` transaction is not a fault
 *  either — we simply do not know, so it must not claim material is missing. */
export function describeRecoveryAvailability(op: Operation): {
  label: string;
  tone: 'ready' | 'finished' | 'blocked' | 'unknown';
} {
  if (op.can_rollback) {
    return { label: '恢复材料可用：可安全回滚', tone: 'ready' };
  }
  if (op.state === 'query_failed') {
    return { label: '结果未知：后端状态查询失败', tone: 'unknown' };
  }
  if (op.state === 'committed') {
    return { label: '事务已提交：无回滚材料', tone: 'finished' };
  }
  if (op.state === 'rolled_back') {
    return { label: '事务已回滚：无待处理变更', tone: 'finished' };
  }
  return { label: '恢复材料缺失：需人工处理', tone: 'blocked' };
}

/** One labelled diagnostic field inside the transaction detail panel. */
const DetailField: React.FC<{ label: string; mono?: boolean; children: React.ReactNode }> = ({
  label,
  mono = true,
  children,
}) => (
  <div className="min-w-0 space-y-0.5">
    <div className="text-[10px] font-sans uppercase tracking-wider text-neutral-500">{label}</div>
    <div className={`break-all text-neutral-200 ${mono ? 'font-mono' : 'font-sans'}`}>{children}</div>
  </div>
);

/** 只认识后端真实产出的事务状态，外加客户端本地哨兵 `query_failed`。
 *  downloading / scanning / backed_up / writing / blocked / unknown 这些曾被
 *  后端短暂或从未产出的状态已退役；后端若出现未预期状态，default 分支原样显示，
 *  不伪造“正在写入/已阻断”这类语义。 */
export const StateBadge: React.FC<{ state: Operation['state'] }> = ({ state }) => {
  switch (state) {
    case 'committed':
      return (
        <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 font-mono flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>committed (已完成)</span>
        </span>
      );
    case 'recoverable':
      return (
        <span className="text-[11px] px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60 font-mono flex items-center gap-1 animate-pulse">
          <RotateCcw className="w-3.5 h-3.5" />
          <span>recoverable (待回滚)</span>
        </span>
      );
    case 'needs_manual_recovery':
      return (
        <span className="text-[11px] px-2 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800/60 font-mono flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span>needs_manual_recovery (需人工处理)</span>
        </span>
      );
    case 'rolled_back':
      return (
        <span className="text-[11px] px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 font-mono">
          rolled_back (已回滚)
        </span>
      );
    case 'planned':
      return (
        <span className="text-[11px] px-2 py-0.5 rounded bg-sky-950/80 text-sky-300 border border-sky-800/60 font-mono flex items-center gap-1">
          <Clock className="w-3.5 h-3.5 text-sky-400" />
          <span>planned (就绪执行)</span>
        </span>
      );
    case 'query_failed':
      return (
        <span className="text-[11px] px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700/60 font-mono flex items-center gap-1">
          <HelpCircle className="w-3.5 h-3.5 text-neutral-400" />
          <span>query_failed (结果未知)</span>
        </span>
      );
    default:
      return (
        <span className="text-[11px] px-2 py-0.5 rounded bg-sky-950 text-sky-300 font-mono">
          {state}
        </span>
      );
  }
};

interface TransactionDetailModalProps {
  op: Operation;
  onClose: () => void;
  onRecoverOperation: (opId: string) => void;
}

/** Transaction Detail Modal — carries the diagnostics that the removed
 *  "导出诊断日志" button used to promise: every backend field of the operation,
 *  plus a copyable raw JSON payload. It renders only fields the backend actually
 *  populates; anything the client cannot fill is left out instead of shown as a
 *  zero/placeholder value. */
export const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({
  op,
  onClose,
  onRecoverOperation,
}) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimer = useRef<number | null>(null);
  const recoveryAvailability = describeRecoveryAvailability(op);
  // One payload for the disclosure and the copy button: no chance of the shown
  // JSON and the copied JSON diverging.
  const diagnostics = useMemo(() => buildDiagnostics(op), [op]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    };
  }, [onClose]);

  const handleCopyDiagnostics = async () => {
    const ok = await copyToClipboard(diagnostics);
    setCopyState(ok ? 'copied' : 'failed');
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopyState('idle'), 2400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="事务详情与诊断"
        className="bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden shadow-2xl"
      >
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between gap-3 bg-neutral-950">
          <div className="flex min-w-0 items-center gap-2">
            <Terminal className="w-4 h-4 shrink-0 text-emerald-400" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-neutral-100">{op.mod_title}</div>
              <div className="truncate font-mono text-[11px] text-neutral-400">
                事务详情与诊断 · {op.operation_id}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => void handleCopyDiagnostics()}
              className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-1.5 ${
                copyState === 'failed'
                  ? 'bg-rose-950/60 border-rose-800/70 text-rose-200 hover:bg-rose-900/60'
                  : 'bg-neutral-800 hover:bg-neutral-700/80 border-neutral-700/60 text-neutral-200'
              }`}
              title="复制整份诊断信息（JSON），用于反馈问题"
            >
              {copyState === 'copied' ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-neutral-400" />
              )}
              <span>
                {copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制诊断信息'}
              </span>
            </button>
            <button
              onClick={onClose}
              className="text-neutral-400 hover:text-white"
              aria-label="关闭事务详情"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-4 bg-neutral-950/90 text-xs overflow-y-auto flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StateBadge state={op.state} />
            <span className="px-1.5 py-0.5 rounded bg-neutral-800 uppercase text-[10px] text-neutral-300 font-mono">
              {op.kind}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                recoveryAvailability.tone === 'ready'
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                  : recoveryAvailability.tone === 'blocked'
                    ? 'bg-rose-950/60 text-rose-300 border-rose-800/60'
                    : 'bg-neutral-800/80 text-neutral-400 border-neutral-700/60'
              }`}
            >
              {recoveryAvailability.label}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-neutral-900/60 border border-neutral-800">
            <DetailField label="操作 ID">{op.operation_id}</DetailField>
            <DetailField label="安装实例">{op.installation_id}</DetailField>
            <DetailField label="模组" mono={false}>
              {op.mod_title}
              <span className="text-neutral-500 font-mono"> ({op.mod_id})</span>
            </DetailField>
            <DetailField label="版本">
              {op.version_str}
              {op.version_id ? <span className="text-neutral-500"> ({op.version_id})</span> : null}
            </DetailField>
            <DetailField label="事务阶段 phase">{op.phase || op.state}</DetailField>
            <DetailField label="状态机 state">{op.state}</DetailField>
            <DetailField label="创建时间">{formatTimestamp(op.created_at)}</DetailField>
            <DetailField label="最近更新">{formatTimestamp(op.updated_at)}</DetailField>
          </div>

          <div className="p-3 rounded-lg bg-neutral-900/60 border border-neutral-800 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-sans font-semibold text-neutral-300">执行进度</span>
              <span className="font-mono text-[11px] text-neutral-400">
                {op.progress.processed_files} / {op.progress.total_files} 文件 · {op.progress.percent}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${Math.min(100, Math.max(0, op.progress.percent))}%` }}
              />
            </div>
            <div className="font-sans text-neutral-300">{op.progress.stage}</div>
            {op.progress.current_file && (
              <div className="font-mono text-[11px] text-neutral-500 break-all">
                最后处理路径: {op.progress.current_file}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-neutral-900/60 border border-neutral-800">
            <DetailField label="备份快照 ID">{op.backup_id || '无'}</DetailField>
            <DetailField label="可回滚 can_rollback">{String(Boolean(op.can_rollback))}</DetailField>
            {op.conflict_path && (
              <DetailField label="冲突文件路径">
                <span className="text-amber-300">{op.conflict_path}</span>
              </DetailField>
            )}
            {op.expected_hash && (
              <DetailField label="Ledger 期望 SHA-256">
                <span className="text-emerald-400">{op.expected_hash}</span>
              </DetailField>
            )}
            {op.actual_hash && (
              <DetailField label="磁盘实测 SHA-256">
                <span className="text-amber-400">{op.actual_hash}</span>
              </DetailField>
            )}
          </div>

          {op.error && (
            <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 space-y-1">
              <div className="font-mono font-semibold">[错误代号] {op.error.code}</div>
              <div className="font-sans">[错误详情] {op.error.message}</div>
              {op.error.details && Object.keys(op.error.details).length > 0 && (
                <pre className="pt-1 font-mono text-[11px] whitespace-pre-wrap break-all text-rose-200/80">
                  {JSON.stringify(op.error.details, null, 2)}
                </pre>
              )}
            </div>
          )}

          {op.state === 'needs_manual_recovery' && (
            <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-lg text-amber-200 text-[11px] leading-relaxed font-sans">
              提示：系统已进入保护性挂起状态。为防止破坏玩家可能手工编辑的文件，请先备份上述冲突文件。若已人工解决外部冲突或还原文件，可点击下方“重新校验并安全回滚”。
            </div>
          )}

          <details className="rounded-lg bg-neutral-900/60 border border-neutral-800">
            <summary className="px-3 py-2 text-[11px] font-sans text-neutral-400 cursor-pointer select-none">
              原始诊断数据（与“复制诊断信息”同一份载荷）
            </summary>
            <pre className="max-h-64 overflow-auto px-3 py-2 border-t border-neutral-800 font-mono text-[11px] leading-relaxed text-neutral-300">
              {diagnostics}
            </pre>
          </details>
        </div>

        <div className="p-3 border-t border-neutral-800 bg-neutral-900 flex justify-end gap-2">
          {op.can_rollback && (
            <button
              onClick={() => {
                onClose();
                onRecoverOperation(op.operation_id);
              }}
              className="px-3 py-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-neutral-950 font-semibold rounded-lg flex items-center gap-1 transition-colors"
              title={op.state === 'needs_manual_recovery' ? '重新校验磁盘冲突并尝试安全回滚' : '安全回滚'}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{op.state === 'needs_manual_recovery' ? '重新校验并安全回滚' : '安全回滚'}</span>
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
