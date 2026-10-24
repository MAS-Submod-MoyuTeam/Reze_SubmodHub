import React, { useState } from 'react';
import {
  PackageCheck,
  FileQuestion,
  RefreshCw,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  FolderOpen,
  Info,
  Gift,
  ImageIcon,
  Search,
  Filter,
  ChevronDown,
  X,
  AlertCircle,
} from 'lucide-react';
import { InstalledItem } from '../types/client';
import { Spritepack } from '../wails';
import { LoadingStatus, isActionBlocked } from '../installedLoading';

interface InstalledViewProps {
  installedMods: InstalledItem[];
  spritepacks: Spritepack[];
  hasValidInstance: boolean;
  modsStatus: LoadingStatus;
  modsError: string | null;
  isModsInitialLoading: boolean;
  isModsRefreshing: boolean;
  spritepacksStatus: LoadingStatus;
  spritepacksError: string | null;
  isSpritepacksInitialLoading: boolean;
  isSpritepacksRefreshing: boolean;
  initialSubTab?: 'managed' | 'unmanaged' | 'spritepacks';
  onRefreshInstalled: () => void;
  onRefreshSpritepacks: () => void;
  onCreateSpriteGift: (file: string) => Promise<string>;
  onDeleteSpritepack: (file: string) => Promise<void>;
  /** 规划更新只传标识：真实 ModSummary 由 App 从目录里解析，避免临时拼装假字段。 */
  onStartUpdatePlan: (modId: string, title: string) => void;
  onStartUninstallPlan: (installedItem: InstalledItem) => void;
  onStartRepairPlan: (installedItem: InstalledItem) => void;
  onOpenAdoptModal: (unmanagedItem: InstalledItem) => void;
  onInspectFiles: (item: InstalledItem) => void;
  onCheckAllUpdates: () => void;
  onVerifyIntegrity: () => void;
  isVerifying: boolean;
}

