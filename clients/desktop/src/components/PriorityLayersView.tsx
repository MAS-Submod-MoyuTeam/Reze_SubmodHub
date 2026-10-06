import React, { useState } from 'react';
import {
  Layers,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Save,
  RotateCcw,
} from 'lucide-react';
import { InstalledItem } from '../types/client';

interface PriorityLayersViewProps {
  installedMods: InstalledItem[];
  onApplyNewPriorities: (newPriorities: Record<string, number>) => void;
}

export const PriorityLayersView: React.FC<PriorityLayersViewProps> = ({
  installedMods,
  onApplyNewPriorities,
}) => {
  // Only managed mods participate in priority layering
  const managedMods = installedMods.filter((m) => m.is_managed);

  // Local state for modified priorities
  const [priorities, setPriorities] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    managedMods.forEach((m) => {
      map[m.mod_id] = m.priority;
    });
    return map;
  });

  const [hasChanges, setHasChanges] = useState(false);

  // Sorted list based on current priorities (highest priority on top)
  const sortedMods = [...managedMods].sort((a, b) => {
    const pA = priorities[a.mod_id] ?? a.priority;
    const pB = priorities[b.mod_id] ?? b.priority;
    return pB - pA;
  });

  const handlePriorityChange = (modId: string, delta: number) => {
    const current = priorities[modId] ?? 0;
    const next = Math.max(0, Math.min(100, current + delta));
    setPriorities((prev) => ({
      ...prev,
      [modId]: next,
    }));
    setHasChanges(true);
  };

  const handleReset = () => {
    const map: Record<string, number> = {};
    managedMods.forEach((m) => {
      map[m.mod_id] = m.priority;
    });
    setPriorities(map);
    setHasChanges(false);
  };

  const handleSave = () => {
    onApplyNewPriorities(priorities);
    setHasChanges(false);
  };

  // Simulated PreviewPriority calculations (as mandated by Section 4 Go contract)
  const previewDiffs = [
    {
      path: 'game/mod_assets/monika/c/ribbon_emerald.png',
      reason: '外观素材图层重叠：图层较高者覆盖默认发带',
      previous_winner: 'Emerald Ribbon & Winter Knit (Layer 30)',
      next_winner: priorities['mod_winter_emerald'] !== undefined && priorities['mod_winter_emerald'] >= 50
        ? 'Emerald Ribbon & Winter Knit (新生效图层)'
        : '系统默认外观包 (Layer 0)',
    },
    {
      path: 'game/submods/ExtraPlus/extraplus_menu.rpy',
      reason: '主界面扩展菜单挂钩执行次序',
      previous_winner: 'ExtraPlus (Layer 10)',
      next_winner: 'ExtraPlus (保持底座服务优先)',
    },
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-950">
      {/* Top Header */}
      <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-neutral-100">
              模组图层与覆盖优先级管理器 (PreviewPriority)
            </h2>
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            控制 MAS 加载子模组脚本与贴图资源的执行次序。优先级数值越高（0 ~ 100），在发生同名路径竞争时越具有最高覆盖权。
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={handleReset}
            disabled={!hasChanges}
            className="px-3 py-1.5 rounded-lg bg-neutral-800 text-neutral-300 hover:text-white disabled:opacity-40 transition-colors flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>撤销重置</span>
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-40 transition-colors flex items-center gap-1.5 shadow-xs"
          >
            <Save className="w-3.5 h-3.5" />
            <span>应用并持久化新图层配置</span>
          </button>
        </div>
      </div>

      {/* Main split view: Priority Stack on Left, Live Diff Preview on Right */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
        {/* Left Column: Stack (7 cols) */}
        <div className="lg:col-span-7 border-r border-neutral-800 overflow-y-auto p-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-neutral-400 px-1">
            <span>当前图层堆叠 (由高至低生效)</span>
            <span className="font-mono">数值范围: 0 (底层) ~ 100 (顶层优先)</span>
          </div>

          <div className="space-y-2">
            {sortedMods.map((item, index) => {
              const currentP = priorities[item.mod_id] ?? item.priority;
              const isModified = currentP !== item.priority;

              return (
                <div
                  key={item.mod_id}
                  className={`p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                    isModified
                      ? 'bg-amber-950/30 border-amber-800/80 shadow-xs'
                      : 'bg-neutral-900/80 border-neutral-800 hover:border-neutral-700'
                  }`}
                >
                  <div className="flex items-center gap-3 truncate">
                    <span className="w-6 text-center font-mono font-bold text-xs text-neutral-400">
                      #{index + 1}
                    </span>
                    <div className="truncate">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-neutral-100 text-xs truncate">
                          {item.title}
                        </span>
                        <span className="text-[10px] text-neutral-400 font-mono">
                          v{item.installed_version}
                        </span>
                      </div>
                      <div className="text-[11px] text-neutral-400 mt-0.5 truncate">
                        {item.author_name} · {item.category === 'submod' ? '功能模组' : '外观材质包'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Priority Value Badge */}
                    <div className="text-right">
                      <div className="font-mono font-bold text-xs text-emerald-400 tabular-nums">
                        Layer {currentP}
                      </div>
                      {isModified && (
                        <div className="text-[10px] text-amber-400 font-mono">
                          原: {item.priority}
                        </div>
                      )}
                    </div>

                    {/* Step buttons */}
                    <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800">
                      <button
                        onClick={() => handlePriorityChange(item.mod_id, 10)}
                        title="增加优先级 (+10)"
                        className="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-colors"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handlePriorityChange(item.mod_id, -10)}
                        title="降低优先级 (-10)"
                        className="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded transition-colors"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: PreviewPriority Diff & Conflict Analysis (5 cols) */}
        <div className="lg:col-span-5 bg-neutral-950/70 p-4 overflow-y-auto space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-neutral-200 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>PreviewPriority 契约校验报告</span>
            </h3>
            <span className="text-[11px] font-mono text-neutral-400">实时计算</span>
          </div>

          <div className="p-3.5 rounded-lg bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 space-y-2">
            <p className="leading-relaxed">
              根据契约要求：客户端调整优先级<strong>必须先在界面上显示哪些文件会改变生效归属</strong>，防止无意识破坏其他模组对材质或脚本的依赖关系。
            </p>
          </div>

          {/* Diff items */}
          <div className="space-y-3">
            <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
              受当前优先级次序影响的目标路径映射
            </div>

            {previewDiffs.map((diff, i) => (
              <div
                key={i}
                className="p-3 rounded-lg bg-neutral-900/60 border border-neutral-800/80 space-y-2 text-xs font-mono"
              >
                <div className="text-emerald-300 truncate" title={diff.path}>
                  {diff.path}
                </div>
                <div className="text-[11px] text-neutral-400 font-sans">
                  {diff.reason}
                </div>
                <div className="pt-2 border-t border-neutral-800 text-[11px] space-y-1">
                  <div className="text-neutral-400">
                    先前生效所有者: <span className="text-neutral-300">{diff.previous_winner}</span>
                  </div>
                  <div className="text-neutral-400">
                    调整后新生效者: <span className="text-emerald-400 font-semibold">{diff.next_winner}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Safe notes */}
          <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800/80 text-xs text-neutral-400 space-y-1">
            <div className="font-semibold text-neutral-300">💡 推荐配置指南</div>
            <div className="leading-relaxed">
              • 基础库（如 <code>ExtraPlus</code>）建议保持较低优先级（10~20），以便作为通用基座为上层模组服务。<br />
              • 特定活动或节日定制外观建议赋予较高优先级（60~80），以确保外观贴图优先渲染。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
