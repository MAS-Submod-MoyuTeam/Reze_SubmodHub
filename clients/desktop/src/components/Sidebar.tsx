import React from 'react';
import {
  Compass,
  PackageCheck,
  Layers,
  History,
  FolderCog,
  HardDrive,
} from 'lucide-react';
import { Installation } from '../types/client';
import { computeDiskUsage } from '../diskUsage';
import { useI18n } from '../i18n';

export type ActiveTab = 'catalog' | 'installed' | 'priority' | 'operations' | 'instances';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  activeInstallation: Installation;
  installedCount: number;
  unmanagedCount: number;
  recoverableOpsCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  activeInstallation,
  installedCount,
  unmanagedCount,
  recoverableOpsCount,
}) => {
  const { t } = useI18n();
  const formatBytes = (bytes: number) => {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const diskUsage = computeDiskUsage(
    activeInstallation.disk_available_bytes,
    activeInstallation.disk_total_bytes,
  );

  const navItems = [
    {
      id: 'catalog' as ActiveTab,
      label: t('sidebar.catalogLabel'),
      icon: Compass,
      hint: t('sidebar.catalogHint'),
    },
    {
      id: 'installed' as ActiveTab,
      label: t('sidebar.installedLabel'),
      icon: PackageCheck,
      hint: t('sidebar.installedHint'),
      badge: installedCount,
      unmanagedBadge: unmanagedCount > 0 ? t('sidebar.unmanagedBadge', { count: unmanagedCount }) : null,
    },
    {
      id: 'priority' as ActiveTab,
      label: t('sidebar.priorityLabel'),
      icon: Layers,
      hint: t('sidebar.priorityHint'),
    },
    {
      id: 'operations' as ActiveTab,
      label: t('sidebar.operationsLabel'),
      icon: History,
      hint: t('sidebar.operationsHint'),
      alertBadge: recoverableOpsCount > 0 ? t('sidebar.recoverBadge', { count: recoverableOpsCount }) : null,
    },
    {
      id: 'instances' as ActiveTab,
      label: t('sidebar.instancesLabel'),
      icon: FolderCog,
      hint: t('sidebar.instancesHint'),
    },
  ];

  return (
    <aside className="hidden md:flex w-64 bg-neutral-900/90 border-r border-neutral-800 flex-col justify-between shrink-0 select-none">
      {/* Top Nav Section */}
      <div className="p-3">
        <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          {t('sidebar.console')}
        </div>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left group ${
                  isActive
                    ? 'bg-neutral-800 text-white font-semibold shadow-xs'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/40'
                } active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400`}
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
      <div className="p-3 border-t border-neutral-800 bg-neutral-900/40">
        {/* Active Instance Storage Overview */}
        <div className="px-3 py-2.5 rounded-lg bg-neutral-950/60 border border-neutral-800 text-xs">
          <div className="flex items-center justify-between text-neutral-400 mb-1.5">
            <span className="flex items-center gap-1.5 text-[11px]">
              <HardDrive className="w-3.5 h-3.5 text-neutral-400" />
              <span>{t('sidebar.storageUsage')}</span>
            </span>
            <span className="font-mono text-[11px] text-neutral-300 tabular-nums">
              {activeInstallation.disk_available_bytes != null ? t('sidebar.available', { size: formatBytes(activeInstallation.disk_available_bytes) }) : t('sidebar.capacityUnknown')}
            </span>
          </div>
          <div
            className="w-full bg-neutral-800 rounded-full h-1.5 overflow-hidden"
            role="progressbar"
            aria-label={t('sidebar.storageAria')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={diskUsage ? diskUsage.percent : undefined}
            title={diskUsage ? t('sidebar.storageTooltip', { used: formatBytes(diskUsage.usedBytes), total: formatBytes(activeInstallation.disk_total_bytes ?? 0) }) : t('sidebar.capacityUnknown')}
          >
            <div
              className="bg-emerald-500 h-full rounded-full transition-all"
              style={{ width: `${diskUsage ? diskUsage.percent : 0}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-neutral-400 mt-1 font-mono">
            <span className="truncate max-w-[120px]">{activeInstallation.label}</span>
            <span className="tabular-nums">{diskUsage ? t('sidebar.usedPercent', { percent: diskUsage.percent }) : '—'}</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