export const InstalledView: React.FC<InstalledViewProps> = ({
  installedMods,
  spritepacks,
  hasValidInstance,
  modsStatus,
  modsError,
  isModsInitialLoading,
  isModsRefreshing,
  spritepacksStatus,
  spritepacksError,
  isSpritepacksInitialLoading,
  isSpritepacksRefreshing,
  onRefreshInstalled,
  onRefreshSpritepacks,
  onCreateSpriteGift,
  onDeleteSpritepack,
  onStartUpdatePlan,
  onStartUninstallPlan,
  onStartRepairPlan,
  onOpenAdoptModal,
  onInspectFiles,
  onCheckAllUpdates,
  onVerifyIntegrity,
  isVerifying,
  initialSubTab = 'managed',
}) => {
  const [subTab, setSubTab] = useState<'managed' | 'unmanaged' | 'spritepacks'>(initialSubTab);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [creatingGiftFile, setCreatingGiftFile] = useState<string | null>(null);
  const [giftMessages, setGiftMessages] = useState<Record<string, string>>({});
  const [spriteSearch, setSpriteSearch] = useState('');
  const [spriteGroup, setSpriteGroup] = useState('');

  const safeSpritepacks = spritepacks || [];
  const spriteGroups = [...new Set(safeSpritepacks.map((item) => item.group?.trim() || '未分类'))].sort((a, b) =>
    a.localeCompare(b, 'zh')
  );
  const selectedGroup = spriteGroups.includes(spriteGroup) ? spriteGroup : '';
  const spriteQuery = spriteSearch.trim().toLocaleLowerCase();
  const visibleSpritepacks = safeSpritepacks.filter((item) => {
    const group = item.group?.trim() || '未分类';
    return (
      (!selectedGroup || group === selectedGroup) &&
      (!spriteQuery ||
        [item.name, item.author, item.file].some((value) =>
          value.toLocaleLowerCase().includes(spriteQuery)
        ))
    );
  });

  const createGift = async (file: string) => {
    setCreatingGiftFile(file);
    try {
      const message = await onCreateSpriteGift(file);
      setGiftMessages((previous) => ({ ...previous, [file]: message }));
    } finally { setCreatingGiftFile(null); }
  };

  const confirmDeleteSpritepack = async (item: Spritepack) => {
    if (!window.confirm(`确定删除「${item.name}」吗？其 JSON 和未被其他精灵包引用的图片将从游戏中移走，并保存备份。礼物文件会保留。`)) return;
    setDeletingFile(item.file);
    try { await onDeleteSpritepack(item.file); } finally { setDeletingFile(null); }
  };

  const managedMods = installedMods.filter((m) => m.is_managed);
  const unmanagedMods = installedMods.filter((m) => !m.is_managed);

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  const isCurrentTabInitialLoading = subTab === 'spritepacks' ? isSpritepacksInitialLoading : isModsInitialLoading;
  const isCurrentTabRefreshing = subTab === 'spritepacks' ? isSpritepacksRefreshing : isModsRefreshing;
  const currentTabError = subTab === 'spritepacks' ? spritepacksError : modsError;
  const currentTabStatus = subTab === 'spritepacks' ? spritepacksStatus : modsStatus;

  const isSpritepacksActionBlocked = isActionBlocked(
    spritepacksStatus,
    hasValidInstance,
    isSpritepacksInitialLoading,
    isSpritepacksRefreshing
  );

  const isModsActionBlocked = isActionBlocked(
    modsStatus,
    hasValidInstance,
    isModsInitialLoading,
    isModsRefreshing
  );

  const renderBadgeCount = (type: 'managed' | 'unmanaged' | 'spritepacks') => {
    if (!hasValidInstance) return '-';
    if (type === 'spritepacks') {
      if (spritepacksStatus === 'idle' || isSpritepacksInitialLoading) return '…';
      return spritepacks.length;
    }
    if (modsStatus === 'idle' || isModsInitialLoading) return '…';
    return type === 'managed' ? managedMods.length : unmanagedMods.length;
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-950">
      {/* Top Header & Sub-Tabs */}
      <div className="p-3 sm:p-4 border-b border-neutral-800 bg-neutral-900/50 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 max-w-full overflow-hidden">
          {/* Segmented Tab Controls */}
          <div className="flex items-center gap-1 p-1 bg-neutral-900 border border-neutral-800 rounded-lg text-xs overflow-x-auto max-w-full no-scrollbar" role="tablist">
            <button
              role="tab"
              aria-selected={subTab === 'managed'}
              onClick={() => setSubTab('managed')}
              className={`px-3 py-1 font-medium rounded-md transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                subTab === 'managed'
                  ? 'bg-neutral-800 text-white shadow-xs'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <PackageCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>已托管模组 ({renderBadgeCount('managed')})</span>
            </button>
            <button
              role="tab"
              aria-selected={subTab === 'unmanaged'}
              onClick={() => setSubTab('unmanaged')}
              className={`px-3 py-1 font-medium rounded-md transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                subTab === 'unmanaged'
                  ? 'bg-neutral-800 text-white shadow-xs'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <FileQuestion className="w-3.5 h-3.5 text-amber-400" />
              <span>未托管检测结果 ({renderBadgeCount('unmanaged')})</span>
            </button>
            <button
              role="tab"
              aria-selected={subTab === 'spritepacks'}
              onClick={() => setSubTab('spritepacks')}
              className={`px-3 py-1 font-medium rounded-md transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
                subTab === 'spritepacks'
                  ? 'bg-neutral-800 text-white'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5 text-cyan-400" />
              <span>已安装精灵包 ({renderBadgeCount('spritepacks')})</span>
            </button>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {subTab === 'spritepacks' ? (
            <button
              onClick={onRefreshSpritepacks}
              disabled={!hasValidInstance || isSpritepacksInitialLoading || isSpritepacksRefreshing}
              className="px-3 py-1.5 rounded-lg bg-neutral-800/80 hover:bg-neutral-800 border border-neutral-700/60 text-neutral-300 hover:text-white transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="重新扫描已安装精灵包"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSpritepacksRefreshing ? 'animate-spin motion-reduce:animate-none text-cyan-400' : 'text-neutral-400'}`} />
              <span>{isSpritepacksRefreshing ? '正在刷新精灵包…' : '重新扫描精灵包'}</span>
            </button>
          ) : (
            <>
              <button
                onClick={onRefreshInstalled}
                disabled={!hasValidInstance || isModsInitialLoading || isModsRefreshing}
                className="px-3 py-1.5 rounded-lg bg-neutral-800/80 hover:bg-neutral-800 border border-neutral-700/60 text-neutral-300 hover:text-white transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="重新扫描已安装模组"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isModsRefreshing ? 'animate-spin motion-reduce:animate-none text-emerald-400' : 'text-neutral-400'}`} />
                <span>{isModsRefreshing ? '正在刷新模组…' : '重新扫描模组'}</span>
              </button>
              <button
                onClick={onVerifyIntegrity}
                disabled={!hasValidInstance || isVerifying || isModsActionBlocked}
                className="px-3 py-1.5 rounded-lg bg-neutral-800/80 hover:bg-neutral-800 border border-neutral-700/60 text-neutral-300 hover:text-white transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                title={isModsActionBlocked ? (modsStatus === 'error' ? '模组扫描失败，暂无法校验完整性' : '正在读取模组列表…') : undefined}
              >
                <ShieldCheck className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin motion-reduce:animate-none text-emerald-400' : 'text-neutral-400'}`} />
                <span>{isVerifying ? '全量比对哈希中...' : '校验文件完整性'}</span>
              </button>
              <button
                onClick={onCheckAllUpdates}
                disabled={!hasValidInstance || isModsActionBlocked}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors flex items-center gap-1.5 shadow-xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                title={isModsActionBlocked ? (modsStatus === 'error' ? '模组扫描失败，暂无法检查更新' : '正在读取模组列表…') : undefined}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>检查所有模组更新</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4" aria-busy={isCurrentTabInitialLoading || isCurrentTabRefreshing}>
        {/* No valid MAS instance prompt */}
        {!hasValidInstance ? (
          <div className="py-20 text-center text-neutral-400 flex flex-col items-center justify-center gap-2">
            <div className="w-12 h-12 rounded-full bg-neutral-900 flex items-center justify-center border border-neutral-800">
              <AlertCircle className="w-6 h-6 text-amber-500" />
            </div>
            <p className="text-sm font-medium text-neutral-300">尚未选择或配置有效的 MAS 实例</p>
            <p className="text-xs text-neutral-500">请在顶部导航切换或前往设置配置有效的 MAS 游戏目录。</p>
          </div>
        ) : isCurrentTabInitialLoading ? (
          /* SKELETON SCREEN FOR INITIAL LOAD */
          <div className="space-y-4" aria-live="polite">
            <div className="flex items-center gap-2 text-xs text-neutral-400 bg-neutral-900/40 p-2.5 rounded-lg border border-neutral-800/60">
              <RefreshCw className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none text-emerald-400 shrink-0" />
              <span>{subTab === 'spritepacks' ? '正在读取已安装精灵包…' : '正在读取已安装模组…'}</span>
            </div>

            {subTab === 'spritepacks' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="flex gap-3.5 p-3.5 bg-neutral-900/40 border border-neutral-800/60 rounded-xl animate-pulse motion-reduce:animate-none">
                    <div className="w-24 h-24 shrink-0 bg-neutral-800/60 rounded-lg" />
                    <div className="flex-1 space-y-2 py-1">
                      <div className="h-4 bg-neutral-800/80 rounded w-3/4" />
                      <div className="h-3 bg-neutral-800/60 rounded w-1/2" />
                      <div className="h-3 bg-neutral-800/40 rounded w-2/5" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="p-4 bg-neutral-900/40 border border-neutral-800/60 rounded-xl animate-pulse motion-reduce:animate-none flex items-center justify-between gap-4">
                    <div className="space-y-2 flex-1">
                      <div className="h-4 bg-neutral-800/80 rounded w-1/3" />
                      <div className="h-3 bg-neutral-800/50 rounded w-1/2" />
                    </div>
                    <div className="h-8 w-24 bg-neutral-800/60 rounded-lg shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : currentTabStatus === 'error' && (subTab === 'spritepacks' ? spritepacks.length === 0 : (subTab === 'managed' ? managedMods.length === 0 : unmanagedMods.length === 0)) ? (
          /* FULL ERROR STATE WHEN NO DATA AVAILABLE */
          <div className="py-16 text-center text-neutral-400 flex flex-col items-center justify-center gap-3">
            <div className="w-12 h-12 rounded-full bg-rose-950/40 flex items-center justify-center border border-rose-900/60">
              <AlertTriangle className="w-6 h-6 text-rose-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-neutral-200">
                {subTab === 'spritepacks' ? '精灵包读取失败' : '已安装模组读取失败'}
              </p>
              <p className="text-xs text-neutral-400 mt-1 max-w-md break-all">{currentTabError || '未知错误'}</p>
            </div>
            <button
              onClick={subTab === 'spritepacks' ? onRefreshSpritepacks : onRefreshInstalled}
              className="mt-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white transition-colors cursor-pointer border border-neutral-700 flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>重试读取</span>
            </button>
          </div>
        ) : (
          /* REGULAR CONTENT VIEW (WITH OPTIONAL REFRESH ERROR BANNER) */
          <>
            {currentTabStatus === 'error' && (
              <div role="alert" className="mb-4 p-3 rounded-lg bg-amber-950/40 border border-amber-900/60 text-xs text-amber-200 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>刷新未成功，已保留上次读取的数据：{currentTabError}</span>
                </div>
                <button
                  onClick={subTab === 'spritepacks' ? onRefreshSpritepacks : onRefreshInstalled}
                  className="px-2.5 py-1 rounded bg-neutral-900 hover:bg-neutral-800 text-amber-300 border border-amber-800/80 shrink-0 transition-colors cursor-pointer font-medium"
                >
                  重试
                </button>
              </div>
            )}

            {subTab === 'spritepacks' && (
              <div className="space-y-4">
                {/* Filter & Search Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex w-full min-w-0 flex-col gap-3 sm:w-auto sm:flex-1 sm:flex-row sm:items-center">
                    <div className="relative w-full min-w-0 sm:max-w-md sm:flex-1">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                      <input
                        type="text"
                        value={spriteSearch}
                        onChange={(event) => setSpriteSearch(event.target.value)}
                        placeholder="搜索精灵包名称、作者或文件名..."
                        aria-label="搜索已安装精灵包"
                        className="w-full h-8 pl-9 pr-9 bg-neutral-900 border border-neutral-700/80 rounded-lg text-xs text-neutral-200 placeholder-neutral-500 focus:outline-hidden focus:border-neutral-500 transition-colors"
                      />
                      {spriteSearch && (
                        <button
                          type="button"
                          onClick={() => setSpriteSearch('')}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-neutral-500 transition-colors cursor-pointer"
                          title="清除搜索"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="relative w-full shrink-0 flex items-center sm:w-44">
                      <Filter className="w-3.5 h-3.5 absolute left-2.5 text-neutral-500 pointer-events-none" />
                      <select
                        value={selectedGroup}
                        onChange={(event) => setSpriteGroup(event.target.value)}
                        aria-label="按 group 分类筛选"
                        className="w-full h-8 pl-8 pr-8 truncate bg-neutral-900 border border-neutral-700/80 rounded-lg text-xs text-neutral-200 focus:outline-hidden focus:border-neutral-500 transition-colors appearance-none cursor-pointer"
                      >
                        <option value="">全部分类 ({spritepacks.length})</option>
                        {spriteGroups.map((group) => {
                          const count = spritepacks.filter((item) => (item.group?.trim() || '未分类') === group).length;
                          return (
                            <option key={group} value={group}>
                              {group} ({count})
                            </option>
                          );
                        })}
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 absolute right-2 text-neutral-500 pointer-events-none" />
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3 text-xs">
                    <span className="text-neutral-500 whitespace-nowrap font-mono tabular-nums">
                      显示 <span className="font-medium text-neutral-200">{visibleSpritepacks.length}</span> / {spritepacks.length}
                    </span>
                    {(spriteSearch || selectedGroup) && (
                      <button
                        type="button"
                        onClick={() => {
                          setSpriteSearch('');
                          setSpriteGroup('');
                        }}
                        className="inline-flex h-8 items-center px-2 rounded-md text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-neutral-500 transition-colors cursor-pointer"
                      >
                        重置筛选
                      </button>
                    )}
                  </div>
                </div>

                {/* Grid Area */}
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
                  {spritepacks.length === 0 && (
                    <div className="col-span-full py-16 text-center text-neutral-400 flex flex-col items-center justify-center gap-2">
                      <div className="w-12 h-12 rounded-full bg-neutral-900 flex items-center justify-center border border-neutral-800">
                        <ImageIcon className="w-6 h-6 text-neutral-500" />
                      </div>
                      <p className="text-sm font-medium text-neutral-300">当前 MAS 实例未检测到精灵包</p>
                      <p className="text-xs text-neutral-500">未扫描到 spritepacks JSON 配置文件。</p>
                    </div>
                  )}
                  {spritepacks.length > 0 && visibleSpritepacks.length === 0 && (
                    <div className="col-span-full py-16 text-center text-neutral-400 flex flex-col items-center justify-center gap-2">
                      <div className="w-12 h-12 rounded-full bg-neutral-900 flex items-center justify-center border border-neutral-800">
                        <Search className="w-6 h-6 text-neutral-500" />
                      </div>
                      <p className="text-sm font-medium text-neutral-300">没有符合条件的精灵包</p>
                      <p className="text-xs text-neutral-500">可尝试调整搜索关键词或重置分类筛选</p>
                      <button
                        type="button"
                        onClick={() => {
                          setSpriteSearch('');
                          setSpriteGroup('');
                        }}
                        className="mt-2 px-3 py-1 text-xs rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition-colors cursor-pointer"
                      >
                        清除筛选条件
                      </button>
                    </div>
                  )}
                  {visibleSpritepacks.map((item) => (
                    <div
                      key={item.file}
                      className="group flex gap-3.5 p-3.5 bg-neutral-900/60 hover:bg-neutral-900 border border-neutral-800/80 hover:border-neutral-700/80 rounded-xl transition-all shadow-xs min-w-0"
                    >
                      <div className="w-24 h-24 shrink-0 bg-neutral-950 rounded-lg border border-neutral-800/80 overflow-hidden flex items-center justify-center p-1 relative">
                        {item.preview ? (
                          <img
                            src={item.preview}
                            alt={item.name}
                            className="w-full h-full object-contain drop-shadow-xs transition-transform duration-200 group-hover:scale-105"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-1 text-neutral-600">
                            <ImageIcon className="w-6 h-6" />
                            <span className="text-[10px]">无预览</span>
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 flex flex-col justify-between">
                        <div className="space-y-1.5">
                          <div className="font-medium text-sm text-neutral-100 truncate group-hover:text-emerald-400 transition-colors" title={item.name}>
                            {item.name}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                            {item.group && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700/60 max-w-[130px] truncate" title={`分组: ${item.group}`}>
                                <FolderOpen className="w-3 h-3 text-neutral-400 shrink-0" />
                                <span className="truncate">{item.group}</span>
                              </span>
                            )}
                            <span className="px-1.5 py-0.5 rounded bg-neutral-800/60 text-neutral-400 border border-neutral-700/40">
                              {item.kind || '未知类型'}
                            </span>
                            {item.author && (
                              <span className="text-neutral-400 truncate max-w-[120px]" title={`作者: ${item.author}`}>
                                · {item.author}
                              </span>
                            )}
                          </div>
                          <div>
                            {item.complete ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                                <CheckCircle2 className="w-3 h-3 shrink-0" />
                                已完整安装
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400"
                                title={`缺失文件：\n${item.missing.join('、')}`}
                              >
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                文件不完整 ({item.missing.length})
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="mt-2.5 pt-2 flex items-center justify-between gap-2 border-t border-neutral-800/60">
                          <button
                            disabled={isSpritepacksActionBlocked || !item.complete || !item.giftname || creatingGiftFile !== null || deletingFile === item.file}
                            onClick={() => { void createGift(item.file); }}
                            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-medium disabled:bg-neutral-800 disabled:text-neutral-500 disabled:cursor-not-allowed transition-colors shadow-xs cursor-pointer"
                            title={isSpritepacksActionBlocked ? (spritepacksStatus === 'error' ? '精灵包扫描失败，暂无法创建礼物' : '正在读取精灵包…') : (!item.giftname ? '此精灵包未声明礼物名称' : `在 characters 目录创建 ${item.giftname}.gift`)}
                          >
                            <Gift className="w-3.5 h-3.5" />
                            <span>{creatingGiftFile === item.file ? '生成中…' : '创建礼物'}</span>
                          </button>
                          <button
                            disabled={isSpritepacksActionBlocked || deletingFile !== null || creatingGiftFile !== null}
                            onClick={() => { void confirmDeleteSpritepack(item); }}
                            className="p-1.5 rounded-md text-neutral-400 hover:text-rose-400 hover:bg-rose-950/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                            title={isSpritepacksActionBlocked ? (spritepacksStatus === 'error' ? '精灵包扫描失败，暂无法删除' : '正在读取精灵包…') : '删除精灵包并保留备份'}
                            aria-label={`删除 ${item.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {giftMessages[item.file] && (
                          <div role="status" className="mt-2 text-xs px-2 py-1.5 rounded-md bg-neutral-950 border border-neutral-800 text-neutral-300 flex items-start gap-1.5">
                            <Info className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                            <span className="break-all">{giftMessages[item.file]}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* SUBTAB 1: MANAGED MODS */}
            {subTab === 'managed' && (
              <div className="space-y-3">
                {managedMods.length === 0 ? (
                  <div className="p-8 text-center text-neutral-400">
                    <PackageCheck className="w-10 h-10 text-neutral-600 mx-auto mb-2" />
                    <p>当前 MAS 实例尚未安装任何托管模组。</p>
                  </div>
                ) : (
                  <>
                    {/* Desktop Table View */}
                    <div className="hidden md:block border border-neutral-800 rounded-xl overflow-hidden bg-neutral-900/60">
                      <table className="w-full text-left text-xs font-sans">
                        <thead className="bg-neutral-950/80 text-neutral-400 text-[11px] border-b border-neutral-800 uppercase tracking-wider font-medium">
                          <tr>
                            <th className="py-2.5 px-4">模组名称 / 作者</th>
                            <th className="py-2.5 px-3">已装版本</th>
                            <th className="py-2.5 px-3">最新版本</th>
                            <th className="py-2.5 px-3">优先级</th>
                            <th className="py-2.5 px-3">文件与占用</th>
                            <th className="py-2.5 px-3">完整性</th>
                            <th className="py-2.5 px-4 text-right">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-neutral-800/60">
                          {managedMods.map((item) => (
                            <tr key={item.mod_id} className="hover:bg-neutral-800/30 transition-colors">
                              {/* Name and Author */}
                              <td className="py-3 px-4">
                                <div className="font-semibold text-neutral-100">{item.title}</div>
                                <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 mt-0.5">
                                  <span>{item.author_name}</span>
                                  <span aria-hidden="true">·</span>
                                  <span>{item.category === 'submod' ? '功能模组' : '外观包'}</span>
                                </div>
                              </td>

                              {/* Installed Version */}
                              <td className="py-3 px-3 font-mono text-neutral-200">
                                {item.installed_version}
                              </td>

                              {/* Latest Version */}
                              <td className="py-3 px-3 font-mono">
                                {item.has_update ? (
                                  <span className="text-amber-400 font-semibold flex items-center gap-1">
                                    <span>{item.latest_version}</span>
                                    <span className="text-[10px] px-1 py-0.2 bg-amber-950 border border-amber-800 rounded">
                                      可更新
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-neutral-400">{item.latest_version}</span>
                                )}
                              </td>

                              {/* Priority */}
                              <td className="py-3 px-3 font-mono text-neutral-300">
                                <span className="px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-xs">
                                  优先级 {item.priority}
                                </span>
                              </td>

                              {/* File counts and size */}
                              <td className="py-3 px-3 font-mono text-neutral-400 text-[11px]">
                                <div>{item.files_count} 个托管文件</div>
                                <div className="text-neutral-400 tabular-nums">{formatBytes(item.size_bytes)}</div>
                              </td>

                              {/* Integrity Status */}
                              <td className="py-3 px-3">
                                {item.integrity_status === 'intact' ? (
                                  <span className="text-emerald-400 text-[11px] flex items-center gap-1 font-mono">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>未被改动</span>
                                  </span>
                                ) : item.integrity_status === 'modified' ? (
                                  <span className="text-amber-400 text-[11px] flex items-center gap-1 font-mono">
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                    <span>检测到外部改动</span>
                                  </span>
                                ) : (
                                  <span className="text-neutral-400 text-[11px]">待验证</span>
                                )}
                              </td>

                              {/* Actions */}
                              <td className="py-3 px-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {item.has_update && (
                                    <button
                                      disabled={isModsActionBlocked}
                                      onClick={() => onStartUpdatePlan(item.mod_id, item.title)}
                                      className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-400 hover:bg-amber-300 text-neutral-900 transition-colors shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                      title={isModsActionBlocked ? (modsStatus === 'error' ? '模组扫描失败，暂无法规划更新' : '正在读取模组列表…') : undefined}
                                    >
                                      规划更新
                                    </button>
                                  )}

                                  <button
                                    disabled={isModsActionBlocked}
                                    onClick={() => onInspectFiles(item)}
                                    className="px-2 py-1 text-xs text-neutral-300 hover:text-white hover:bg-neutral-800 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={isModsActionBlocked ? (modsStatus === 'error' ? '模组扫描失败，暂无法查看文件' : '正在读取模组列表…') : '查看该模组托管的所有本地文件路径及哈希'}
                                  >
                                    文件清单
                                  </button>

                                  <button
                                    disabled={isModsActionBlocked}
                                    onClick={() => onStartRepairPlan(item)}
                                    className="px-2 py-1 text-xs text-neutral-300 hover:text-white hover:bg-neutral-800 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={isModsActionBlocked ? (modsStatus === 'error' ? '模组扫描失败，暂无法修复' : '正在读取模组列表…') : '预览从已校验的托管材料恢复文件；覆盖前备份，缺少材料时失败'}
                                  >
                                    修复
                                  </button>

                                  <button
                                    disabled={isModsActionBlocked}
                                    onClick={() => onStartUninstallPlan(item)}
                                    className="px-2 py-1 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={isModsActionBlocked ? (modsStatus === 'error' ? '模组扫描失败，暂无法卸载' : '正在读取模组列表…') : '生成卸载计划，直接删除当前文件，不恢复安装前备份'}
                                  >
                                    卸载
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Card View */}
                    <div className="md:hidden space-y-3">
                      {managedMods.map((item) => (
                        <div
                          key={item.mod_id}
                          className="p-3.5 rounded-xl border border-neutral-800 bg-neutral-900/70 space-y-2.5"
                        >
                          {/* Top: Title, Category, Priority */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <h4 className="font-semibold text-neutral-100 text-sm break-words leading-tight">
                                {item.title}
                              </h4>
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-400 mt-1">
                                <span className="truncate max-w-[140px]">{item.author_name}</span>
                                <span aria-hidden="true">·</span>
                                <span>{item.category === 'submod' ? '功能模组' : '外观包'}</span>
                              </div>
                            </div>
                            <span className="shrink-0 px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-xs font-mono text-neutral-300">
                              优先级 {item.priority}
                            </span>
                          </div>

                          {/* Middle: Versions, Files & Integrity */}
                          <div className="grid grid-cols-2 gap-2 p-2.5 bg-neutral-950/60 rounded-lg border border-neutral-800/80 text-[11px]">
                            <div className="space-y-0.5">
                              <div className="text-neutral-500">版本状态</div>
                              <div className="font-mono text-neutral-200">已装: {item.installed_version}</div>
                              {item.has_update ? (
                                <div className="text-amber-400 font-semibold font-mono flex items-center gap-1">
                                  <span>最新: {item.latest_version}</span>
                                  <span className="text-[9px] px-1 bg-amber-950 border border-amber-800 rounded">
                                    可更新
                                  </span>
                                </div>
                              ) : (
                                <div className="text-neutral-400 font-mono">最新: {item.latest_version}</div>
                              )}
                            </div>

                            <div className="space-y-0.5">
                              <div className="text-neutral-500">文件与完整性</div>
                              <div className="text-neutral-300 font-mono">
                                {item.files_count} 个文件 · {formatBytes(item.size_bytes)}
                              </div>
                              <div>
                                {item.integrity_status === 'intact' ? (
                                  <span className="text-emerald-400 flex items-center gap-1 font-mono">
                                    <CheckCircle2 className="w-3 h-3 shrink-0" />
                                    <span>未被改动</span>
                                  </span>
                                ) : item.integrity_status === 'modified' ? (
                                  <span className="text-amber-400 flex items-center gap-1 font-mono">
                                    <AlertTriangle className="w-3 h-3 shrink-0" />
                                    <span>外部改动</span>
                                  </span>
                                ) : (
                                  <span className="text-neutral-400">待验证</span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Actions: Mobile Card Action Buttons */}
                          <div className="pt-1 flex flex-wrap items-center gap-1.5 justify-end">
                            {item.has_update && (
                              <button
                                disabled={isModsActionBlocked}
                                onClick={() => onStartUpdatePlan(item.mod_id, item.title)}
                                className="px-3 py-1.5 text-xs font-semibold rounded bg-amber-400 hover:bg-amber-300 text-neutral-900 transition-colors shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                title={isModsActionBlocked ? (modsStatus === 'error' ? '模组扫描失败，暂无法规划更新' : '正在读取模组列表…') : undefined}
                              >
                                规划更新
                              </button>
                            )}

                            <button
                              disabled={isModsActionBlocked}
                              onClick={() => onInspectFiles(item)}
                              className="px-2.5 py-1.5 text-xs text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                              title={isModsActionBlocked ? (modsStatus === 'error' ? '模组扫描失败，暂无法查看文件' : '正在读取模组列表…') : '查看该模组托管的所有本地文件路径及哈希'}
                            >
                              文件清单
                            </button>

                            <button
                              disabled={isModsActionBlocked}
                              onClick={() => onStartRepairPlan(item)}
                              className="px-2.5 py-1.5 text-xs text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                              title={isModsActionBlocked ? (modsStatus === 'error' ? '模组扫描失败，暂无法修复' : '正在读取模组列表…') : '预览从已校验的托管材料恢复文件；覆盖前备份，缺少材料时失败'}
                            >
                              修复
                            </button>

                            <button
                              disabled={isModsActionBlocked}
                              onClick={() => onStartUninstallPlan(item)}
                              className="px-2.5 py-1.5 text-xs text-rose-400 hover:text-rose-300 bg-rose-950/40 hover:bg-rose-900/60 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border border-rose-900/50"
                              title={isModsActionBlocked ? (modsStatus === 'error' ? '模组扫描失败，暂无法卸载' : '正在读取模组列表…') : '生成卸载计划，直接删除当前文件，不恢复安装前备份'}
                            >
                              卸载
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* SUBTAB 2: UNMANAGED DETECTED ITEMS */}
            {subTab === 'unmanaged' && (
              <div className="space-y-4">
                {/* Spec Compliance Banner */}
                <div className="p-4 rounded-xl bg-neutral-900 border border-neutral-800 text-xs space-y-2">
                  <div className="flex items-center gap-2 text-amber-400 font-semibold">
                    <Info className="w-4 h-4 shrink-0" />
                    <span>RezeHub 契约保护机制：未托管内容保护原则</span>
                  </div>
                  <p className="text-neutral-300 leading-relaxed">
                    依据 <code>2026-09-25-submodhub-design.md</code> 规范要求：
                    未托管内容仅提供<strong>文件查看与显式收养（Adopt）</strong>流程，<strong>不提供直接删除/卸载操作</strong>。
                    此举可绝对避免 RezeHub 客户端误删玩家手写未发布的原创代码、个人修改备份或未经登记的测试资产。
                  </p>
                </div>

                {/* Unmanaged items list */}
                {unmanagedMods.length === 0 ? (
                  <div className="p-8 text-center text-neutral-400">
                    <FileQuestion className="w-10 h-10 text-neutral-600 mx-auto mb-2" />
                    <p>当前 MAS 实例未检测到未托管的本地子模组。</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {unmanagedMods.map((item) => (
                      <div
                        key={item.mod_id}
                        className="p-4 rounded-xl bg-neutral-900/70 border border-neutral-800 flex flex-col md:flex-row md:items-center justify-between gap-4"
                      >
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-2 py-0.5 text-[10px] rounded bg-amber-950 text-amber-300 border border-amber-800 font-mono">
                              未托管发现项
                            </span>
                            {item.match_status === 'matched' && (
                              <span className="px-2 py-0.5 text-[10px] rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
                                商店可匹配: {item.match_candidates?.[0]?.title}
                              </span>
                            )}
                            {item.match_status === 'ambiguous' && (
                              <span className="px-2 py-0.5 text-[10px] rounded bg-purple-950 text-purple-300 border border-purple-800 font-mono">
                                存在多项商店候选
                              </span>
                            )}
                            <h4 className="font-semibold text-neutral-100 text-sm">{item.title}</h4>
                          </div>
                          <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                            {item.author_name} · 声明版本: {item.installed_version} · 文件数: {item.unmanaged_paths?.length || 0}
                          </p>

                          <div className="mt-2 space-y-1 font-mono text-[11px] text-neutral-400 bg-neutral-950/60 p-2.5 rounded-lg border border-neutral-800/80">
                            <div className="flex items-center justify-between text-neutral-400">
                              <span>检测到的本地路径 ({item.unmanaged_paths?.length || 0} 个文件):</span>
                              {(item.unmanaged_paths?.length || 0) > 3 && (
                                <button
                                  type="button"
                                  onClick={() => onInspectFiles(item)}
                                  className="text-emerald-400 hover:text-emerald-300 cursor-pointer font-sans text-[11px]"
                                >
                                  查看完整清单 ({item.unmanaged_paths?.length})
                                </button>
                              )}
                            </div>
                            {item.unmanaged_paths?.slice(0, 3).map((p) => (
                              <div key={p} className="text-neutral-300 truncate">
                                • {p}
                              </div>
                            ))}
                            {(item.unmanaged_paths?.length || 0) > 3 && (
                              <div className="text-neutral-500 italic text-[10px]">
                                ... 另有 {(item.unmanaged_paths?.length || 0) - 3} 个文件，可通过“检查散落散列”或点击上方查看完整清单
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0 self-end md:self-center">
                          <button
                            disabled={isModsActionBlocked}
                            onClick={() => onInspectFiles(item)}
                            className="px-3 py-1.5 text-xs text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700/80 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            title={isModsActionBlocked ? (modsStatus === 'error' ? '模组扫描失败，暂无法检查散列' : '正在读取模组列表…') : undefined}
                          >
                            检查散落散列
                          </button>
                          <button
                            disabled={isModsActionBlocked}
                            onClick={() => onOpenAdoptModal(item)}
                            className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            title={isModsActionBlocked ? (modsStatus === 'error' ? '模组扫描失败，暂无法收养' : '正在读取模组列表…') : undefined}
                          >
                            <ArrowUpRight className="w-3.5 h-3.5" />
                            <span>显式收养为托管模组 (Adopt)</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
