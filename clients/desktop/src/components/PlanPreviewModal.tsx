import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  HardDrive,
  Clock,
  ArrowRight,
  FileCheck,
  CheckCircle2,
  Lock,
  FilePlus,
  FileEdit,
  Trash2,
  Undo2,
} from 'lucide-react';
import { Plan, Installation } from '../types/client';

interface PlanPreviewModalProps {
  plan: Plan | null;
  activeInstallation: Installation;
  isGameRunning: boolean;
  onClose: () => void;
  onApplyPlan: (planId: string) => void;
}

export const PlanPreviewModal: React.FC<PlanPreviewModalProps> = ({
  plan,
  activeInstallation,
  isGameRunning,
  onClose,
  onApplyPlan,
}) => {
  const [timeLeft, setTimeLeft] = useState(300); // 5 minutes validity countdown

  useEffect(() => {
    if (!plan) return;
    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [plan]);

  if (!plan) return null;

  const hasDependencyBlockers = plan.dependency_blockers.length > 0;
  const hasSemanticBlockers = plan.semantic_blockers.length > 0;
  const isBlockedByGame = isGameRunning;
  const isInvalidRoot = !activeInstallation.is_valid || activeInstallation.permission_state !== 'authorized';
  const isInsufficientSpace = plan.bytes_required > activeInstallation.disk_available_bytes;

  const canConfirm =
    !hasDependencyBlockers &&
    !hasSemanticBlockers &&
    !isBlockedByGame &&
    !isInvalidRoot &&
    !isInsufficientSpace;

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
            新建 (CREATE)
          </span>
        );
      case 'OVERWRITE':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/60 font-mono">
            覆盖 (OVERWRITE)
          </span>
        );
      case 'REMOVE':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800/60 font-mono">
            移除 (REMOVE)
          </span>
        );
      case 'RESTORE':
        return (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-950/80 text-sky-300 border border-sky-800/60 font-mono">
            还原 (RESTORE)
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-none">
      <div className="bg-neutral-900 border border-neutral-700/80 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 border-b border-neutral-800 bg-neutral-900/90 flex items-start justify-between shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800/80 uppercase">
                {plan.kind === 'install'
                  ? '安装计划预览'
                  : plan.kind === 'update'
                  ? '升级更新计划预览'
                  : plan.kind === 'uninstall'
                  ? '卸载计划预览'
                  : '修复计划预览'}
              </span>
              <h2 className="text-base font-bold text-neutral-100">
                {plan.mod_title} <span className="font-mono text-emerald-400">{plan.version_str}</span>
              </h2>
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-400 mt-1 font-mono">
              <span>规划计划单据 ID: {plan.plan_id}</span>
              <span aria-hidden="true">·</span>
              <span className="flex items-center gap-1 text-amber-400">
                <Clock className="w-3.5 h-3.5" />
                <span>计划有效期剩余: {formatSeconds(timeLeft)}</span>
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Storage and Target Summary */}
        <div className="px-4 py-2.5 bg-neutral-950/80 border-b border-neutral-800/80 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs shrink-0">
          <div>
            <span className="text-neutral-400 block text-[11px]">目标 MAS 安装目录</span>
            <span className="text-neutral-200 font-medium truncate block" title={activeInstallation.path_hint}>
              {activeInstallation.label}
            </span>
          </div>

          <div>
            <span className="text-neutral-400 block text-[11px]">所需解压存储空间</span>
            <span className="font-mono text-neutral-200 tabular-nums">
              {formatBytes(plan.bytes_required)}
            </span>
          </div>

          <div>
            <span className="text-neutral-400 block text-[11px]">需前置备份的原文件</span>
            <span className="font-mono text-neutral-200 tabular-nums">
              {plan.backups_required} 个文件（写入前自动暂存快照）
            </span>
          </div>

          <div>
            <span className="text-neutral-400 block text-[11px]">可用磁盘剩余空间</span>
            <span className="font-mono text-emerald-400 tabular-nums">
              {(activeInstallation.disk_available_bytes / (1024 * 1024 * 1024)).toFixed(1)} GB
            </span>
          </div>
        </div>

        {/* Scrollable inspection area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* CRITICAL BLOCKERS (Section 5 Contract) */}
          {/* 1. Game Running Blocker */}
          {isGameRunning && (
            <div className="p-3.5 rounded-lg bg-amber-950/80 border border-amber-700/80 flex items-start gap-3 text-xs text-amber-200">
              <Lock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-amber-300">
                  阻断警告: Monika After Story 游戏正在运行中 [game_running]
                </div>
                <div className="mt-1 leading-relaxed text-amber-200/90">
                  Ren&apos;Py 引擎在游戏启动期间会保持对 <code>game/</code> 目录下 .rpy 和 .rpyc 脚本的锁定。
                  为防止运行时读写损坏或存档异常，<strong>必须先完全关闭 MAS 游戏进程</strong>，才能执行写入操作。
                </div>
              </div>
            </div>
          )}

          {/* 2. Dependency Missing Blocker */}
          {hasDependencyBlockers && (
            <div className="p-3.5 rounded-lg bg-rose-950/80 border border-rose-800 flex items-start gap-3 text-xs text-rose-200">
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-rose-300">
                  阻断警告: 依赖前置库缺失或版本不兼容 [dependency_missing]
                </div>
                <div className="mt-1 space-y-1 font-mono">
                  {plan.dependency_blockers.map((blk) => (
                    <div key={blk.mod_id} className="text-rose-200/90">
                      • 缺少前置依赖: <strong>{blk.mod_title}</strong> (要求版本: {blk.required_range})。{blk.reason}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 3. Semantic Conflict Blocker */}
          {hasSemanticBlockers && (
            <div className="p-3.5 rounded-lg bg-rose-950/80 border border-rose-800 flex items-start gap-3 text-xs text-rose-200">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-rose-300">
                  阻断警告: 发现语义命名冲突 [semantic_conflict]
                </div>
                <div className="mt-1 space-y-1 font-mono">
                  {plan.semantic_blockers.map((sc, idx) => (
                    <div key={idx} className="text-rose-200/90">
                      • 冲突标识: <code>{sc.identifier}</code> 与已安装的 <strong>{sc.conflicting_with}</strong> 重复。{sc.details}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Safe confirmation notice if ready */}
          {canConfirm && (
            <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/60 flex items-center gap-2.5 text-xs text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>所有安全校验与依赖检查均已通过。计划将在用户点击“确认执行”后以原子写入流水线执行。</span>
            </div>
          )}

          {/* Detailed File Changes List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-neutral-300">
              <span className="font-semibold">计划修改文件清单 ({plan.changes.length} 项变更)</span>
              <span className="text-neutral-400 text-[11px]">
                所有受影响的原文件将在写入前生成校验快照
              </span>
            </div>

            <div className="border border-neutral-800 rounded-lg overflow-hidden font-mono text-xs">
              <table className="w-full text-left">
                <thead className="bg-neutral-950 text-neutral-400 text-[11px] border-b border-neutral-800">
                  <tr>
                    <th className="py-2 px-3">动作</th>
                    <th className="py-2 px-3">目标相对路径</th>
                    <th className="py-2 px-3">原所有者 → 新生效者</th>
                    <th className="py-2 px-3">安全快照</th>
                    <th className="py-2 px-3">原因说明</th>
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
                        {c.previous_owner || '(无)'} <ArrowRight className="w-2.5 h-2.5 inline mx-0.5" /> {c.next_owner || '(移除)'}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {c.backup_required ? (
                          <span className="text-emerald-400 text-[11px] flex items-center gap-1">
                            <FileCheck className="w-3.5 h-3.5" />
                            <span>将备份原件</span>
                          </span>
                        ) : (
                          <span className="text-neutral-400 text-[11px]">无需备份</span>
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
        <div className="p-4 border-t border-neutral-800 bg-neutral-900/95 flex items-center justify-between shrink-0">
          <div className="text-xs text-neutral-400">
            {!canConfirm ? (
              <span className="text-rose-400 font-medium">
                {isGameRunning
                  ? '写入受阻：MAS 进程正在运行，请退出游戏后解除锁定'
                  : '写入受阻：存在未解决的依赖或语义冲突'}
              </span>
            ) : (
              <span className="text-emerald-400 font-medium">
                规划校验完毕，准备写入 MAS 目录
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700/80 rounded-lg transition-colors"
            >
              放弃并取消
            </button>
            <button
              onClick={() => {
                if (canConfirm) {
                  onApplyPlan(plan.plan_id);
                }
              }}
              disabled={!canConfirm}
              className={`px-5 py-2 text-xs font-semibold rounded-lg transition-all flex items-center gap-2 shadow-sm ${
                canConfirm
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
                  : 'bg-neutral-800 text-neutral-400 cursor-not-allowed border border-neutral-700/50'
              }`}
            >
              {!canConfirm && isGameRunning && <Lock className="w-3.5 h-3.5" />}
              <span>确认执行写入 (ApplyPlan)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
