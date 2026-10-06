import React, { useState } from 'react';
import { InstalledMod, Installation } from '../types/submodhub';
import { ArrowUpDown, X, Check, Layers, AlertCircle, FileDiff } from 'lucide-react';

interface PriorityModalProps {
  mod: InstalledMod;
  allInstalledMods: InstalledMod[];
  installation: Installation;
  onClose: () => void;
  onApplyPriority: (modId: string, newPriority: number) => void;
}

export const PriorityModal: React.FC<PriorityModalProps> = ({
  mod,
  allInstalledMods,
  installation,
  onClose,
  onApplyPriority,
}) => {
  const [priority, setPriority] = useState(mod.priority);

  // Calculate impacted layers based on priority change
  const isChanged = priority !== mod.priority;
  const isElevated = priority > mod.priority;

  const impactedMods = allInstalledMods.filter(
    (m) =>
      m.mod_id !== mod.mod_id &&
      ((isElevated && m.priority >= mod.priority && m.priority <= priority) ||
        (!isElevated && m.priority <= mod.priority && m.priority >= priority))
  );

  return (
    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-750 rounded-3xl p-5 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
              <ArrowUpDown className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                加载优先级调序预览
              </h3>
              <span className="font-mono text-[10px] text-slate-400">
                PreviewPriority 契约核验
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div>
          <h4 className="text-xs font-semibold text-slate-200">{mod.title}</h4>
          <p className="text-[11px] text-slate-400 mt-0.5">
            当前优先级: <span className="font-mono font-bold text-rose-300">{mod.priority}</span>
          </p>
        </div>

        {/* Priority Slider */}
        <div className="p-3 bg-slate-950 rounded-2xl border border-slate-850 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">调整目标优先级:</span>
            <span className="font-mono text-base font-bold text-rose-400">{priority}</span>
          </div>
          <input
            type="range"
            min="0"
            max="120"
            step="5"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="w-full accent-rose-500"
          />
          <div className="flex justify-between text-[10px] text-slate-500 font-mono">
            <span>0 (底层/只读)</span>
            <span>50 (常规扩展)</span>
            <span>100+ (核心框架优先)</span>
          </div>
        </div>

        {/* Priority Change Impact Preview (CRITICAL REQUIREMENT: "优先级调整须先显示哪些文件会改变") */}
        <div className="p-3 rounded-2xl bg-slate-950 border border-slate-800 space-y-2 text-xs">
          <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
            <FileDiff className="w-3.5 h-3.5 text-rose-400" />
            <span>生效层受影响文件预测:</span>
          </div>

          {isChanged ? (
            <div className="space-y-1.5 text-[11px]">
              <p className="text-slate-300">
                优先级从 <strong className="font-mono text-slate-100">{mod.priority}</strong> 变更为{' '}
                <strong className="font-mono text-rose-400">{priority}</strong>：
              </p>
              <div className="p-2 bg-slate-900 rounded-xl font-mono text-[10px] text-slate-300 space-y-1">
                <div>· game/Submods/{mod.mod_id}/header.rpy (加载顺序权重重新排序)</div>
                {impactedMods.length > 0 && (
                  <div className="text-amber-300">
                    · 将改变与 {impactedMods.map((m) => m.title).join(', ')} 的层叠覆盖优先级
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 italic">
              滑动调节滑块以实时计算生效层文件变更列表。
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="pt-1 flex items-center gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-750 text-slate-300 text-xs font-medium hover:bg-slate-800 transition-colors"
          >
            取消
          </button>
          <button
            disabled={!isChanged}
            onClick={() => onApplyPriority(mod.mod_id, priority)}
            className={`flex-1 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 shadow-md transition-all ${
              isChanged
                ? 'bg-rose-600 hover:bg-rose-500 text-white active:scale-95'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            <Check className="w-4 h-4" />
            <span>应用优先级计划</span>
          </button>
        </div>
      </div>
    </div>
  );
};
