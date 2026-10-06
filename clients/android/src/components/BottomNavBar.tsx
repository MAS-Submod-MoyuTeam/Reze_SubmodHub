import React from 'react';
import { Compass, Layers, Activity, FolderKey } from 'lucide-react';

export type NavTabId = 'catalog' | 'installed' | 'operations' | 'storage';

interface BottomNavBarProps {
  activeTab: NavTabId;
  onSelectTab: (tab: NavTabId) => void;
  hasUpdatesCount?: number;
  hasRunningOperations?: boolean;
  hasPermissionIssue?: boolean;
}

export const BottomNavBar: React.FC<BottomNavBarProps> = ({
  activeTab,
  onSelectTab,
  hasUpdatesCount = 0,
  hasRunningOperations = false,
  hasPermissionIssue = false,
}) => {
  const tabs = [
    {
      id: 'catalog' as NavTabId,
      label: '发现',
      icon: Compass,
      badge: null,
    },
    {
      id: 'installed' as NavTabId,
      label: '已装',
      icon: Layers,
      badge: hasUpdatesCount > 0 ? `${hasUpdatesCount}更新` : null,
      badgeColor: 'bg-rose-500 text-white',
    },
    {
      id: 'operations' as NavTabId,
      label: '任务',
      icon: Activity,
      badge: hasRunningOperations ? '运行中' : null,
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse',
    },
    {
      id: 'storage' as NavTabId,
      label: '实例/SAF',
      icon: FolderKey,
      badge: hasPermissionIssue ? '!' : null,
      badgeColor: 'bg-amber-500 text-slate-950 font-bold',
    },
  ];

  return (
    <nav className="shrink-0 h-16 bg-slate-950/95 backdrop-blur-md border-t border-slate-800/80 px-2 grid grid-cols-4 items-center z-20">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const IconComponent = tab.icon;

        return (
          <button
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            className={`flex flex-col items-center justify-center min-h-[48px] py-1 relative rounded-xl transition-all ${
              isActive
                ? 'text-rose-400 font-semibold'
                : 'text-slate-400 hover:text-slate-200 active:scale-95'
            }`}
          >
            {/* Active Pill Accent Indicator */}
            {isActive && (
              <span className="absolute top-1 w-8 h-1 bg-rose-500 rounded-full" />
            )}

            <div className="relative mt-1">
              <IconComponent className={`w-5 h-5 transition-transform ${isActive ? 'scale-110' : ''}`} />

              {/* Notification Badges */}
              {tab.badge && (
                <span
                  className={`absolute -top-1.5 -right-3 px-1 py-0.2 rounded-full text-[9px] font-bold leading-tight ${tab.badgeColor}`}
                >
                  {tab.badge}
                </span>
              )}
            </div>

            <span className="text-[11px] tracking-tight mt-1">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
};
