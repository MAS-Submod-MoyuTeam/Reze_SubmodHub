import React, { useState } from 'react';
import { InstalledMod, Installation, Mod } from '../types/submodhub';
import { formatDate } from '../utils/formatters';
import {
  Layers,
  ArrowUpDown,
  Sparkles,
  AlertCircle,
  HelpCircle,
  ShieldCheck,
  ChevronRight,
  RefreshCw,
  FolderOpen,
  Sliders,
  CheckCircle,
  FileQuestion,
  Trash2,
} from 'lucide-react';

interface InstalledTabProps {
  installedMods: InstalledMod[];
  currentInstallation: Installation;
  allMods: Mod[];
  onSelectModById: (modId: string) => void;
  onRequestUpdatePlan: (modId: string) => void;
  onOpenAdoptModal: (unmanagedMod: InstalledMod) => void;
  onOpenPriorityModal: (mod: InstalledMod) => void;
  onRequestUninstallPlan: (mod: InstalledMod) => void;
}

export const InstalledTab: React.FC<InstalledTabProps> = ({
  installedMods,
  currentInstallation,
  allMods,
  onSelectModById,
  onRequestUpdatePlan,
  onOpenAdoptModal,
  onOpenPriorityModal,
  onRequestUninstallPlan,
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'managed' | 'unmanaged'>('all');

  const managedMods = installedMods.filter((m) => m.managed);
  const unmanagedMods = installedMods.filter((m) => !m.managed);

  const displayedMods =
    filterMode === 'managed'
      ? managedMods
      : filterMode === 'unmanaged'
      ? unmanagedMods
      : installedMods;

  const updatesCount = managedMods.filter((m) => m.has_update).length;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto pb-6">
      {/* Game Running Warning Alert if active */}
      {currentInstallation.is_running && (
        <div className="bg-amber-950/80 border-b border-amber-800 px-4 py-2.5 flex items-center justify-between text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>检测到 MAS 正在运行中。为保证数据安全，更新与卸载已暂时锁定。</span>
          </div>
        </div>
      )}

      {/* Top Summary Card */}
      <div className="p-4 bg-slate-900/60 border-b border-slate-800/80 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Layers className="w-4 h-4 text-rose-400" />
              本地模组环境管理
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              已挂载实例: {currentInstallation.label}
            </p>
          </div>

          {updatesCount > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{updatesCount} 个更新可用</span>
            </div>
          )}
        </div>

        {/* Tab Filter buttons */}
        <div className="flex items-center p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => setFilterMode('all')}
            className={`flex-1 py-1.5 font-medium rounded-lg transition-all ${
              filterMode === 'all'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            全部 ({installedMods.length})
          </button>
          <button
            onClick={() => setFilterMode('managed')}
            className={`flex-1 py-1.5 font-medium rounded-lg transition-all ${
              filterMode === 'managed'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            已托管 ({managedMods.length})
          </button>
          <button
            onClick={() => setFilterMode('unmanaged')}
            className={`flex-1 py-1.5 font-medium rounded-lg transition-all ${
              filterMode === 'unmanaged'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            未托管检测 ({unmanagedMods.length})
          </button>
        </div>
      </div>

      {/* Installed List */}
      <div className="p-4 space-y-4">
        {/* Managed Section */}
        {(filterMode === 'all' || filterMode === 'managed') && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400 px-1">
              <span className="font-semibold text-slate-300">
                SubmodHub 托管版本 (按优先级加载)
              </span>
              <span className="text-[11px]">数值越高越优先加载</span>
            </div>

            {managedMods.map((mod) => {
              return (
                <div
                  key={mod.mod_id}
                  className="bg-slate-950/80 border border-slate-800 hover:border-slate-700 rounded-3xl p-4 transition-all shadow-sm space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-slate-100 truncate">
                          {mod.title}
                        </h4>
                        <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 font-mono text-[10px] shrink-0">
                          Priority {mod.priority}
                        </span>
                      </div>

                      {/* Zero-Pill Metadata */}
                      <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-1 flex-wrap">
                        <span>{mod.author_name}</span>
                        <span aria-hidden="true" className="text-slate-600">·</span>
                        <span className="font-mono text-slate-300">{mod.current_version}</span>
                        <span aria-hidden="true" className="text-slate-600">·</span>
                        <span>{mod.file_count} 个托管文件</span>
                      </div>
                    </div>
                  </div>

                  {/* Update prompt banner if available */}
                  {mod.has_update && (
                    <div className="p-2.5 rounded-2xl bg-rose-950/40 border border-rose-800/60 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 text-rose-300">
                        <Sparkles className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        <span>发现新版本: {mod.latest_available_version}</span>
                      </div>
                      <button
                        onClick={() => onRequestUpdatePlan(mod.mod_id)}
                        className="px-3 py-1 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition-colors shadow-sm"
                      >
                        预览升级 (PreviewUpdate)
                      </button>
                    </div>
                  )}

                  {/* Actions Row */}
                  <div className="pt-2 border-t border-slate-850 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onOpenPriorityModal(mod)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-medium border border-slate-750 transition-colors"
                        title="调整加载优先级并预览受影响文件"
                      >
                        <ArrowUpDown className="w-3 h-3 text-rose-400" />
                        <span>调序预览 (PreviewPriority)</span>
                      </button>

                      <button
                        onClick={() => onSelectModById(mod.mod_id)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-medium border border-slate-750 transition-colors"
                      >
                        <span>详情/历史</span>
                      </button>
                    </div>

                    <button
                      onClick={() => onRequestUninstallPlan(mod)}
                      className="flex items-center gap-1 p-2 rounded-xl text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      title="预览卸载计划"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Unmanaged Detection Section (Crucial Contract Boundary) */}
        {(filterMode === 'all' || filterMode === 'unmanaged') && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between text-xs px-1">
              <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                <FileQuestion className="w-4 h-4 text-amber-400" />
                未托管文件检测结果 ({unmanagedMods.length})
              </span>
              <span className="text-[11px] text-amber-400/80">契约约束保护</span>
            </div>

            {/* Contract Notice Card */}
            <div className="p-3.5 rounded-2xl bg-amber-950/30 border border-amber-800/50 text-xs text-amber-200/90 leading-relaxed">
              <strong>规范约束：</strong>
              检测到未通过 SubmodHub 安装或归档指纹未匹配的散落文件。根据契约：
              <span className="underline decoration-amber-500 underline-offset-2 ml-1">
                未托管内容仅提供查看与显式收养流程，严格禁止直接执行一键卸载或盲目覆盖
              </span>
              ，以防止误删用户的自定义脚本或个人存档。
            </div>

            {unmanagedMods.map((unmanaged) => (
              <div
                key={unmanaged.mod_id}
                className="bg-slate-950/80 border border-amber-800/40 rounded-3xl p-4 space-y-3"
              >
                <div>
                  <h4 className="text-sm font-semibold text-slate-200">
                    {unmanaged.title}
                  </h4>
                  <p className="text-xs text-slate-400 mt-1">
                    发现路径: game/Submods/CoffeeTalk/ · 共 {unmanaged.file_count} 个散落文件
                  </p>
                </div>

                {/* File list preview */}
                <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800 space-y-1 text-[11px] font-mono text-slate-300">
                  {unmanaged.unmanaged_detected_files?.map((f, i) => (
                    <div key={i} className="truncate">
                      · {f}
                    </div>
                  ))}
                </div>

                {/* Adopt CTA */}
                <div className="pt-2 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">
                    状态: 孤立未托管
                  </span>
                  <button
                    onClick={() => onOpenAdoptModal(unmanaged)}
                    className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md transition-all active:scale-95"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>显式收养入库 (Adopt)</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
