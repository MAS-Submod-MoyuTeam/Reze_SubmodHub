import React from 'react';
import { ShoppingBag, PackageCheck, Layers, ListTodo, Settings2 } from 'lucide-react';
import type { ActiveTab } from './Sidebar';

export interface MobileNavBarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  updatesCount?: number;
  activeOperationsCount?: number;
}

export const MobileNavBar: React.FC<MobileNavBarProps> = ({
  activeTab,
  onTabChange,
  updatesCount = 0,
  activeOperationsCount = 0,
}) => {
  const tabs: Array<{ id: ActiveTab; label: string; icon: React.ReactNode; badge?: number }> = [
    {
      id: 'catalog',
      label: '商店',
      icon: <ShoppingBag className="w-5 h-5" />,
    },
    {
      id: 'installed',
      label: '已安装',
      icon: <PackageCheck className="w-5 h-5" />,
      badge: updatesCount > 0 ? updatesCount : undefined,
    },
    {
      id: 'priority',
      label: '优先级',
      icon: <Layers className="w-5 h-5" />,
    },
    {
      id: 'operations',
      label: '任务',
      icon: <ListTodo className="w-5 h-5" />,
      badge: activeOperationsCount > 0 ? activeOperationsCount : undefined,
    },
    {
      id: 'instances',
      label: '实例',
      icon: <Settings2 className="w-5 h-5" />,
    },
  ];

  return (
    <nav className="md:hidden shrink-0 z-40 bg-zinc-950/95 backdrop-blur border-t border-zinc-800 pb-[env(safe-area-inset-bottom,0px)]">
      <div className="grid grid-cols-5 h-14">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center justify-center gap-1 relative transition-colors ${
                isActive ? 'text-primary font-medium' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <div className="relative">
                {tab.icon}
                {tab.badge !== undefined && (
                  <span className="absolute -top-1 -right-2 px-1 min-w-3.5 h-3.5 bg-primary text-black text-[9px] font-bold rounded-full flex items-center justify-center">
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className="text-[11px] leading-none">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
