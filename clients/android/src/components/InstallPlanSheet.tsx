import React, { useState } from 'react';
import { Plan, Installation } from '../types/submodhub';
import { formatBytes } from '../utils/formatters';
import {
  X,
  AlertTriangle,
  CheckCircle2,
  FilePlus,
  FileDiff,
  ShieldAlert,
  HardDrive,
  Clock,
  Layers,
  FileText,
  RotateCcw,
  Sparkles,
} from 'lucide-react';

interface InstallPlanSheetProps {
  plan: Plan;
  installation: Installation;
  onClose: () => void;
  onConfirmApply: (plan: Plan) => void;
}

export const InstallPlanSheet: React.FC<InstallPlanSheetProps> = ({
  plan,
  installation,
  onClose,
  onConfirmApply,
}) => {
  const [activeTab, setActiveTab] = useState<'changes' | 'blockers' | 'summary'>('changes');

  const hasDependencyBlockers = plan.dependency_blockers.length > 0;
  const hasSemanticBlockers = plan.semantic_blockers.length > 0;
  const isGameRunning = installation.is_running;
  const isPermissionLost = installation.permission_state !== 'granted';

  const isBlocked =
    hasDependencyBlockers || hasSemanticBlockers || isGameRunning || isPermissionLost;

  const totalBlockersCount =
    plan.dependency_blockers.length +
    plan.semantic_blockers.length +
    (isGameRunning ? 1 : 0) +
    (isPermissionLost ? 1 : 0);

  return (
    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex flex-col justify-end animate-in fade-in duration-150">
      <div className="w-full bg-slate-900 border-t border-slate-750 rounded-t-3xl max-h-[85%] flex flex-col overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-200">
        {/* Grab Handle */}
        <div className="pt-3 pb-1 flex justify-center">
          <div className="w-10 h-1.5 bg-slate-700 rounded-full" />
        </div>

        {/* Sheet Top Bar */}
        <div className="px-5 py-3 border-b border-slate-800 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-100">
                安装事务计划预览 (Plan Preview)
              </h3>
              <span className="font-mono text-[10px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded-md">
                {plan.kind.toUpperCase()}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-1">
              <span>目标实例: {installation.label}</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="font-mono">ID: {plan.plan_id.slice(-8)}</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switchers in sheet */}
        <div className="px-5 pt-3 pb-2 flex items-center gap-2 border-b border-slate-800/80 bg-slate-950/40 text-xs">
          <button
            onClick={() => setActiveTab('changes')}
            className={`px-3 py-1.5 rounded-xl font-medium transition-all ${
              activeTab === 'changes'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            变更清单 ({plan.changes.length})
          </button>
          <button
            onClick={() => setActiveTab('blockers')}
            className={`px-3 py-1.5 rounded-xl font-medium flex items-center gap-1.5 transition-all ${
              activeTab === 'blockers'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                : isBlocked
                ? 'text-rose-400 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>阻断与冲突</span>
            {totalBlockersCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                {totalBlockersCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('summary')}
            className={`px-3 py-1.5 rounded-xl font-medium transition-all ${
              activeTab === 'summary'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            生效层与环境
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {activeTab === 'changes' && (
            <div className="space-y-3">
              <div className="text-xs text-slate-400 flex items-center justify-between">
                <span>将执行 {plan.changes.length} 处路径变更与写入</span>
                <span>需要备份: {plan.backups_required} 个文件</span>
              </div>

              {plan.changes.map((change, idx) => {
                const isReplace = change.action === 'replace';
                return (
                  <div
                    key={idx}
                    className="p-3 bg-slate-950/80 rounded-2xl border border-slate-800 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {isReplace ? (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-mono font-semibold">
                            REPLACE
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-semibold">
                            WRITE
                          </span>
                        )}
                        <span className="font-mono text-slate-200 text-[11px] truncate max-w-[200px]">
                          {change.target_path}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">
                        #{change.next_hash}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-400">
                      <span className="text-slate-500">变更原因: </span>
                      {change.reason}
                    </div>

                    {isReplace && change.previous_owner && (
                      <div className="text-[10px] text-amber-400/90 bg-amber-950/30 p-1.5 rounded-lg">
                        覆盖现有所有者: {change.previous_owner} (旧哈希: #{change.previous_hash})
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'blockers' && (
            <div className="space-y-3">
              {!isBlocked ? (
                <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-800/60 flex items-center gap-3 text-xs text-emerald-300">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div>
                    <h4 className="font-semibold text-emerald-200">无阻断项 (Plan Ready)</h4>
                    <p className="text-[11px] text-emerald-400/90 mt-0.5">
                      依赖关系、版本兼容性、MAS 进程状态与 SAF 权限全部处于健康状态。
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="p-3 rounded-2xl bg-rose-950/60 border border-rose-800 flex items-start gap-2.5 text-xs">
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-rose-200">
                        存在阻止写入的致命问题 ({totalBlockersCount})
                      </h4>
                      <p className="text-[11px] text-rose-300/90 mt-0.5">
                        根据契约，只有在阻断项完全清空、权限有效且 MAS 退出后，才允许向磁盘执行写入。
                      </p>
                    </div>
                  </div>

                  {/* Specific Blockers */}
                  {plan.dependency_blockers.map((b, i) => (
                    <div
                      key={`dep_${i}`}
                      className="p-3 bg-slate-950 rounded-2xl border border-rose-900/60 text-xs text-rose-200 flex items-start gap-2"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-rose-300">依赖缺失 (dependency_missing):</strong>
                        <p className="text-[11px] text-slate-300 mt-0.5">{b}</p>
                      </div>
                    </div>
                  ))}

                  {plan.semantic_blockers.map((b, i) => (
                    <div
                      key={`sem_${i}`}
                      className="p-3 bg-slate-950 rounded-2xl border border-rose-900/60 text-xs text-rose-200 flex items-start gap-2"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-rose-300">语义冲突 (semantic_conflict):</strong>
                        <p className="text-[11px] text-slate-300 mt-0.5">{b}</p>
                      </div>
                    </div>
                  ))}

                  {isGameRunning && (
                    <div className="p-3 bg-slate-950 rounded-2xl border border-amber-900/60 text-xs text-amber-200 flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-amber-300">游戏运行中 (game_running):</strong>
                        <p className="text-[11px] text-slate-300 mt-0.5">
                          检测到 Monika After Story 正在前台或后台运行。请先保存并关闭游戏，避免文件锁争用与内存崩溃。
                        </p>
                      </div>
                    </div>
                  )}

                  {isPermissionLost && (
                    <div className="p-3 bg-slate-950 rounded-2xl border border-rose-900/60 text-xs text-rose-200 flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-rose-300">SAF 权限丢失 (permission_lost):</strong>
                        <p className="text-[11px] text-slate-300 mt-0.5">
                          Android 存储访问框架 (SAF) 权限已过期或被系统撤销，需重新调起系统授权。
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'summary' && (
            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">所需存储空间:</span>
                  <span className="font-mono text-slate-200 font-semibold">
                    {formatBytes(plan.bytes_required)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">实例剩余可用空间:</span>
                  <span className="font-mono text-emerald-400 font-semibold">
                    {formatBytes(installation.free_space_bytes)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">推荐模组加载优先级:</span>
                  <span className="font-mono text-rose-300 font-semibold">
                    {plan.target_priority ?? 10}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">计划有效期至:</span>
                  <span className="font-mono text-slate-400 text-[11px]">
                    15 分钟内有效 (防失效过期)
                  </span>
                </div>
              </div>

              <div className="p-3 bg-slate-950/60 rounded-2xl border border-slate-800/80 text-[11px] text-slate-400 space-y-1">
                <h5 className="font-semibold text-slate-300">原子回滚保证:</h5>
                <p>
                  写入前系统将在本地生成隔离备份。若下载校验异常、磁盘空间突发不足或检测到外部文件漂移，系统将自动安全回滚至初始状态。
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Sticky Sheet Bottom Action */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center gap-3">
          <button
            onClick={onClose}
            className="px-4 h-12 rounded-2xl border border-slate-750 text-slate-300 hover:bg-slate-800 text-xs font-medium transition-colors"
          >
            取消计划
          </button>

          <button
            disabled={isBlocked}
            onClick={() => onConfirmApply(plan)}
            className={`flex-1 h-12 rounded-2xl font-bold text-xs flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98] ${
              isBlocked
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-750'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
            }`}
          >
            {isBlocked ? (
              <span>存在阻断项，禁止执行写入</span>
            ) : (
              <span>确认无误，执行写入事务 (ApplyPlan)</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
