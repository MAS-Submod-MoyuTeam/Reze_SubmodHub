import React from 'react';
import {
  Compass,
  PackageCheck,
  Layers,
  History,
  FolderCog,
  RefreshCw,
  HardDrive,
  AlertCircle,
  FileCode2,
} from 'lucide-react';
import { Installation } from '../types/client';

export type ActiveTab = 'catalog' | 'installed' | 'priority' | 'operations' | 'instances';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  activeInstallation: Installation;
  installedCount: number;
  unmanagedCount: number;
  recoverableOpsCount: number;
  onRefreshCatalog: () => void;
  isRefreshing: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  activeInstallation,
  installedCount,
  unmanagedCount,
  recoverableOpsCount,
  onRefreshCatalog,
  isRefreshing,
}) => {
  const formatBytes = (bytes: number) => {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const navItems = [
    {
      id: 'catalog' as ActiveTab,
      label: '模组大厅 / 发现',
      icon: Compass,
      hint: '浏览、筛选与获取最新发布模组',
    },
    {
      id: 'installed' as ActiveTab,
      label: '已安装模组',
      icon: PackageCheck,
      hint: '托管版本与未托管检测',
      badge: installedCount,
      unmanagedBadge: unmanagedCount > 0 ? `${unmanagedCount} 项未托管` : null,
    },
    {
      id: 'priority' as ActiveTab,
      label: '图层与优先级',
      icon: Layers,
      hint: '调整模组覆盖次序与冲突检测',
    },
    {
      id: 'operations' as ActiveTab,
      label: '任务与原子恢复',
      icon: History,
      hint: '安装流水线与本地安全快照',
      alertBadge: recoverableOpsCount > 0 ? `${recoverableOpsCount} 待恢复` : null,
    },
    {
      id: 'instances' as ActiveTab,
      label: 'MAS 实例与授权',
      icon: FolderCog,
      hint: '管理游戏目录与路径验证',
    },
  ];

  return (
    <aside className="w-64 bg-neutral-900/90 border-r border-neutral-800 flex flex-col justify-between shrink-0 select-none">
      {/* Top Nav Section */}
      <div className="p-3">
        <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          导航控制台
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left group ${
                  isActive
                    ? 'bg-neutral-800 text-white font-semibold shadow-xs'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40'
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-emerald-400' : 'text-neutral-400 group-hover:text-neutral-300'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {item.alertBadge && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800/60 font-mono">
                      {item.alertBadge}
                    </span>
                  )}
                  {item.badge !== undefined && (
                    <span className="text-[11px] text-neutral-400 font-mono tabular-nums">
                      {item.badge}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Storage & Status Section */}
      <div className="p-3 border-t border-neutral-800 space-y-3 bg-neutral-900/40">
        {/* Active Instance Storage Overview */}
        <div className="px-3 py-2.5 rounded-lg bg-neutral-950/60 border border-neutral-800 text-xs">
          <div className="flex items-center justify-between text-neutral-400 mb-1.5">
            <span className="flex items-center gap-1.5 text-[11px]">
              <HardDrive className="w-3.5 h-3.5 text-neutral-400" />
              <span>当前存储空间</span>
            </span>
            <span className="font-mono text-[11px] text-neutral-300 tabular-nums">
              {formatBytes(activeInstallation.disk_available_bytes)} 可用
            </span>
          </div>
          <div className="w-full bg-neutral-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all"
              style={{ width: '42%' }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-neutral-400 mt-1 font-mono">
            <span className="truncate max-w-[120px]">{activeInstallation.label}</span>
            <span>已校验根目录</span>
          </div>
        </div>

        {/* Refresh Catalog Button */}
        <button
          onClick={onRefreshCatalog}
          disabled={isRefreshing}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800/80 hover:bg-neutral-800 border border-neutral-700/60 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 text-neutral-400 ${
              isRefreshing ? 'animate-spin text-emerald-400' : ''
            }`}
          />
          <span>{isRefreshing ? '正在同步云端契约...' : '刷新模组目录缓存'}</span>
        </button>
      </div>
    </aside>
  );
};
