import React, { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  Download,
  CheckCircle2,
  ExternalLink,
  Tag,
  Monitor,
  Smartphone,
  ChevronRight,
  ShieldCheck,
  RefreshCw,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { ModSummary, InstalledItem, Installation } from '../types/client';
import type { DownloadProgress } from '../../../../ui/catalog-api';

interface CatalogViewProps {
  mods: ModSummary[];
  installedMods: InstalledItem[];
  activeInstallation: Installation;
  /** 最近一次目录拉取的失败原因；null 表示上次拉取成功。没有离线快照，失败必须以独立状态呈现。 */
  catalogError: string | null;
  /** 目录是否正在重新拉取，用于禁用重试入口。 */
  isCatalogRefreshing: boolean;
  onReloadCatalog: () => void;
  onOpenDetail: (mod: ModSummary) => void;
  onStartInstallPlan: (mod: ModSummary) => void;
  onStartUpdatePlan: (mod: ModSummary) => void;
  installingModId: string | null;
  installProgress: DownloadProgress | null;
}

export const CatalogView: React.FC<CatalogViewProps> = ({
  mods,
  installedMods,
  activeInstallation,
  catalogError,
  isCatalogRefreshing,
  onReloadCatalog,
  onOpenDetail,
  onStartInstallPlan,
  onStartUpdatePlan,
  installingModId,
  installProgress,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'submod' | 'spritepack'>('all');
  const [selectedPlatform, setSelectedPlatform] = useState<'all' | 'windows' | 'android'>('all');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [onlyCompatible, setOnlyCompatible] = useState(false);
  const [cursor, setCursor] = useState<number>(0);
  const pageSize = 6;

  // Extract all unique tags
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    mods.forEach((m) => m.tags.forEach((t) => tags.add(t)));
    return Array.from(tags);
  }, [mods]);

  // Filtered mods
  const filteredMods = useMemo(() => {
    return mods.filter((mod) => {
      // Category filter
      if (selectedCategory !== 'all' && mod.category !== selectedCategory) {
        return false;
      }
      // Platform filter
      if (selectedPlatform !== 'all' && !mod.supported_platforms.includes(selectedPlatform)) {
        return false;
      }
      // Tag filter
      if (selectedTag && !mod.tags.includes(selectedTag)) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = mod.title.toLowerCase().includes(q);
        const matchSummary = mod.summary.toLowerCase().includes(q);
        const matchAuthor = mod.author.display_name.toLowerCase().includes(q);
        const matchTags = mod.tags.some((t) => t.toLowerCase().includes(q));
        if (!matchTitle && !matchSummary && !matchAuthor && !matchTags) {
          return false;
        }
      }
      // Compatibility with MAS version
      if (onlyCompatible) {
        // e.g., activeInstallation is v0.12.14
        if (mod.mas_version_range.includes('0.12.10') && activeInstallation.mas_version.includes('0.12.15')) {
          return true;
        }
      }
      return true;
    });
  }, [mods, selectedCategory, selectedPlatform, selectedTag, searchQuery, onlyCompatible, activeInstallation]);

  const paginatedMods = filteredMods.slice(cursor, cursor + pageSize);
  const hasNextPage = cursor + pageSize < filteredMods.length;
  const hasPrevPage = cursor > 0;

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-950">
      {/* Top Filter & Search Header */}
      <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          {/* Search bar */}
          <div className="relative w-full sm:max-w-md sm:flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCursor(0);
              }}
              placeholder="搜索模组名称、简介、作者或标签..."
              className="w-full pl-9 pr-4 py-1.5 bg-neutral-900 border border-neutral-700/80 rounded-lg text-xs text-neutral-200 placeholder-neutral-500 focus:outline-hidden focus:border-neutral-500 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-neutral-400 hover:text-neutral-200"
              >
                ✕
              </button>
            )}
          </div>

          {/* Category Tabs (Segmented Button Controls) */}
          <div className="flex items-center gap-1 p-1 bg-neutral-900 border border-neutral-800 rounded-lg text-xs overflow-x-auto max-w-full no-scrollbar shrink-0" role="tablist">
            <button
              onClick={() => {
                setSelectedCategory('all');
                setCursor(0);
              }}
              className={`px-3 py-1 font-medium rounded-md transition-colors shrink-0 cursor-pointer ${
                selectedCategory === 'all'
                  ? 'bg-neutral-800 text-white shadow-xs'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              全部类型
            </button>
            <button
              onClick={() => {
                setSelectedCategory('submod');
                setCursor(0);
              }}
              className={`px-3 py-1 font-medium rounded-md transition-colors shrink-0 cursor-pointer ${
                selectedCategory === 'submod'
                  ? 'bg-neutral-800 text-white shadow-xs'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              功能模组 (submod)
            </button>
            <button
              onClick={() => {
                setSelectedCategory('spritepack');
                setCursor(0);
              }}
              className={`px-3 py-1 font-medium rounded-md transition-colors shrink-0 cursor-pointer ${
                selectedCategory === 'spritepack'
                  ? 'bg-neutral-800 text-white shadow-xs'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              服装与外观 (spritepack)
            </button>
          </div>
        </div>

        {/* Secondary Filter Row: Platform, Compatibility, Tags */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs pt-1 border-t border-neutral-800/60">
          <div className="flex items-center justify-between sm:justify-start gap-3 flex-wrap">
            {/* Platform Selector */}
            <div className="flex items-center gap-1.5 text-neutral-400">
              <span className="shrink-0">目标平台:</span>
              <div className="flex items-center gap-1">
                {(['all', 'windows', 'android'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setSelectedPlatform(p);
                      setCursor(0);
                    }}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                      selectedPlatform === p
                        ? 'bg-neutral-800 text-white border border-neutral-700'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {p === 'all' ? '全部' : p === 'windows' ? 'Windows' : 'Android'}
                  </button>
                ))}
              </div>
            </div>

            {/* Compatibility toggle */}
            <label className="flex items-center gap-1.5 cursor-pointer text-neutral-300 hover:text-white select-none shrink-0">
              <input
                type="checkbox"
                checked={onlyCompatible}
                onChange={(e) => setOnlyCompatible(e.target.checked)}
                className="rounded bg-neutral-900 border-neutral-700 text-emerald-500 focus:ring-0 focus:outline-hidden"
              />
              <span className="text-[11px]">匹配当前 MAS ({activeInstallation.mas_version})</span>
            </label>
          </div>

          {/* Tags quick filter */}
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full no-scrollbar py-0.5">
            <span className="text-neutral-400 shrink-0">标签:</span>
            {selectedTag && (
              <button
                onClick={() => setSelectedTag(null)}
                className="text-[11px] text-emerald-400 hover:underline shrink-0 cursor-pointer"
              >
                清除 ({selectedTag})
              </button>
            )}
            {allTags.slice(0, 7).map((tag) => (
              <button
                key={tag}
                onClick={() => {
                  setSelectedTag(selectedTag === tag ? null : tag);
                  setCursor(0);
                }}
                className={`text-[11px] px-2 py-0.5 rounded transition-colors shrink-0 cursor-pointer ${
                  selectedTag === tag
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Catalog Grid View */}
      <div className="relative flex-1 min-h-0">
        {/* `pb-20` reserves the strip the floating refresh control occupies, so the
            last row's right-most card buttons stay reachable instead of sitting
            underneath it. */}
        <div className="h-full overflow-y-auto p-4 pb-20">
          {catalogError ? (
            /* Load Failure State: 没有离线快照，失败必须与「无匹配结果」区分开 */
            <div className="h-full flex flex-col items-center justify-center text-center p-8">
              <AlertCircle className="w-10 h-10 text-amber-500 mb-3" />
              <h3 className="text-base font-semibold text-neutral-100">目录加载失败</h3>
              <p className="text-xs text-neutral-400 mt-1 max-w-sm">
                无法从服务器读取已发布目录：{catalogError}。项目不提供离线缓存快照，请检查网络后重新加载。
              </p>
              <button
                onClick={onReloadCatalog}
                disabled={isCatalogRefreshing}
                className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-200 bg-amber-950/70 border border-amber-800/80 hover:bg-amber-900/60 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{isCatalogRefreshing ? '重新加载中…' : '重新加载目录'}</span>
              </button>
            </div>
          ) : filteredMods.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-neutral-400">
              <Filter className="w-10 h-10 text-neutral-600 mb-3" />
              <h3 className="text-base font-semibold text-neutral-200">未找到符合条件的模组</h3>
              <p className="text-xs text-neutral-400 mt-1 max-w-sm">
                请尝试修改关键词，或清除平台与标签过滤条件。
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('all');
                  setSelectedPlatform('all');
                  setSelectedTag(null);
                  setOnlyCompatible(false);
                }}
                className="mt-4 px-3 py-1.5 text-xs font-medium text-neutral-200 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
              >
                重置所有筛选
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {paginatedMods.map((mod) => {
                const installed = installedMods.find((i) => i.mod_id === mod.id);
                const hasUpdate = installed && installed.has_update;

                return (
                  <div
                    key={mod.id}
                    className="bg-neutral-900/80 border border-neutral-800 hover:border-neutral-700 rounded-xl p-4 flex flex-col justify-between transition-colors group"
                  >
                    {/* Card Content Top */}
                    <div>
                      {/* Header: Title and Category info */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="truncate">
                          <h4
                            onClick={() => onOpenDetail(mod)}
                            className="font-semibold text-neutral-100 hover:text-emerald-400 text-sm truncate cursor-pointer transition-colors"
                            title={mod.title}
                          >
                            {mod.title}
                          </h4>
                          {/* Unboxed clean metadata (Zero-Pill rule) */}
                          <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 mt-0.5">
                            <span>{mod.author.display_name}</span>
                            <span aria-hidden="true">·</span>
                            <span>{mod.category === 'submod' ? '功能模组' : '外观礼包'}</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">{mod.latest_version}</span>
                          </div>
                        </div>

                        {/* Installation Status Indicator */}
                        {installed ? (
                          hasUpdate ? (
                            <span className="text-[11px] text-amber-400 font-medium shrink-0 font-mono">
                              可更新 ({installed.installed_version})
                            </span>
                          ) : (
                            <span className="text-[11px] text-emerald-400 font-medium shrink-0 flex items-center gap-1 font-mono">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>已安装</span>
                            </span>
                          )
                        ) : null}
                      </div>

                      {/* Summary prose */}
                      <p className="text-xs text-neutral-400 line-clamp-2 leading-relaxed mb-3">
                        {mod.summary}
                      </p>

                      {/* Unboxed Metadata row: MAS compatibility, size, downloads */}
                      <div className="flex items-center gap-2 text-[11px] text-neutral-400 font-mono mb-3">
                        <span>MAS {mod.mas_version_range}</span>
                        <span aria-hidden="true">/</span>
                        <span className="tabular-nums">{formatBytes(mod.size_bytes)}</span>
                        <span aria-hidden="true">/</span>
                        <span className="tabular-nums">{mod.downloads_count} 次安装</span>
                      </div>

                      {/* Tags row (Clean typographic tags with separators) */}
                      <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 truncate mb-4">
                        {mod.tags.slice(0, 3).map((t, idx) => (
                          <React.Fragment key={t}>
                            <span className="hover:text-neutral-300 transition-colors">#{t}</span>
                            {idx < Math.min(mod.tags.length, 3) - 1 && (
                              <span className="text-neutral-400" aria-hidden="true">
                                ·
                              </span>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>

                    {/* Card Bottom Actions */}
                    <div className="pt-3 border-t border-neutral-800/80 flex items-center justify-between gap-2">
                      <button
                        onClick={() => onOpenDetail(mod)}
                        className="px-2.5 py-1.5 text-xs text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded-md transition-colors"
                      >
                        查看详情
                      </button>

                      {installed ? (
                        hasUpdate ? (
                          <button
                            onClick={() => onStartUpdatePlan(mod)}
                            className="px-3 py-1.5 text-xs font-semibold text-neutral-900 bg-amber-400 hover:bg-amber-300 rounded-md transition-colors flex items-center gap-1.5 shadow-xs"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>更新至 {mod.latest_version}</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => onOpenDetail(mod)}
                            className="px-3 py-1.5 text-xs font-medium text-neutral-300 bg-neutral-800 hover:bg-neutral-700/80 rounded-md transition-colors"
                          >
                            已是最新
                          </button>
                        )
                      ) : (
                          <button
                            onClick={() => {
                              if (mod.category === 'spritepack') {
                                onOpenDetail(mod);
                              } else {
                                onStartInstallPlan(mod);
                              }
                            }}
                            disabled={installingModId !== null}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-md transition-colors flex items-center gap-1.5 shadow-xs"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>{installingModId === mod.id ? installProgress?.stage === 'downloading' ? `下载 ${Math.round(installProgress.received / installProgress.total * 100)}%` : installProgress?.stage === 'verifying' ? '校验中…' : '安装中…' : '安装'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 悬浮刷新：只在「模组大厅」出现；刷新期间置灰并持续旋转，直到重新拉取结束。
            加载失败时隐藏，避免与空态里的「重新加载目录」按钮重复同一个入口。 */}
        {!catalogError && (
          <button
            type="button"
            onClick={onReloadCatalog}
            disabled={isCatalogRefreshing}
            aria-busy={isCatalogRefreshing}
            aria-label="刷新模组目录"
            title={isCatalogRefreshing ? '正在刷新模组目录…' : '刷新模组目录'}
            className={`absolute right-4 bottom-4 z-10 w-11 h-11 rounded-full flex items-center justify-center border shadow-lg transition-colors ${
              isCatalogRefreshing
                ? 'cursor-not-allowed border-neutral-800 bg-neutral-900/80 text-neutral-600'
                : 'cursor-pointer border-neutral-700 bg-neutral-800/95 text-neutral-300 hover:border-emerald-700/70 hover:bg-neutral-800 hover:text-emerald-300'
            }`}
          >
            <RefreshCw
              className={`w-4 h-4 ${isCatalogRefreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      {/* Pagination Footer */}
      <div className="min-h-[3rem] h-auto border-t border-neutral-800 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400 bg-neutral-900/60 select-none shrink-0">
        <div>
          共 <span className="font-mono text-neutral-200 tabular-nums">{filteredMods.length}</span> 个模组
          {filteredMods.length > 0 && (
            <span>
              （显示第 <span className="font-mono text-neutral-200 tabular-nums">{cursor + 1}</span> 至{' '}
              <span className="font-mono text-neutral-200 tabular-nums">
                {Math.min(cursor + pageSize, filteredMods.length)}
              </span> 个）
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setCursor(Math.max(0, cursor - pageSize))}
            disabled={!hasPrevPage}
            className="px-3 py-1.5 rounded bg-neutral-800 text-neutral-200 hover:bg-neutral-700 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
          >
            上一页
          </button>
          <button
            onClick={() => setCursor(cursor + pageSize)}
            disabled={!hasNextPage}
            className="px-3 py-1.5 rounded bg-neutral-800 text-neutral-200 hover:bg-neutral-700 disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
};
