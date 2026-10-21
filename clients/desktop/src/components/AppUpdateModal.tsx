import React from 'react';
import {
  Download,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  ExternalLink,
  ShieldAlert,
  X,
} from 'lucide-react';
import { AppUpdateState } from '../types/client';

interface AppUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateState: AppUpdateState;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  onCancelUpdate: () => void;
  onOpenSettings?: () => void;
  isAndroid?: boolean;
}

export const AppUpdateModal: React.FC<AppUpdateModalProps> = ({
  isOpen,
  onClose,
  updateState,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  onCancelUpdate,
  onOpenSettings,
  isAndroid = false,
}) => {
  if (!isOpen) return null;

  const isDownloading = updateState.status === 'downloading' || updateState.status === 'verifying';
  const isReady = updateState.status === 'ready';
  const isAvailable = updateState.status === 'available';
  const isChecking = updateState.status === 'checking';
  const isFailed = updateState.status === 'failed';
  const isInstalling = updateState.status === 'installing' || updateState.status === 'awaiting_user';

  const formatBytes = (bytes: number) => {
    if (bytes <= 0) return '0 MB';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/40">
          <div className="flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-sm font-semibold text-white">RezeHub 软件自更新</h2>
              <p className="text-xs text-neutral-400">
                当前版本: v{updateState.current_version}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-200 p-1 rounded-lg hover:bg-neutral-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 space-y-4 text-xs">
          {/* Status Message */}
          {isAvailable && (
            <div className="p-3 bg-emerald-950/30 border border-emerald-800/50 rounded-lg flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-emerald-300">
                  发现新版本 v{updateState.latest_version}
                </div>
                <div className="text-neutral-400 mt-1">
                  文件大小: {formatBytes(updateState.total_bytes)}
                </div>
              </div>
            </div>
          )}

          {isDownloading && (
            <div className="space-y-2 p-3 bg-neutral-950/40 border border-neutral-800 rounded-lg">
              <div className="flex items-center justify-between text-neutral-300 font-medium">
                <span>{updateState.status === 'verifying' ? '正在校验完整性 (SHA-256)...' : '正在下载新版本...'}</span>
                <span className="font-mono">{Math.round(updateState.download_progress * 100)}%</span>
              </div>
              <div className="w-full bg-neutral-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-emerald-500 h-full transition-all duration-200"
                  style={{ width: `${Math.min(100, Math.max(0, updateState.download_progress * 100))}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-neutral-400 font-mono">
                <span>{formatBytes(updateState.downloaded_bytes)}</span>
                <span>{formatBytes(updateState.total_bytes)}</span>
              </div>
            </div>
          )}

          {isReady && (
            <div className="p-3 bg-emerald-950/30 border border-emerald-800/50 rounded-lg flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-emerald-300">新版本准备就绪</div>
                <div className="text-neutral-400 mt-1">
                  {isAndroid
                    ? 'APK 已通过校验并暂存，点击下方按钮唤起系统安装器确认更新。'
                    : '已完成 SHA-256 完整性校验，点击“立即替换并重启”将由独立更新器完成无损替换与备份保护。'}
                </div>
              </div>
            </div>
          )}

          {isInstalling && (
            <div role="status" className="p-3 bg-neutral-950/40 border border-neutral-800 rounded-lg text-neutral-300">
              {updateState.status === 'awaiting_user'
                ? '系统安装器已打开，请在系统界面确认更新。'
                : '正在启动更新器，请稍候。应用将在更新后重新启动。'}
            </div>
          )}

          {(isFailed || (isReady && updateState.error)) && (
            <div className="p-3 bg-rose-950/30 border border-rose-800/50 rounded-lg flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-rose-300">更新失败</div>
                <div className="text-rose-400/80 mt-1 font-mono">{updateState.error}</div>
              </div>
            </div>
          )}

          {updateState.status === 'idle' && (
            <div className="text-center py-6 text-neutral-400">
              <p>当前已是最新版本或尚未检查更新。</p>
            </div>
          )}

          {/* Release Notes */}
          {updateState.release_notes && (
            <div className="space-y-1.5">
              <div className="font-medium text-neutral-300">更新日志 (Release Notes):</div>
              <div className="p-3 bg-neutral-950/60 border border-neutral-800 rounded-lg max-h-40 overflow-y-auto text-neutral-300 text-[11px] whitespace-pre-wrap font-mono">
                {updateState.release_notes}
              </div>
            </div>
          )}

          {/* Android Permissions Hint */}
          {isAndroid && updateState.requires_install_permission && (
            <div className="p-2.5 bg-amber-950/20 border border-amber-800/40 rounded-lg flex items-center justify-between text-amber-300/90 text-[11px]">
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                <span>需要允许此应用安装未知应用权限</span>
              </span>
              {onOpenSettings && (
                <button
                  onClick={onOpenSettings}
                  className="px-2 py-1 bg-amber-900/40 hover:bg-amber-900/60 border border-amber-700/50 rounded text-amber-200 transition-colors"
                >
                  去授权
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-3 border-t border-neutral-800 bg-neutral-950/40 flex items-center justify-end gap-2">
          {isDownloading ? (
            <button
              onClick={onCancelUpdate}
              className="px-3 py-1.5 rounded-lg border border-neutral-700 text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors text-xs font-medium"
            >
              取消下载
            </button>
          ) : isInstalling ? (
            <button
              disabled
              className="px-3 py-1.5 rounded-lg bg-neutral-800 text-neutral-400 text-xs font-medium cursor-wait"
            >
              {updateState.status === 'awaiting_user' ? '等待系统安装确认' : '正在启动更新…'}
            </button>
          ) : isReady ? (
            <button
              onClick={onInstallUpdate}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors text-xs font-medium flex items-center gap-1.5 shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isAndroid ? '启动系统安装' : '立即替换并重启'}</span>
            </button>
          ) : isAvailable ? (
            <button
              onClick={onDownloadUpdate}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors text-xs font-medium flex items-center gap-1.5 shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>下载更新</span>
            </button>
          ) : (
            <button
              onClick={onCheckUpdate}
              disabled={isChecking}
              className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white transition-colors text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin text-emerald-400' : ''}`} />
              <span>{isChecking ? '正在检查...' : '检查更新'}</span>
            </button>
          )}

          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40 transition-colors text-xs"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
