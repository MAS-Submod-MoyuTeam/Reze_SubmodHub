import React, { useState } from 'react';
import {
  Sliders,
  Lock,
  Unlock,
  AlertTriangle,
  Wifi,
  WifiOff,
  GitPullRequest,
  RotateCcw,
  Sparkles,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';

interface SimulateBarProps {
  isGameRunning: boolean;
  onToggleGameRunning: () => void;
  isOffline: boolean;
  onToggleOffline: () => void;
  hasExternalDrift: boolean;
  onToggleExternalDrift: () => void;
  hasDependencyBlocker: boolean;
  onToggleDependencyBlocker: () => void;
  onResetAllScenarios: () => void;
}

export const SimulateBar: React.FC<SimulateBarProps> = ({
  isGameRunning,
  onToggleGameRunning,
  isOffline,
  onToggleOffline,
  hasExternalDrift,
  onToggleExternalDrift,
  hasDependencyBlocker,
  onToggleDependencyBlocker,
  onResetAllScenarios,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="bg-neutral-900/95 border-t border-neutral-800 px-4 py-2 select-none shrink-0 z-30 transition-all text-xs">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-neutral-400 hover:text-neutral-200 transition-colors"
        >
          <Sliders className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-semibold text-neutral-300">
            契约状态机与异常场景测试器 (Contract Scenario Simulator)
          </span>
          <span className="text-[10px] text-neutral-400 font-mono">
            [点击{isExpanded ? '收起' : '展开'}]
          </span>
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
        </button>

        <div className="flex items-center gap-2">
          {/* Quick status pill tags */}
          {isGameRunning && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-mono">
              MAS 进程锁激活中
            </span>
          )}
          {hasExternalDrift && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-mono">
              哈希漂移保护激活
            </span>
          )}
          {isOffline && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800 font-mono">
              离线缓存模式
            </span>
          )}
          {hasDependencyBlocker && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 font-mono">
              依赖阻断激活
            </span>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="pt-3 mt-2 border-t border-neutral-800/80 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2 animate-in fade-in duration-150">
          {/* Scenario 1: Game Running Lock */}
          <button
            onClick={onToggleGameRunning}
            className={`p-2 rounded-lg border text-left flex flex-col justify-between transition-colors ${
              isGameRunning
                ? 'bg-amber-950/60 border-amber-700/80 text-amber-200'
                : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-xs flex items-center gap-1.5">
                {isGameRunning ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Unlock className="w-3.5 h-3.5" />}
                <span>[game_running]</span>
              </span>
              <span className="text-[10px] font-mono">{isGameRunning ? '开启' : '关闭'}</span>
            </div>
            <span className="text-[10px] leading-tight opacity-80">
              模拟 MAS 游戏正在运行，测试文件写入物理拦截
            </span>
          </button>

          {/* Scenario 2: External Change Hash Drift */}
          <button
            onClick={onToggleExternalDrift}
            className={`p-2 rounded-lg border text-left flex flex-col justify-between transition-colors ${
              hasExternalDrift
                ? 'bg-amber-950/60 border-amber-700/80 text-amber-200'
                : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-xs flex items-center gap-1.5">
                <AlertTriangle className={`w-3.5 h-3.5 ${hasExternalDrift ? 'text-amber-400' : ''}`} />
                <span>[external_change]</span>
              </span>
              <span className="text-[10px] font-mono">{hasExternalDrift ? '开启' : '关闭'}</span>
            </div>
            <span className="text-[10px] leading-tight opacity-80">
              模拟本地文件被外部编辑器篡改，测试哈希暂停保护
            </span>
          </button>

          {/* Scenario 3: Offline Mode */}
          <button
            onClick={onToggleOffline}
            className={`p-2 rounded-lg border text-left flex flex-col justify-between transition-colors ${
              isOffline
                ? 'bg-sky-950/60 border-sky-700/80 text-sky-200'
                : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-xs flex items-center gap-1.5">
                {isOffline ? <WifiOff className="w-3.5 h-3.5 text-sky-400" /> : <Wifi className="w-3.5 h-3.5" />}
                <span>[offline] 模式</span>
              </span>
              <span className="text-[10px] font-mono">{isOffline ? '开启' : '关闭'}</span>
            </div>
            <span className="text-[10px] leading-tight opacity-80">
              测试断网环境下的目录只读缓存与下载安全提示
            </span>
          </button>

          {/* Scenario 4: Dependency Missing */}
          <button
            onClick={onToggleDependencyBlocker}
            className={`p-2 rounded-lg border text-left flex flex-col justify-between transition-colors ${
              hasDependencyBlocker
                ? 'bg-rose-950/60 border-rose-800 text-rose-200'
                : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-xs flex items-center gap-1.5">
                <GitPullRequest className={`w-3.5 h-3.5 ${hasDependencyBlocker ? 'text-rose-400' : ''}`} />
                <span>[dependency_missing]</span>
              </span>
              <span className="text-[10px] font-mono">{hasDependencyBlocker ? '开启' : '关闭'}</span>
            </div>
            <span className="text-[10px] leading-tight opacity-80">
              模拟依赖库缺失，测试安装计划阻断拦截
            </span>
          </button>

          {/* Reset All */}
          <button
            onClick={onResetAllScenarios}
            className="p-2 rounded-lg border border-neutral-800 bg-neutral-950 hover:bg-neutral-850 text-neutral-400 hover:text-neutral-200 transition-colors flex flex-col justify-between text-left"
          >
            <div className="flex items-center gap-1.5 font-semibold text-xs mb-1">
              <RotateCcw className="w-3.5 h-3.5 text-neutral-400" />
              <span>重置为标准就绪状态</span>
            </div>
            <span className="text-[10px] leading-tight opacity-80">
              清除所有模拟异常，恢复安全正常流转
            </span>
          </button>
        </div>
      )}
    </div>
  );
};
