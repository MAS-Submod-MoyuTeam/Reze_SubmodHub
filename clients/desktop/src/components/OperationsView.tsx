import React, { useState } from 'react';
import {
  History,
  FileCode2,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  FileCheck,
  Download,
  FolderArchive,
  ArrowRight,
  ShieldAlert,
  Copy,
  Check,
  PauseCircle,
  PlayCircle,
  Clock,
  Terminal,
  Loader2,
} from 'lucide-react';
import { Operation, ExternalChangeDrift } from '../types/client';

interface OperationsViewProps {
  operations: Operation[];
  externalDrift: ExternalChangeDrift | null;
  onRecoverOperation: (opId: string) => void;
  onRestoreBackup?: (opId: string, backupId?: string) => void;
  onResolveDrift: (driftId: string, action: 'keep_local' | 'overwrite_with_backup') => void;
  onExportLogs: (opId?: string) => void;
}

export const OperationsView: React.FC<OperationsViewProps> = ({
  operations,
  externalDrift,
  onRecoverOperation,
  onRestoreBackup,
  onResolveDrift,
  onExportLogs,
}) => {
  const [copiedExpected, setCopiedExpected] = useState(false);
  const [copiedActual, setCopiedActual] = useState(false);
  const [logModalOp, setLogModalOp] = useState<Operation | null>(null);

  const pipelineStages = [
    { key: 'planned', label: '规划就绪' },
    { key: 'downloading', label: '下载归档' },
    { key: 'scanning', label: '静态安全验签' },
    { key: 'backed_up', label: '暂存原文件快照' },
    { key: 'writing', label: '原子写入目标' },
    { key: 'committed', label: '提交持久化' },
  ];

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
            严格按照规范第4章与第5章状态机管理。任何中断、哈希漂移或客户端重启均可通过 <code>operation_id</code> 权威恢复或安全回滚。
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => onExportLogs()}
            className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700/80 border border-neutral-700/60 text-neutral-200 transition-colors flex items-center gap-1.5"
          >
            <Terminal className="w-3.5 h-3.5 text-neutral-400" />
            <span>导出诊断日志 (ExportLogs)</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* CRITICAL CONTRACT SCENARIO: External Hash Drift Detection (Section 1, 5) */}
        {externalDrift && externalDrift.status === 'paused' && (
          <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-700/80 space-y-3 animate-in fade-in duration-200">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                <div>
                  <h3 className="text-xs font-bold text-amber-300">
                    安全暂停：检测到外部文件哈希漂移 [external_change]
                  </h3>
                  <p className="text-xs text-amber-200/90 mt-0.5">
                    契约规范要求：目标文件已被外部程序（如玩家手工修改、外部编辑器或非托管脚本）变更。
                    <strong>SubmodHub 客户端严禁自动覆盖用户文件</strong>，当前写入操作已自动暂停挂起。
                  </p>
                </div>
              </div>

              <span className="text-[11px] px-2 py-0.5 rounded bg-amber-900/60 text-amber-300 font-mono shrink-0">
                保护性暂停
              </span>
            </div>

            {/* Path and Expected vs Actual Hashes */}
            <div className="p-3 bg-neutral-950/80 rounded-lg border border-neutral-800 font-mono text-xs space-y-2">
              <div>
                <span className="text-neutral-400">发生漂移的本地文件相对路径:</span>
                <div className="text-neutral-200 font-semibold mt-0.5">{externalDrift.path}</div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-neutral-800/80 text-[11px]">
                {/* Expected Hash */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-neutral-400">
                    <span>SubmodHub Ledger 记录的预期 SHA-256:</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(externalDrift.expected_hash);
                        setCopiedExpected(true);
                        setTimeout(() => setCopiedExpected(false), 2000);
                      }}
                      className="text-neutral-400 hover:text-neutral-200"
                    >
                      {copiedExpected ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                  <div className="text-emerald-400 bg-neutral-900 p-1.5 rounded truncate selection:bg-neutral-800">
                    {externalDrift.expected_hash}
                  </div>
                </div>

                {/* Actual Measured Hash */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-neutral-400">
                    <span>当前硬盘实测读出的 SHA-256 (外部篡改):</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(externalDrift.actual_hash);
                        setCopiedActual(true);
                        setTimeout(() => setCopiedActual(false), 2000);
                      }}
                      className="text-neutral-400 hover:text-neutral-200"
                    >
                      {copiedActual ? <Check className="w-3 h-3 text-amber-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                  <div className="text-amber-400 bg-neutral-900 p-1.5 rounded truncate selection:bg-neutral-800">
                    {externalDrift.actual_hash}
                  </div>
                </div>
              </div>
            </div>

            {/* Resolution Options */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-amber-200/80">
                请选择处理策略（决定权在用户手中）：
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => onResolveDrift(externalDrift.id, 'keep_local')}
                  className="px-3 py-1.5 text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg transition-colors border border-neutral-700"
                >
                  保留本地文件（跳过该文件并继续更新）
                </button>
                <button
                  onClick={() => onResolveDrift(externalDrift.id, 'overwrite_with_backup')}
                  className="px-3 py-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-neutral-950 rounded-lg transition-colors shadow-xs"
                >
                  覆盖并建立保护性备份
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Pipeline Stage Architecture Diagram */}
        <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 space-y-2">
          <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
            标准 6 阶段原子写入事务生命周期 (Transaction State Machine)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 pt-1 font-mono text-xs">
            {pipelineStages.map((st, i) => (
              <div
                key={st.key}
                className="p-2.5 rounded-lg bg-neutral-950/70 border border-neutral-800/80 flex flex-col justify-between"
              >
                <div className="text-neutral-400 text-[10px] mb-1">
                  0{i + 1}. {st.key}
                </div>
                <div className="font-semibold text-neutral-200 text-[11px] truncate">
                  {st.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Operations History and Recovery List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span className="font-semibold text-neutral-300">
              本地操作日志与快照清单 ({operations.length} 条记录)
            </span>
            <span>权威状态源：客户端持久化 Ledger</span>
          </div>

          <div className="border border-neutral-800 rounded-xl overflow-hidden bg-neutral-900/40">
            <table className="w-full text-left text-xs font-sans">
              <thead className="bg-neutral-950 text-neutral-400 text-[11px] border-b border-neutral-800 uppercase font-medium">
                <tr>
                  <th className="py-2.5 px-4">操作 ID / 模组</th>
                  <th className="py-2.5 px-3">类型</th>
                  <th className="py-2.5 px-3">当前状态</th>
                  <th className="py-2.5 px-3">进度 / 阶段</th>
                  <th className="py-2.5 px-3">备份快照 ID</th>
                  <th className="py-2.5 px-3">记录时间</th>
                  <th className="py-2.5 px-4 text-right">恢复与管理</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60 font-mono">
                {operations.map((op) => (
                  <tr key={op.operation_id} className="hover:bg-neutral-800/30 transition-colors">
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

                    {/* Actions */}
                    <td className="py-3 px-4 text-right font-sans">
                      <div className="flex items-center justify-end gap-1.5">
                        {op.state === 'needs_manual_recovery' ? (
                          <>
                            {op.can_rollback ? (
                              <button
                                onClick={() => onRecoverOperation(op.operation_id)}
                                className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-500 hover:bg-amber-400 text-neutral-950 transition-colors shadow-xs flex items-center gap-1"
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
                              className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-500 hover:bg-amber-400 text-neutral-950 transition-colors shadow-xs flex items-center gap-1"
                              title="安全回滚未完成事务到操作前状态"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>安全回滚</span>
                            </button>
                          )
                        )}

                        <button
                          onClick={() => setLogModalOp(op)}
                          className="px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors"
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
        </div>
      </div>

      {/* Log / Detail Modal */}
      {logModalOp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-none">
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950">
              <div className="flex items-center gap-2 text-xs font-mono">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span className="text-neutral-200 font-semibold">{logModalOp.operation_id} 事务详情与诊断</span>
              </div>
              <button
                onClick={() => setLogModalOp(null)}
                className="text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="p-4 bg-neutral-950/90 font-mono text-xs text-neutral-300 overflow-y-auto flex-1 space-y-2">
              <div className="text-neutral-400">
                [时间] 创建: {logModalOp.created_at} | 更新: {logModalOp.updated_at}
              </div>
              <div className="text-neutral-400">
                [模组] {logModalOp.mod_title} ({logModalOp.mod_id}) | 类型: {logModalOp.kind}
              </div>
              <div className="text-neutral-300">
                [状态] 阶段: <span className="text-sky-300">{logModalOp.phase || logModalOp.state}</span> | 状态机: <span className="text-amber-300">{logModalOp.state}</span>
              </div>
              <div className="text-neutral-300">
                [进度] 阶段说明: {logModalOp.progress.stage}
              </div>
              <div className="text-neutral-400">
                [文件] 处理进度: {logModalOp.progress.processed_files} / {logModalOp.progress.total_files} ({logModalOp.progress.percent}%)
                {logModalOp.progress.current_file && <span> | 最后路径: {logModalOp.progress.current_file}</span>}
              </div>
              {logModalOp.backup_id && (
                <div className="text-neutral-400">
                  [快照] 备份快照标识: {logModalOp.backup_id}
                </div>
              )}
              {logModalOp.conflict_path && (
                <div className="text-amber-300">
                  [冲突] 冲突文件路径: {logModalOp.conflict_path}
                </div>
              )}
              {logModalOp.expected_hash && (
                <div className="text-neutral-400 pl-4">
                  期望哈希: {logModalOp.expected_hash}
                </div>
              )}
              {logModalOp.actual_hash && (
                <div className="text-amber-400 pl-4">
                  实测哈希: {logModalOp.actual_hash}
                </div>
              )}
              {logModalOp.error && (
                <div className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-lg text-rose-300 space-y-1">
                  <div className="font-semibold">[错误代号] {logModalOp.error.code}</div>
                  <div>[错误详情] {logModalOp.error.message}</div>
                </div>
              )}
              {logModalOp.state === 'needs_manual_recovery' && (
                <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-lg text-amber-200 text-[11px] leading-relaxed">
                  提示：系统已进入保护性挂起状态。为防止破坏玩家可能手工编辑的文件，请先备份上述冲突文件。若已人工解决外部冲突或还原文件，可点击下方“重新校验并安全回滚”。
                </div>
              )}
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
