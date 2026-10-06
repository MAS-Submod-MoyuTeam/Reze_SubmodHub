import React, { useState } from 'react';
import { Operation, OperationStage } from '../types/submodhub';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  FileCode,
  Download,
  ShieldCheck,
  HardDrive,
  FileCheck,
  PauseCircle,
  FileText,
  Play,
  RotateCw,
} from 'lucide-react';

interface OperationsTabProps {
  operations: Operation[];
  onOpenDriftModal: (op: Operation) => void;
  onSimulateRestart: (operationId: string) => void;
  onExportLogs: (operationId?: string) => void;
  onRetryOperation: (operationId: string) => void;
}

const STAGES: { key: OperationStage; label: string; icon: any }[] = [
  { key: 'planned', label: '准备计划', icon: FileText },
  { key: 'downloading', label: '下载校验', icon: Download },
  { key: 'scanning', label: 'AST扫描', icon: ShieldCheck },
  { key: 'backed_up', label: '安全备份', icon: RotateCcw },
  { key: 'writing', label: '写入文件', icon: HardDrive },
  { key: 'committed', label: '事务提交', icon: CheckCircle2 },
];

export const OperationsTab: React.FC<OperationsTabProps> = ({
  operations,
  onOpenDriftModal,
  onSimulateRestart,
  onExportLogs,
  onRetryOperation,
}) => {
  const [selectedOpId, setSelectedOpId] = useState<string>(
    operations[0]?.operation_id || ''
  );

  const selectedOp =
    operations.find((o) => o.operation_id === selectedOpId) || operations[0];

  const getStageIndex = (stage: OperationStage) => {
    return STAGES.findIndex((s) => s.key === stage);
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto pb-6">
      {/* Top Header */}
      <div className="p-4 bg-slate-900/60 border-b border-slate-800/80 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            事务进度与恢复中心
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            权威来源: 本地持久化 SQLite / GetOperation 绑定
          </p>
        </div>

        <button
          onClick={() => onExportLogs(selectedOp?.operation_id)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
          title="导出操作审计日志 (ExportLogs)"
        >
          <FileText className="w-3.5 h-3.5" />
          <span>导出日志</span>
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Operations Switcher Pills */}
        <div className="space-y-1.5">
          <span className="text-xs text-slate-400">操作实例列表:</span>
          <div className="flex items-center gap-2 overflow-x-auto py-1 no-scrollbar">
            {operations.map((op) => {
              const isSelected = op.operation_id === selectedOp?.operation_id;
              const isPaused = op.status === 'recoverable';
              const isDone = op.status === 'completed';

              return (
                <button
                  key={op.operation_id}
                  onClick={() => setSelectedOpId(op.operation_id)}
                  className={`px-3 py-2 rounded-2xl text-left shrink-0 transition-all border ${
                    isSelected
                      ? 'bg-slate-800/90 border-rose-500/50 shadow-md'
                      : 'bg-slate-950/60 border-slate-800 hover:bg-slate-850'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-200 truncate max-w-[150px]">
                      {op.mod_title}
                    </span>
                    {isPaused && (
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                    {op.operation_id.slice(-11)} · {op.status}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Operation Detail Card */}
        {selectedOp && (
          <div className="bg-slate-950/80 border border-slate-800 rounded-3xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="px-2 py-0.5 rounded-md bg-slate-800 text-[10px] font-mono text-slate-400">
                  OPERATION ID: {selectedOp.operation_id}
                </span>
                <h3 className="text-base font-bold text-slate-100 mt-1">
                  {selectedOp.mod_title}
                </h3>
                <div className="text-xs text-slate-400 mt-0.5">
                  类型: {selectedOp.kind} · 关联计划: {selectedOp.plan_id}
                </div>
              </div>

              {/* Status Badge */}
              <div>
                {selectedOp.status === 'completed' && (
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    已提交
                  </span>
                )}
                {selectedOp.status === 'in_progress' && (
                  <span className="px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold flex items-center gap-1 animate-pulse">
                    <RotateCw className="w-3.5 h-3.5 animate-spin" />
                    执行中
                  </span>
                )}
                {selectedOp.status === 'recoverable' && (
                  <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1">
                    <PauseCircle className="w-3.5 h-3.5" />
                    异常暂停 (待恢复)
                  </span>
                )}
              </div>
            </div>

            {/* Stepper (planned -> downloading -> scanning -> backed_up -> writing -> committed) */}
            <div className="p-3 bg-slate-900 rounded-2xl border border-slate-800/80 space-y-3">
              <span className="text-[11px] text-slate-400 font-medium">
                规范 6 步原子事务状态机
              </span>

              <div className="grid grid-cols-6 gap-1">
                {STAGES.map((s, idx) => {
                  const currentIdx = getStageIndex(selectedOp.stage);
                  const isPast = idx < currentIdx;
                  const isCurrent = idx === currentIdx;
                  const Icon = s.icon;

                  return (
                    <div key={s.key} className="flex flex-col items-center text-center">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs transition-all ${
                          isPast
                            ? 'bg-emerald-500 text-slate-950 font-bold'
                            : isCurrent
                            ? selectedOp.status === 'recoverable'
                              ? 'bg-amber-500 text-slate-950 font-bold ring-2 ring-amber-400'
                              : 'bg-rose-500 text-white font-bold ring-2 ring-rose-400 animate-pulse'
                            : 'bg-slate-800 text-slate-500'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <span
                        className={`text-[9px] mt-1 leading-tight ${
                          isCurrent
                            ? 'text-slate-200 font-semibold'
                            : isPast
                            ? 'text-emerald-400'
                            : 'text-slate-500'
                        }`}
                      >
                        {s.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Progress bar */}
              <div className="space-y-1 pt-1">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-slate-400">
                    阶段: {selectedOp.stage.toUpperCase()}
                  </span>
                  <span className="text-slate-200 font-bold">
                    {selectedOp.progress_percent}%
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      selectedOp.status === 'recoverable'
                        ? 'bg-amber-400'
                        : selectedOp.status === 'completed'
                        ? 'bg-emerald-400'
                        : 'bg-rose-500'
                    }`}
                    style={{ width: `${selectedOp.progress_percent}%` }}
                  />
                </div>
              </div>

              {selectedOp.current_file && (
                <div className="text-[10px] text-slate-400 font-mono truncate">
                  写入路径: {selectedOp.current_file}
                </div>
              )}
            </div>

            {/* External Change / Drift Pause Alert (Contract Spec Highlight) */}
            {selectedOp.status === 'recoverable' && selectedOp.drift_detail && (
              <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-600/70 space-y-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-amber-200">
                      文件哈希漂移已暂停写入 (external_change)
                    </h4>
                    <p className="text-[11px] text-amber-300/90 mt-1 leading-relaxed">
                      检测到目标文件已被第三方程序或手动修改。根据契约：
                      <strong>系统严禁自动覆盖用户改动文件</strong>，事务已自动冻结。
                    </p>
                  </div>
                </div>

                <div className="p-3 bg-slate-950 rounded-xl border border-amber-900/60 font-mono text-[11px] space-y-1.5">
                  <div className="text-slate-400">
                    受影响路径: <span className="text-amber-200">{selectedOp.drift_detail.file_path}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>预期哈希:</span>
                    <span className="text-slate-300">#{selectedOp.drift_detail.expected_hash.slice(0, 16)}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>实测哈希:</span>
                    <span className="text-rose-400 font-semibold">#{selectedOp.drift_detail.actual_hash.slice(0, 16)} (漂移)</span>
                  </div>
                </div>

                <button
                  onClick={() => onOpenDriftModal(selectedOp)}
                  className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-md transition-all active:scale-95"
                >
                  <PauseCircle className="w-4 h-4" />
                  <span>解决冲突并恢复操作 (RecoverOperation)</span>
                </button>
              </div>
            )}

            {/* Simulated Restart & Reconnection Test */}
            <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300">
                  冷重启会话重连校验
                </span>
                <span className="text-[10px] text-slate-500 font-mono">TEST HARNESS</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-normal">
                根据契约规范：“前端必须能在应用进程被杀或系统重启后，凭 operation_id 重连并恢复显示当前状态。”
              </p>
              <button
                onClick={() => onSimulateRestart(selectedOp.operation_id)}
                className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-300 text-[11px] font-medium border border-slate-700 transition-colors flex items-center justify-center gap-1.5"
              >
                <RotateCcw className="w-3 h-3 text-rose-400" />
                <span>模拟冷重启并通过 operation_id 重连</span>
              </button>
            </div>

            {/* Operation Logs Preview */}
            {selectedOp.log_lines && selectedOp.log_lines.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-xs text-slate-400">逐步骤执行日志:</span>
                <div className="p-3 bg-slate-950 rounded-2xl border border-slate-850 font-mono text-[10px] text-slate-400 space-y-1 max-h-36 overflow-y-auto">
                  {selectedOp.log_lines.map((line, i) => (
                    <div key={i} className="leading-relaxed">
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
