import React from 'react';
import { ShieldAlert, ShieldCheck, RefreshCw, ExternalLink } from 'lucide-react';

export interface StorageAccessBannerProps {
  isAndroid: boolean;
  storageState: 'granted' | 'denied' | 'unsupported' | 'error' | string;
  onRequestAccess: () => void;
  onRefreshStatus: () => void;
  isRefreshing?: boolean;
}

export const StorageAccessBanner: React.FC<StorageAccessBannerProps> = ({
  isAndroid,
  storageState,
  onRequestAccess,
  onRefreshStatus,
  isRefreshing = false,
}) => {
  if (!isAndroid || storageState === 'granted') {
    return null;
  }

  if (storageState === 'unsupported') {
    return (
      <div className="bg-amber-950/60 border border-amber-800/80 rounded-lg p-3 mx-4 my-2 text-amber-200 text-xs flex items-center gap-2.5">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
        <div>
          <span className="font-semibold">权限不受支持：</span>
          <span>当前系统版本不支持所有文件访问权限管理（需要 Android 11+ / API 30+）。</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-red-950/70 border border-red-800/80 rounded-lg p-3 mx-4 my-2 text-red-100 shadow-md">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-start gap-2.5">
          <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="text-xs space-y-0.5">
            <div className="font-medium text-red-200 flex items-center gap-1.5">
              <span>需要“所有文件访问权限”</span>
              <span className="px-1.5 py-0.2 bg-red-900/80 rounded text-[10px] text-red-300 font-mono">
                MANAGE_EXTERNAL_STORAGE
              </span>
            </div>
            <p className="text-red-300/90 leading-relaxed">
              MAS 模组位于共享存储中。当前已支持远程商店浏览，但必须获得文件访问权限后，方可扫描、安装或卸载本地模组。
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          <button
            type="button"
            onClick={onRefreshStatus}
            disabled={isRefreshing}
            className="px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center gap-1 transition-colors border border-zinc-700 disabled:opacity-50"
            title="重新检查权限状态"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>刷新状态</span>
          </button>

          <button
            type="button"
            onClick={onRequestAccess}
            className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium flex items-center gap-1 transition-colors shadow-sm"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>去设置授权</span>
          </button>
        </div>
      </div>
    </div>
  );
};
