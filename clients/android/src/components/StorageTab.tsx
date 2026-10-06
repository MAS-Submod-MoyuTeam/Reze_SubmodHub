import React from 'react';
import { Installation } from '../types/submodhub';
import { formatBytes, formatDate } from '../utils/formatters';
import {
  FolderKey,
  ShieldCheck,
  AlertTriangle,
  HardDrive,
  RefreshCw,
  Plus,
  RotateCcw,
  Check,
  FileText,
  Activity,
  Smartphone,
  ExternalLink,
} from 'lucide-react';

interface StorageTabProps {
  installations: Installation[];
  currentInstallationId: string;
  onSelectInstallation: (id: string) => void;
  onReauthorizeSaf: (id: string) => void;
  onDiscoverInstallations: () => void;
  onToggleGameRunning: () => void;
  onRestoreBackup: (backupName: string) => void;
  onExportLogs: () => void;
}

export const StorageTab: React.FC<StorageTabProps> = ({
  installations,
  currentInstallationId,
  onSelectInstallation,
  onReauthorizeSaf,
  onDiscoverInstallations,
  onToggleGameRunning,
  onRestoreBackup,
  onExportLogs,
}) => {
  const currentInst =
    installations.find((i) => i.id === currentInstallationId) || installations[0];

  const isGranted = currentInst.permission_state === 'granted';

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-4 space-y-4 pb-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
          <FolderKey className="w-4 h-4 text-rose-400" />
          Android 存储授权与多实例
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          遵循 Android SAF (Storage Access Framework) 持久授权规范
        </p>
      </div>

      {/* SAF Authorization Card */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-3xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Smartphone className="w-3.5 h-3.5 text-blue-400" />
            SAF 持久文档树授权状态
          </h3>
          {isGranted ? (
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" />
              PERSISTENT GRANTED
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-semibold flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              REVOKED / EXPIRED
            </span>
          )}
        </div>

        <div className="p-3 bg-slate-900 rounded-2xl border border-slate-800 font-mono text-[11px] space-y-1.5">
          <div className="text-slate-400">
            挂载目标: <span className="text-slate-200">{currentInst.label}</span>
          </div>
          <div className="text-slate-400 break-all">
            SAF URI: <span className="text-slate-300">{currentInst.saf_tree_uri}</span>
          </div>
          <div className="text-slate-400">
            文件系统路径: <span className="text-slate-300">{currentInst.path_hint}</span>
          </div>
          <div className="text-slate-400 flex justify-between">
            <span>剩余可用存储空间:</span>
            <span className="text-emerald-400 font-semibold">{formatBytes(currentInst.free_space_bytes)}</span>
          </div>
        </div>

        {/* Contract Rule note */}
        <p className="text-[11px] text-slate-400 leading-relaxed">
          <strong>规范要求：</strong>未验证或已撤销 SAF 授权的目录，严格禁止执行任何写入事务。
          若系统升级或清除权限，需重新调起 SAF 授权界面。
        </p>

        {!isGranted && (
          <button
            onClick={() => onReauthorizeSaf(currentInst.id)}
            className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md transition-all active:scale-95"
          >
            <FolderKey className="w-4 h-4" />
            <span>重新调起 Android SAF 授予权限 (Reauthorize SAF)</span>
          </button>
        )}
      </div>

      {/* Multi-Instance Management Card */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-3xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5 text-rose-400" />
            MAS 游戏实例选择与管理
          </h3>
          <button
            onClick={onDiscoverInstallations}
            className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            <span>自动扫描</span>
          </button>
        </div>

        <div className="space-y-2">
          {installations.map((inst) => {
            const isSelected = inst.id === currentInstallationId;
            const isInstGranted = inst.permission_state === 'granted';

            return (
              <div
                key={inst.id}
                onClick={() => onSelectInstallation(inst.id)}
                className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-slate-900 border-rose-500/60 shadow-md'
                    : 'bg-slate-950/60 border-slate-800 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-200 truncate">
                        {inst.label}
                      </span>
                      {isSelected && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-500 text-white text-[9px] font-bold">
                          当前活跃
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono mt-1 truncate">
                      {inst.path_hint}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1">
                      <span>MAS v{inst.mas_version}</span>
                      <span>·</span>
                      <span>已装 {inst.installed_mods_count} 模组</span>
                      <span>·</span>
                      <span>{formatBytes(inst.free_space_bytes)} 可用</span>
                    </div>
                  </div>

                  <div className="shrink-0 ml-2">
                    {isInstGranted ? (
                      <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                        <Check className="w-3 h-3" /> 授权有效
                      </span>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onReauthorizeSaf(inst.id);
                        }}
                        className="px-2 py-1 rounded bg-amber-500/20 text-amber-300 text-[10px] font-semibold border border-amber-500/40 hover:bg-amber-500/30"
                      >
                        重新授权
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Runtime Game Lock Safeguard */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-3xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-amber-400" />
            游戏进程运行保护 (game_running)
          </h3>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
              currentInst.is_running
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
            }`}
          >
            {currentInst.is_running ? 'MAS RUNNING' : 'MAS IDLE'}
          </span>
        </div>
        <p className="text-[11px] text-slate-400 leading-normal">
          契约规范：当 MAS 处于运行状态时，客户端必须拦截写入操作，避免文件损坏与内存冲突。
        </p>
        <button
          onClick={onToggleGameRunning}
          className={`w-full py-2 rounded-xl text-xs font-medium border transition-colors flex items-center justify-center gap-1.5 ${
            currentInst.is_running
              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800 hover:bg-emerald-900/50'
              : 'bg-amber-950/40 text-amber-300 border-amber-800 hover:bg-amber-900/50'
          }`}
        >
          <span>{currentInst.is_running ? '模拟关闭 MAS 游戏进程' : '模拟启动 MAS 游戏 (测试进程阻断)'}</span>
        </button>
      </div>

      {/* Atomic Backups & Recovery */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-3xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <RotateCcw className="w-3.5 h-3.5 text-teal-400" />
            隔离备份与灾难恢复 (RestoreBackup)
          </h3>
        </div>

        <div className="space-y-2 text-xs">
          <div className="p-3 bg-slate-900 rounded-2xl border border-slate-800 flex items-center justify-between">
            <div>
              <div className="font-semibold text-slate-200">
                wd_300_upgrade_snapshot
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                Wardrobe Deluxe 升级前快照 · 52 个文件
              </div>
            </div>
            <button
              onClick={() => onRestoreBackup('wd_300_upgrade_snapshot')}
              className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-teal-300 text-[11px] font-medium border border-slate-700 transition-colors"
            >
              回滚此快照
            </button>
          </div>
        </div>

        <button
          onClick={onExportLogs}
          className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium border border-slate-800 transition-colors flex items-center justify-center gap-1.5"
        >
          <FileText className="w-3.5 h-3.5" />
          <span>导出完整诊断日志包 (ExportLogs)</span>
        </button>
      </div>
    </div>
  );
};
