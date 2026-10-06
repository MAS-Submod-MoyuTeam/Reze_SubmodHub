import React from 'react';
import { Installation } from '../types/submodhub';
import { HardDrive, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';

interface TopAppBarProps {
  currentInstallation: Installation;
  onOpenInstancePicker: () => void;
  onRefreshCatalog: () => void;
  isRefreshing?: boolean;
  offlineMode?: boolean;
}

export const TopAppBar: React.FC<TopAppBarProps> = ({
  currentInstallation,
  onOpenInstancePicker,
  onRefreshCatalog,
  isRefreshing = false,
  offlineMode = false,
}) => {
  const isPermissionOk = currentInstallation.permission_state === 'granted';

  return (
    <header className="shrink-0 h-14 px-4 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/80 flex items-center justify-between z-20">
      {/* Brand & MAS Instance Selector */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          onClick={onOpenInstancePicker}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-850 hover:bg-slate-800 border border-slate-750 transition-colors text-left group max-w-[210px]"
          title="点击切换 MAS 游戏实例或检查 SAF 授权"
        >
          <div className="shrink-0 w-6 h-6 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
            <HardDrive className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="text-xs font-semibold text-slate-200 truncate">
                {currentInstallation.label}
              </span>
              {isPermissionOk ? (
                <span title="SAF 权限有效" className="shrink-0 flex items-center">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                </span>
              ) : (
                <span title="SAF 权限已失效" className="shrink-0 flex items-center">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-400 font-mono truncate">
              {isPermissionOk ? `MAS v${currentInstallation.mas_version}` : '目录未授权'}
            </p>
          </div>
        </button>
      </div>

      {/* Action Zone: Refresh */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={onRefreshCatalog}
          disabled={isRefreshing}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 active:scale-95 transition-all"
          title="刷新目录 (RefreshCatalog)"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-rose-400' : ''}`} />
        </button>

      </div>
    </header>
  );
};
