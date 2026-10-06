import React, { useState } from 'react';
import {
  FolderGit2,
  HardDrive,
  ShieldCheck,
  AlertTriangle,
  Wifi,
  WifiOff,
  Minus,
  Square,
  X,
  ChevronDown,
  CheckCircle2,
  Lock,
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
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const activeInst = installations.find((i) => i.id === activeInstallationId) || installations[0];

  return (
    <header className="h-10 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between px-3 select-none shrink-0 z-40 text-xs">
      {/* Left zone: Brand and Version */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-emerald-600 flex items-center justify-center text-white font-bold text-xs shadow-xs">
            S
          </div>
          <span className="font-semibold text-neutral-100 tracking-tight text-sm">
            SubmodHub
          </span>
          <span className="text-[11px] text-neutral-400 font-mono">
            PC Client
          </span>
        </div>

        <div className="h-3.5 w-px bg-neutral-800 mx-1" />

        {/* MAS Instance Selector Dropdown */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 px-2.5 py-1 rounded bg-neutral-800/80 hover:bg-neutral-800 border border-neutral-700/60 text-neutral-200 transition-colors text-xs"
            title={activeInst.path_hint}
          >
            <HardDrive className="w-3.5 h-3.5 text-neutral-400" />
            <span className="font-medium max-w-[180px] truncate">
              {activeInst.label}
            </span>
            {activeInst.is_valid && <span className="text-[10px] px-1 py-0.2 bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 rounded font-mono">
              {activeInst.mas_version}
            </span>}
            <ChevronDown className="w-3 h-3 text-neutral-400" />
          </button>

          {dropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setDropdownOpen(false)}
              />
              <div className="absolute left-0 mt-1 w-80 bg-neutral-900 border border-neutral-700 rounded-md shadow-xl py-1 z-50">
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
      </div>

      {/* Middle zone: Real-time Guards & Indicators */}
      <div className="flex items-center gap-3">
        {/* Game Process Guard */}
        {!activeInst.is_valid ? (
          <div className="flex items-center gap-1.5 text-amber-400 text-[11px]">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>MAS 状态未验证</span>
          </div>
        ) : isGameRunning ? (
          <div
            onClick={onToggleGameRunning}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-950/70 border border-amber-800/80 text-amber-300 cursor-pointer hover:bg-amber-900/60 transition-colors"
            title="点击可模拟退出游戏。当 MAS 运行时，为防止 Ren'Py 运行时损坏，写操作被物理锁定。"
          >
            <Lock className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
            <span className="font-medium text-[11px]">MAS 进程运行中 (写操作锁定)</span>
          </div>
        ) : (
          <div
            onClick={onToggleGameRunning}
            className="flex items-center gap-1.5 text-neutral-400 text-[11px] cursor-pointer hover:text-neutral-200"
            title="点击可模拟启动 MAS 游戏测试进程锁"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            <span>游戏未运行 · 就绪</span>
          </div>
        )}

        {/* Offline / Online Network Indicator */}
        <div
          onClick={onToggleOffline}
          className="flex items-center gap-1.5 text-neutral-400 text-[11px] cursor-pointer hover:text-neutral-200"
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
        <button
          className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
          title="最小化"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors"
          title="最大化"
        >
          <Square className="w-3 h-3" />
        </button>
        <button
          className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-red-600 transition-colors"
          title="关闭"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
