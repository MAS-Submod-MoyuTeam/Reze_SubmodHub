import React, { useState } from 'react';
import {
  History,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  FolderArchive,
  ShieldAlert,
  Copy,
  Check,
  Clock,
  Terminal,
  Loader2,
  HelpCircle,
} from 'lucide-react';
import { Operation } from '../types/client';

interface OperationsViewProps {
  operations: Operation[];
  onRecoverOperation: (opId: string) => void;
}

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

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

/** Recovery availability must not read as a fault on transactions that have
 *  already finished: a committed or rolled-back transaction legitimately has
 *  no rollback material left. */
function describeRecoveryAvailability(op: Operation): { label: string; tone: 'ready' | 'finished' | 'blocked' } {
  if (op.can_rollback) {
    return { label: '恢复材料可用：可安全回滚', tone: 'ready' };
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

export const OperationsView: React.FC<OperationsViewProps> = ({
  operations,
  onRecoverOperation,
}) => {
  const [copiedDiagnostics, setCopiedDiagnostics] = useState(false);
  const [logModalOp, setLogModalOp] = useState<Operation | null>(null);
  const recoveryAvailability = logModalOp ? describeRecoveryAvailability(logModalOp) : null;

  const handleCopyDiagnostics = async (op: Operation) => {
    const ok = await copyToClipboard(
      JSON.stringify({ exported_at: new Date().toISOString(), operation: op }, null, 2)
    );
    setCopiedDiagnostics(ok);
    if (ok) setTimeout(() => setCopiedDiagnostics(false), 2000);
  };

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const getStateBadge = (state: Operation['state']) => {
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
      case 'blocked':
        return (
          <span className="text-[11px] px-2 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800/60 font-mono flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>blocked (已阻断)</span>
          </span>
        );
      case 'rolled_back':
        return (
          <span className="text-[11px] px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 font-mono">
            rolled_back (已回滚)
          </span>
        );
      case 'writing':
        return (
          <span className="text-[11px] px-2 py-0.5 rounded bg-sky-950/80 text-sky-300 border border-sky-800/60 font-mono flex items-center gap-1 animate-pulse">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>writing (正在写入)</span>
          </span>
        );
      case 'backed_up':
        return (
          <span className="text-[11px] px-2 py-0.5 rounded bg-sky-950/80 text-sky-300 border border-sky-800/60 font-mono flex items-center gap-1">
            <FolderArchive className="w-3.5 h-3.5 text-sky-400" />
            <span>backed_up (快照就绪)</span>
          </span>
        );
      case 'planned':
        return (
          <span className="text-[11px] px-2 py-0.5 rounded bg-sky-950/80 text-sky-300 border border-sky-800/60 font-mono flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-sky-400" />
            <span>planned (就绪执行)</span>
          </span>
        );
      case 'unknown':
        return (
          <span className="text-[11px] px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700/60 font-mono flex items-center gap-1">
            <HelpCircle className="w-3.5 h-3.5 text-neutral-400" />
            <span>unknown (状态未知)</span>
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

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-950">
      {/* Top Header */}
      <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-neutral-100">
              客户端操作管线与原子恢复 (ListOperations & RecoverOperation)
            </h2>
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            未完成事务必须先检查诊断，再按恢复材料重新校验并安全回滚。普通已提交安装的文件漂移应使用“已安装 → 修复”；不需要强制回滚安装。恢复后旧计划失效，请重新预览。
          </p>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Operations History and Recovery List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span className="font-semibold text-neutral-300">
              本地操作日志与快照清单 ({operations.length} 条记录)
            </span>
            <span>权威状态源：客户端持久化 Ledger</span>
          </div>

          {/* Desktop Table View */}
          {/* Wide content (state badges stay nowrap) must scroll instead of being
              clipped: the previous `overflow-hidden` silently cut the trailing
              "恢复与管理" column, which made 详情 / 安全回滚 unreachable as soon
              as the window was narrower than the window's default 1280px. */}
          <div className="hidden md:block border border-neutral-800 rounded-xl overflow-x-auto bg-neutral-900">
            <table className="w-full text-left text-xs font-sans">
              <thead className="bg-neutral-950 text-neutral-400 text-[11px] border-b border-neutral-800 uppercase font-medium">
                <tr>
                  <th className="py-2.5 px-4">操作 ID / 模组</th>
                  <th className="py-2.5 px-3">类型</th>
                  <th className="py-2.5 px-3">当前状态</th>
                  <th className="py-2.5 px-3">进度 / 阶段</th>
                  <th className="py-2.5 px-3">备份快照 ID</th>
                  <th className="py-2.5 px-3">记录时间</th>
                  <th className="py-2.5 px-4 text-right sticky right-0 z-20 bg-neutral-950 border-l border-neutral-800/80 shadow-[-10px_0_12px_-12px_rgba(0,0,0,0.9)]">
                    恢复与管理
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60 font-mono">
                {operations.map((op) => (
                  <tr key={op.operation_id} className="group hover:bg-neutral-800/30 transition-colors">
                    {/* ID and Mod */}
                    <td className="py-3 px-4">
                      <div className="font-semibold text-neutral-200 font-sans">{op.mod_title}</div>
                      <div className="text-[11px] text-neutral-400 truncate max-w-[180px]">
                        {op.operation_id}
                      </div>
                    </td>

                    {/* Kind */}
                    <td className="py-3 px-3 uppercase text-neutral-300 text-[11px]">
                      {op.kind}
                    </td>

                    {/* State */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      {getStateBadge(op.state)}
                    </td>

                    {/* Progress */}
                    <td className="py-3 px-3 text-[11px]">
                      <div className="text-neutral-300 font-sans truncate max-w-[200px]" title={op.progress?.stage || ''}>
                        {op.progress?.stage || '无进度信息'}
                      </div>
                      <div className="text-neutral-400 mt-0.5">
                        {op.progress?.processed_files ?? 0} / {op.progress?.total_files ?? 0} 文件 ({op.progress?.percent ?? 0}%)
                      </div>
                      {op.progress?.current_file && (
                        <div className="text-[10px] text-neutral-500 font-mono truncate max-w-[200px] mt-0.5" title={op.progress.current_file}>
                          {op.progress.current_file}
                        </div>
                      )}
                    </td>

                    {/* Backup ID */}
                    <td className="py-3 px-3 text-[11px] text-neutral-400 truncate max-w-[140px]">
                      {op.backup_id ? (
                        <span className="text-neutral-300 font-mono flex items-center gap-1" title={op.backup_id}>
                          <FolderArchive className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                          <span className="truncate">{op.backup_id}</span>
                        </span>
                      ) : (
                        '无'
                      )}
                    </td>

                    {/* Created at */}
                    <td className="py-3 px-3 text-[11px] text-neutral-400 whitespace-nowrap">
                      {new Date(op.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>

                    {/* Actions — pinned to the right edge so 详情 / 回滚 remain
                        visible while the wide columns scroll underneath. */}
                    <td className="py-3 px-4 text-right font-sans sticky right-0 z-10 bg-neutral-900 group-hover:bg-neutral-800/40 border-l border-neutral-800/80 shadow-[-10px_0_12px_-12px_rgba(0,0,0,0.9)]">
                      <div className="flex items-center justify-end gap-1.5">
                        {op.state === 'needs_manual_recovery' ? (
                          <>
                            {op.can_rollback ? (
                              <button
                                onClick={() => onRecoverOperation(op.operation_id)}
                                className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-500 hover:bg-amber-400 text-neutral-950 transition-colors shadow-xs flex items-center gap-1 cursor-pointer"
                                title="重新校验磁盘冲突；若人工处理已恢复则安全回滚，未解决则由后端防护阻断"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>重新校验并安全回滚</span>
                              </button>
                            ) : (
                              <span
                                className="px-2 py-1 text-xs text-rose-400 bg-rose-950/60 rounded border border-rose-800/80 font-mono"
                                title={op.error?.message || '日志或恢复材料损坏，无法自动回滚'}
                              >
                                恢复材料损坏
                              </span>
                            )}
                          </>
                        ) : (
                          (op.can_rollback || op.state === 'recoverable') && (
                            <button
                              onClick={() => onRecoverOperation(op.operation_id)}
                              className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-500 hover:bg-amber-400 text-neutral-950 transition-colors shadow-xs flex items-center gap-1 cursor-pointer"
                              title="安全回滚未完成事务到操作前状态"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>安全回滚</span>
                            </button>
                          )
                        )}

                        <button
                          onClick={() => setLogModalOp(op)}
                          className="px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors cursor-pointer"
                        >
                          详情
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {operations.map((op) => (
              <div
                key={op.operation_id}
                className="p-3.5 rounded-xl border border-neutral-800 bg-neutral-900/60 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-neutral-100 text-sm">{op.mod_title}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-neutral-800 uppercase text-neutral-300 font-mono">
                        {op.kind}
                      </span>
                    </div>
                    <div className="text-[11px] text-neutral-400 font-mono break-all mt-0.5">
                      {op.operation_id}
                    </div>
                  </div>
                  <span className="text-[11px] text-neutral-400 font-mono shrink-0">
                    {new Date(op.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  {getStateBadge(op.state)}
                  {op.backup_id && (
                    <span className="text-[11px] text-neutral-400 font-mono flex items-center gap-1 truncate max-w-[180px]" title={op.backup_id}>
                      <FolderArchive className="w-3 h-3 shrink-0" />
                      <span className="truncate">{op.backup_id}</span>
                    </span>
                  )}
                </div>

                <div className="p-2.5 bg-neutral-950/70 rounded-lg border border-neutral-800/80 text-[11px] space-y-1">
                  <div className="text-neutral-300 font-sans">{op.progress?.stage || '无进度信息'}</div>
                  <div className="text-neutral-400 font-mono">
                    {op.progress?.processed_files ?? 0} / {op.progress?.total_files ?? 0} 文件 ({op.progress?.percent ?? 0}%)
                  </div>
                  {op.progress?.current_file && (
                    <div className="text-[10px] text-neutral-500 font-mono truncate" title={op.progress.current_file}>
                      {op.progress.current_file}
                    </div>
                  )}
                  {op.error?.message && (
                    <div className="text-rose-400 font-sans break-words pt-1">
                      {op.error.message}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 justify-end pt-0.5">
                  {op.state === 'needs_manual_recovery' ? (
                    <>
                      {op.can_rollback ? (
                        <button
                          onClick={() => onRecoverOperation(op.operation_id)}
                          className="px-3 py-1.5 text-xs font-semibold rounded bg-amber-500 hover:bg-amber-400 text-neutral-950 transition-colors shadow-xs flex items-center gap-1 cursor-pointer"
                          title="重新校验磁盘冲突；若人工处理已恢复则安全回滚，未解决则由后端防护阻断"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>重新校验并安全回滚</span>
                        </button>
                      ) : (
                        <span
                          className="px-2.5 py-1 text-xs text-rose-400 bg-rose-950/60 rounded border border-rose-800/80 font-mono"
                          title={op.error?.message || '日志或恢复材料损坏，无法自动回滚'}
                        >
                          恢复材料损坏
                        </span>
                      )}
                    </>
                  ) : (
                    (op.can_rollback || op.state === 'recoverable') && (
                      <button
                        onClick={() => onRecoverOperation(op.operation_id)}
                        className="px-3 py-1.5 text-xs font-semibold rounded bg-amber-500 hover:bg-amber-400 text-neutral-950 transition-colors shadow-xs flex items-center gap-1 cursor-pointer"
                        title="安全回滚未完成事务到操作前状态"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>安全回滚</span>
                      </button>
                    )
                  )}

                  <button
                    onClick={() => setLogModalOp(op)}
                    className="px-3 py-1.5 text-xs text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer"
                  >
                    详情
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Transaction Detail Modal — carries the diagnostics that the removed
          "导出诊断日志" button used to promise: every backend field of the
          operation, plus a copyable raw JSON payload. */}
      {logModalOp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-xs select-none">
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between gap-3 bg-neutral-950">
              <div className="flex min-w-0 items-center gap-2">
                <Terminal className="w-4 h-4 shrink-0 text-emerald-400" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-neutral-100">
                    {logModalOp.mod_title}
                  </div>
                  <div className="truncate font-mono text-[11px] text-neutral-400">
                    事务详情与诊断 · {logModalOp.operation_id}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => void handleCopyDiagnostics(logModalOp)}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-neutral-800 hover:bg-neutral-700/80 border border-neutral-700/60 text-neutral-200 transition-colors flex items-center gap-1.5"
                  title="复制整份诊断信息（JSON），用于反馈问题"
                >
                  {copiedDiagnostics ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-neutral-400" />
                  )}
                  <span>{copiedDiagnostics ? '已复制' : '复制诊断信息'}</span>
                </button>
                <button
                  onClick={() => setLogModalOp(null)}
                  className="text-neutral-400 hover:text-white"
                  aria-label="关闭事务详情"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-4 bg-neutral-950/90 text-xs overflow-y-auto flex-1 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {getStateBadge(logModalOp.state)}
                <span className="px-1.5 py-0.5 rounded bg-neutral-800 uppercase text-[10px] text-neutral-300 font-mono">
                  {logModalOp.kind}
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                    recoveryAvailability?.tone === 'ready'
                      ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                      : recoveryAvailability?.tone === 'blocked'
                        ? 'bg-rose-950/60 text-rose-300 border-rose-800/60'
                        : 'bg-neutral-800/80 text-neutral-400 border-neutral-700/60'
                  }`}
                >
                  {recoveryAvailability?.label}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-neutral-900/60 border border-neutral-800">
                <DetailField label="操作 ID">{logModalOp.operation_id}</DetailField>
                <DetailField label="安装实例">{logModalOp.installation_id}</DetailField>
                <DetailField label="模组" mono={false}>
                  {logModalOp.mod_title}
                  <span className="text-neutral-500 font-mono"> ({logModalOp.mod_id})</span>
                </DetailField>
                <DetailField label="版本">
                  {logModalOp.version_str}
                  {logModalOp.version_id ? <span className="text-neutral-500"> ({logModalOp.version_id})</span> : null}
                </DetailField>
                <DetailField label="事务阶段 phase">{logModalOp.phase || logModalOp.state}</DetailField>
                <DetailField label="状态机 state">{logModalOp.state}</DetailField>
                <DetailField label="创建时间">{formatTimestamp(logModalOp.created_at)}</DetailField>
                <DetailField label="最近更新">{formatTimestamp(logModalOp.updated_at)}</DetailField>
              </div>

              <div className="p-3 rounded-lg bg-neutral-900/60 border border-neutral-800 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans font-semibold text-neutral-300">执行进度</span>
                  <span className="font-mono text-[11px] text-neutral-400">
                    {logModalOp.progress.processed_files} / {logModalOp.progress.total_files} 文件 · {logModalOp.progress.percent}%
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, logModalOp.progress.percent))}%` }}
                  />
                </div>
                <div className="font-sans text-neutral-300">{logModalOp.progress.stage}</div>
                <div className="font-mono text-[11px] text-neutral-400">
                  字节 {formatBytes(logModalOp.progress.bytes_processed)} / {formatBytes(logModalOp.progress.total_bytes)}
                </div>
                {logModalOp.progress.current_file && (
                  <div className="font-mono text-[11px] text-neutral-500 break-all">
                    最后处理路径: {logModalOp.progress.current_file}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-neutral-900/60 border border-neutral-800">
                <DetailField label="备份快照 ID">{logModalOp.backup_id || '无'}</DetailField>
                <DetailField label="可回滚 can_rollback">{String(Boolean(logModalOp.can_rollback))}</DetailField>
                {logModalOp.conflict_path && (
                  <DetailField label="冲突文件路径">
                    <span className="text-amber-300">{logModalOp.conflict_path}</span>
                  </DetailField>
                )}
                {logModalOp.expected_hash && (
                  <DetailField label="Ledger 期望 SHA-256">
                    <span className="text-emerald-400">{logModalOp.expected_hash}</span>
                  </DetailField>
                )}
                {logModalOp.actual_hash && (
                  <DetailField label="磁盘实测 SHA-256">
                    <span className="text-amber-400">{logModalOp.actual_hash}</span>
                  </DetailField>
                )}
              </div>

              {logModalOp.error && (
                <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 space-y-1">
                  <div className="font-mono font-semibold">[错误代号] {logModalOp.error.code}</div>
                  <div className="font-sans">[错误详情] {logModalOp.error.message}</div>
                  {logModalOp.error.details && Object.keys(logModalOp.error.details).length > 0 && (
                    <pre className="pt-1 font-mono text-[11px] whitespace-pre-wrap break-all text-rose-200/80">
                      {JSON.stringify(logModalOp.error.details, null, 2)}
                    </pre>
                  )}
                </div>
              )}

              {logModalOp.state === 'needs_manual_recovery' && (
                <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-lg text-amber-200 text-[11px] leading-relaxed font-sans">
                  提示：系统已进入保护性挂起状态。为防止破坏玩家可能手工编辑的文件，请先备份上述冲突文件。若已人工解决外部冲突或还原文件，可点击下方“重新校验并安全回滚”。
                </div>
              )}

              <details className="rounded-lg bg-neutral-900/60 border border-neutral-800">
                <summary className="px-3 py-2 text-[11px] font-sans text-neutral-400 cursor-pointer select-none">
                  原始诊断数据（JSON，与“复制诊断信息”内容一致）
                </summary>
                <pre className="max-h-64 overflow-auto px-3 py-2 border-t border-neutral-800 font-mono text-[11px] leading-relaxed text-neutral-300">
                  {JSON.stringify(logModalOp, null, 2)}
                </pre>
              </details>
            </div>

            <div className="p-3 border-t border-neutral-800 bg-neutral-900 flex justify-end gap-2">
              {logModalOp.can_rollback && (
                <button
                  onClick={() => {
                    const id = logModalOp.operation_id;
                    setLogModalOp(null);
                    onRecoverOperation(id);
                  }}
                  className="px-3 py-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-neutral-950 font-semibold rounded-lg flex items-center gap-1 transition-colors"
                  title={logModalOp.state === 'needs_manual_recovery' ? '重新校验磁盘冲突并尝试安全回滚' : '安全回滚'}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{logModalOp.state === 'needs_manual_recovery' ? '重新校验并安全回滚' : '安全回滚'}</span>
                </button>
              )}
              <button
                onClick={() => setLogModalOp(null)}
                className="px-4 py-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
