import React, { useEffect, useState } from 'react';
import { Events, Window } from '@wailsio/runtime';
import {
  FolderGit2,
  HardDrive,
  AlertTriangle,
  Wifi,
  WifiOff,
  Minus,
  Square,
  Copy,
  X,
  ChevronDown,
  CheckCircle2,
  Lock,
  Play,
} from 'lucide-react';
import { Installation } from '../types/client';

interface TitleBarProps {
  installations: Installation[];
  activeInstallationId: string;
  onSelectInstallation: (id: string) => void;
  isGameRunning: boolean;
  isOffline: boolean;
  onToggleGameRunning: () => void;
  onToggleOffline: () => void;
  onOpenInstancesView: () => void;
  onLaunchGame: () => Promise<void>;
  isLaunchingGame: boolean;
  isAndroid?: boolean;
  onOpenAppUpdate?: () => void;
  hasAppUpdate?: boolean;
}

/**
 * True when the page runs inside the native Wails shell. In a plain browser
 * preview (and in unit tests) the runtime window API must not be called.
 */
function hasNativeWindow(): boolean {
  if (typeof window === 'undefined') return false;
  const wails = (window as unknown as { _wails?: { environment?: unknown } })._wails;
  return Boolean(wails?.environment);
}

export const TitleBar: React.FC<TitleBarProps> = ({
  installations,
  activeInstallationId,
  onSelectInstallation,
  isGameRunning,
  isOffline,
  onToggleGameRunning,
  onToggleOffline,
  onOpenInstancesView,
  onLaunchGame,
  isLaunchingGame,
  isAndroid = false,
  onOpenAppUpdate,
  hasAppUpdate = false,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isMaximised, setIsMaximised] = useState(false);
  const activeInst = installations.find((i) => i.id === activeInstallationId) || {
    label: '尚未选择 MAS', path_hint: '', is_valid: false, mas_version: '',
  };

  // Keep the maximise/restore icon in sync with native window state changes
  // (custom buttons, Win+Up/Win+Down, snap layouts, double-clicking the bar).
  useEffect(() => {
    if (isAndroid || !hasNativeWindow()) return;

    let active = true;
    void Window.IsMaximised()
      .then((value) => {
        if (active) setIsMaximised(value);
      })
      .catch(() => {
        // The window may be closing; the icon state is not critical.
      });

    const offMaximise = Events.On(Events.Types.Common.WindowMaximise, () => setIsMaximised(true));
    const offUnmaximise = Events.On(Events.Types.Common.WindowUnMaximise, () => setIsMaximised(false));
    const offRestore = Events.On(Events.Types.Common.WindowRestore, () => setIsMaximised(false));

    return () => {
      active = false;
      offMaximise();
      offUnmaximise();
      offRestore();
    };
  }, [isAndroid]);

  const runWindowCommand = (command: () => Promise<void>) => {
    if (isAndroid || !hasNativeWindow()) return;
    void command().catch(() => {
      // Ignore races with window shutdown.
    });
  };

  const handleMinimise = () => runWindowCommand(() => Window.Minimise());
  const handleToggleMaximise = () => runWindowCommand(() => Window.ToggleMaximise());
  const handleClose = () => runWindowCommand(() => Window.Close());

  // Any element the Wails drag region must ignore counts as interactive here:
  // native hit-testing already excludes `.wails-no-drag`, but the DOM double
  // click listener still bubbles from those areas up to the header.
  const HEADER_INTERACTIVE_SELECTOR =
    'button, a, input, select, textarea, [role="button"], .wails-no-drag';

  const handleHeaderDoubleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (isAndroid) return;
    const target = event.target as HTMLElement | null;
    if (!target || typeof target.closest !== 'function') return;
    if (target.closest(HEADER_INTERACTIVE_SELECTOR)) return;
    handleToggleMaximise();
  };

  return (
    <header
      className={`min-h-[calc(2.5rem+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)] bg-neutral-900 border-b border-neutral-800 flex items-center justify-between px-3 select-none shrink-0 z-40 text-xs ${isAndroid ? '' : 'wails-drag'}`}
      onDoubleClick={handleHeaderDoubleClick}
    >
      {/* Left zone: Brand and Version */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-5 h-5 rounded bg-emerald-600 flex items-center justify-center text-white font-bold text-xs shadow-xs">
            S
          </div>
          <span className="font-semibold text-neutral-100 tracking-tight text-sm">
            SubmodHub
          </span>
          {onOpenAppUpdate ? (
            <button
              type="button"
              onClick={onOpenAppUpdate}
              className={`wails-no-drag flex items-center gap-1 text-[10px] font-mono transition-colors hover:text-neutral-200 ${
                hasAppUpdate ? 'text-emerald-400 font-semibold' : 'text-neutral-500'
              }`}
              title={`点击检查更新 (当前 v${__APP_VERSION__})`}
              aria-label={`检查应用更新，当前版本 v${__APP_VERSION__}`}
            >
              <span>v{__APP_VERSION__}</span>
              {hasAppUpdate && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>
          ) : (
            <span
              className="text-[10px] text-neutral-500 font-mono"
              title={`SubmodHub v${__APP_VERSION__}`}
            >
              v{__APP_VERSION__}
            </span>
          )}
          <span className="hidden text-[11px] text-neutral-400 font-mono lg:inline">
            {isAndroid ? 'Android' : 'PC Client'}
          </span>
        </div>

        <div className="h-3.5 w-px bg-neutral-800 mx-0.5 sm:mx-1 shrink-0" />

        {/* MAS Instance Selector Dropdown */}
        <div className="relative min-w-0">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="wails-no-drag flex items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1 rounded bg-neutral-800/80 hover:bg-neutral-800 border border-neutral-700/60 text-neutral-200 transition-colors text-xs max-w-full"
            title={activeInst.path_hint}
          >
            <HardDrive className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            <span className="font-medium max-w-[90px] sm:max-w-[140px] lg:max-w-[180px] truncate">
              {activeInst.label}
            </span>
            {activeInst.is_valid && <span className="text-[10px] px-1 py-0.2 bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 rounded font-mono shrink-0">
              {activeInst.mas_version}
            </span>}
            <ChevronDown className="w-3 h-3 text-neutral-400 shrink-0" />
          </button>

          {dropdownOpen && (
            <>
              <div
                className="wails-no-drag fixed inset-0 z-40"
                onClick={() => setDropdownOpen(false)}
              />
              <div className="wails-no-drag absolute left-0 mt-1 w-80 max-w-[calc(100vw-1.5rem)] bg-neutral-900 border border-neutral-700 rounded-md shadow-xl py-1 z-50">
                <div className="px-3 py-1.5 text-[11px] font-medium text-neutral-400 border-b border-neutral-800">
                  选择或管理 MAS 游戏实例
                </div>
                {installations.map((inst) => (
                  <button
                    key={inst.id}
                    onClick={() => {
                      onSelectInstallation(inst.id);
                      setDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left flex items-start justify-between hover:bg-neutral-800 transition-colors ${
                      inst.id === activeInstallationId ? 'bg-neutral-800/50' : ''
                    }`}
                  >
                    <div className="truncate pr-2">
                      <div className="flex items-center gap-1.5 font-medium text-neutral-200 text-xs truncate">
                        <span>{inst.label}</span>
                        <span className="text-[10px] text-neutral-400 font-mono">
                          {inst.mas_version}
                        </span>
                      </div>
                      <div className="text-[10px] text-neutral-500 font-mono truncate mt-0.5">
                        {inst.path_hint}
                      </div>
                    </div>
                    {inst.id === activeInstallationId && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    )}
                  </button>
                ))}
                <div className="border-t border-neutral-800 mt-1 pt-1 px-1">
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      onOpenInstancesView();
                    }}
                    className="w-full text-left px-2.5 py-1.5 text-xs text-emerald-400 hover:bg-neutral-800 rounded flex items-center gap-1.5"
                  >
                    <FolderGit2 className="w-3.5 h-3.5" />
                    <span>添加或重新授权 MAS 游戏目录...</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        {!isAndroid && (
          <button
            onClick={() => void onLaunchGame()}
            disabled={!activeInst.is_valid || isLaunchingGame}
            className="wails-no-drag flex h-[26px] shrink-0 items-center gap-1.5 rounded bg-emerald-700 px-2.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            title={activeInst.is_valid ? `启动 ${activeInst.label} 的 DDLC.exe` : '请先选择有效的 MAS 实例'}
            aria-label={isLaunchingGame ? '启动中' : '启动游戏'}
          >
            <Play className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{isLaunchingGame ? '启动中…' : '启动游戏'}</span>
          </button>
        )}
      </div>

      {/* Middle zone: Real-time Guards & Indicators */}
      <div className="hidden xl:flex items-center gap-3">
        {/* Game Process Guard */}
        {!activeInst.is_valid ? (
          <div className="flex items-center gap-1.5 text-amber-400 text-[11px]">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>MAS 状态未验证</span>
          </div>
        ) : isGameRunning ? (
          <div
            onClick={onToggleGameRunning}
            className="wails-no-drag flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-950/70 border border-amber-800/80 text-amber-300 cursor-pointer hover:bg-amber-900/60 transition-colors"
            title="点击可模拟退出游戏。当 MAS 运行时，为防止 Ren'Py 运行时损坏，写操作被物理锁定。"
          >
            <Lock className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            <span className="font-medium text-[11px]">MAS 进程运行中 (写操作锁定)</span>
          </div>
        ) : (
          <div
            onClick={onToggleGameRunning}
            className="wails-no-drag flex items-center gap-1.5 text-neutral-400 text-[11px] cursor-pointer hover:text-neutral-200"
            title="点击可模拟启动 MAS 游戏测试进程锁"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            <span>游戏未运行 · 就绪</span>
          </div>
        )}

        {/* Offline / Online Network Indicator */}
        <div
          onClick={onToggleOffline}
          className="wails-no-drag flex items-center gap-1.5 text-neutral-400 text-[11px] cursor-pointer hover:text-neutral-200"
          title="点击可模拟切换离线/在线状态"
        >
          {isOffline ? (
            <span className="flex items-center gap-1 text-amber-400 font-medium">
              <WifiOff className="w-3.5 h-3.5" />
              <span>离线缓存</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-neutral-400">
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              <span>API v1 在线</span>
            </span>
          )}
        </div>
      </div>

      {/* Right zone: Window Controls */}
      <div className="flex items-center">
        {!isAndroid && (
          <div className="wails-no-drag flex items-center">
            <button
              type="button"
              onClick={handleMinimise}
              className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
              title="最小化"
              aria-label="最小化"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleToggleMaximise}
              className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
              title={isMaximised ? '还原' : '最大化'}
              aria-label={isMaximised ? '还原' : '最大化'}
            >
              {isMaximised ? (
                <Copy className="w-3.5 h-3.5 -scale-x-100" />
              ) : (
                <Square className="w-3 h-3" />
              )}
            </button>
            <button
              type="button"
              onClick={handleClose}
              className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-red-600 transition-colors"
              title="关闭"
              aria-label="关闭"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
