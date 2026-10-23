import React from 'react';
import {
  Compass,
  PackageCheck,
  Layers,
  History,
  FolderCog,
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
  onOpenAppUpdate?: () => void;
  hasAppUpdate?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  activeInstallation,
  installedCount,
  unmanagedCount,
  recoverableOpsCount,
  onOpenAppUpdate,
  hasAppUpdate = false,
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
      label: '模组优先级',
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
    <aside className="hidden md:flex w-64 bg-neutral-900/90 border-r border-neutral-800 flex-col justify-between shrink-0 select-none">
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
              {activeInstallation.disk_available_bytes != null ? `${formatBytes(activeInstallation.disk_available_bytes)} 可用` : '容量未知'}
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

        {/* Build identity & App update trigger */}
        <div className="flex items-center justify-between px-1 text-[10px] font-mono text-neutral-500">
          <span>RezeHub</span>
          {onOpenAppUpdate ? (
            <button
              onClick={onOpenAppUpdate}
              className={`flex items-center gap-1 hover:text-neutral-300 transition-colors ${
                hasAppUpdate ? 'text-emerald-400 font-semibold' : ''
              }`}
              title={`点击检查更新 (当前 v${__APP_VERSION__})`}
            >
              <span>v{__APP_VERSION__}</span>
              {hasAppUpdate && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
            </button>
          ) : (
            <span title={`RezeHub v${__APP_VERSION__}`}>v{__APP_VERSION__}</span>
          )}
        </div>
      </div>
    </aside>
  );
};
