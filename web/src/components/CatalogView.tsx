import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { ModSummary, Platform } from '../types/submodhub';
import { DeprecationNotice } from './DeprecationNotice';
import {
  Search,
  Download,
  Filter,
  Layers,
  Sparkles,
  AlertCircle,
  WifiOff,
  RefreshCw,
} from 'lucide-react';

interface CatalogViewProps {
  onSelectMod: (modId: string) => void;
  onOpenDownloadModal: (versionId: string) => void;
}

export const CatalogView: React.FC<CatalogViewProps> = ({
  onSelectMod,
  onOpenDownloadModal,
}) => {
  const {
    mods,
    versions,
    searchQuery,
    setSearchQuery,
    categoryFilter,
    setCategoryFilter,
    platformFilter,
    setPlatformFilter,
    tagFilter,
    setTagFilter,
    isOffline,
  } = useApp();

  const [isLoading, setIsLoading] = useState(false);
  const [cursorPage, setCursorPage] = useState(1);
  const pageSize = 6;

  // Filter published mods only (or all if simulated)
  const publishedMods = useMemo(() => {
    return mods.filter((m) => m.is_published);
  }, [mods]);

  // Available tags
  const allTags = useMemo(() => {
    const set = new Set<string>();
    publishedMods.forEach((m) => m.tags.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [publishedMods]);

  // Filtered mods
  const filteredMods = useMemo(() => {
    return publishedMods.filter((mod) => {
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = mod.title.toLowerCase().includes(q);
        const matchSummary = mod.summary.toLowerCase().includes(q);
        const matchAuthor = mod.author.display_name.toLowerCase().includes(q);
        const matchTags = mod.tags.some((t) => t.toLowerCase().includes(q));
        if (!matchTitle && !matchSummary && !matchAuthor && !matchTags) return false;
      }

      // Category filter
      if (categoryFilter !== 'all' && mod.category !== categoryFilter) {
        return false;
      }

      // Platform filter
      if (platformFilter !== 'all' && !mod.supported_platforms.includes(platformFilter as Platform)) {
        return false;
      }

      // Tag filter
      if (tagFilter !== 'all' && !mod.tags.includes(tagFilter)) {
        return false;
      }

      return true;
    });
  }, [publishedMods, searchQuery, categoryFilter, platformFilter, tagFilter]);

  // Cursor pagination simulation
  const paginatedMods = useMemo(() => {
    return filteredMods.slice(0, cursorPage * pageSize);
  }, [filteredMods, cursorPage]);

  const hasNextCursor = paginatedMods.length < filteredMods.length;

  const handleResetFilters = () => {
    setSearchQuery('');
    setCategoryFilter('all');
    setPlatformFilter('all');
    setTagFilter('all');
    setCursorPage(1);
  };

  const handleSimulateReload = () => {
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
    }, 400);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Offline Cached State Banner (Section 1 & 5 requirement) */}
      {isOffline && (
        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
            <div>
              <span className="font-semibold">离线缓存模式 (Offline Mode)</span>
              <span className="mx-1.5 text-amber-400">|</span>
              <span>当前正在读取本地索引快照 (6 个模组缓存)。安装仅限已验证的本地 ZIP。</span>
            </div>
          </div>
          <span className="text-[11px] font-mono text-amber-700">缓存同步: 2026-09-26 UTC</span>
        </div>
      )}

      {/* Hero / Filter Bar Header */}
      <div className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Monika After Story 模组与服饰目录
            </h1>
            <p className="text-xs text-neutral-500 mt-1">
              汇集经过 Aegis 静态安全扫描与规范审核的 MAS Submod 与 Spritepack 资源
            </p>
          </div>

          {/* Search Input */}
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <input
              type="text"
              placeholder="搜索模组名称、作者、标签..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCursorPage(1);
              }}
              className="w-full text-xs pl-9 pr-3 py-2 bg-neutral-50 border border-neutral-200 rounded-md focus:outline-none focus:border-emerald-600 focus:bg-white transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-neutral-400 hover:text-neutral-700"
              >
                清除
              </button>
            )}
          </div>
        </div>

        {/* Filter Controls Bar */}
        <div className="pt-3 border-t border-neutral-100 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">
          {/* Category Tabs */}
          <div className="flex items-center gap-1.5">
            <span className="text-neutral-400 font-medium mr-1">分类:</span>
            {[
              { id: 'all', label: '全部' },
              { id: 'submod', label: '功能模组 (Submod)' },
              { id: 'spritepack', label: '服饰配件 (Spritepack)' },
            ].map((cat) => (
              <button
                key={cat.id}
                onClick={() => {
                  setCategoryFilter(cat.id);
                  setCursorPage(1);
                }}
                className={`px-2.5 py-1 rounded text-xs transition-colors whitespace-nowrap ${
                  categoryFilter === cat.id
                    ? 'bg-neutral-900 text-white font-medium'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Platform Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-neutral-400 font-medium mr-1">平台:</span>
            {[
              { id: 'all', label: '全部' },
              { id: 'windows', label: 'Windows' },
              { id: 'android', label: 'Android' },
              { id: 'linux', label: 'Linux' },
              { id: 'macos', label: 'macOS' },
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setPlatformFilter(p.id);
                  setCursorPage(1);
                }}
                className={`px-2 py-0.5 rounded text-xs transition-colors ${
                  platformFilter === p.id
                    ? 'bg-neutral-800 text-white font-medium'
                    : 'text-neutral-600 hover:bg-neutral-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Tag Filter */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
            <span className="text-neutral-400 font-medium mr-1">标签:</span>
            <button
              onClick={() => {
                setTagFilter('all');
                setCursorPage(1);
              }}
              className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${
                tagFilter === 'all'
                  ? 'bg-neutral-200 text-neutral-900 font-medium'
                  : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              全部
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => {
                  setTagFilter(tag);
                  setCursorPage(1);
                }}
                className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${
                  tagFilter === tag
                    ? 'bg-neutral-200 text-neutral-900 font-medium'
                    : 'text-neutral-500 hover:text-neutral-800'
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Catalog List / Grid */}
      {isLoading ? (
        /* Loading Skeleton State */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-white border border-neutral-200 rounded-lg p-5 animate-pulse space-y-3">
              <div className="h-4 bg-neutral-200 rounded w-3/4" />
              <div className="h-3 bg-neutral-100 rounded w-1/2" />
              <div className="h-12 bg-neutral-100 rounded" />
              <div className="h-3 bg-neutral-100 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : paginatedMods.length === 0 ? (
        /* Empty Results State (Section 1 requirement) */
        <div className="bg-white border border-neutral-200 rounded-lg p-12 text-center space-y-3">
          <Filter className="w-8 h-8 text-neutral-300 mx-auto" />
          <h3 className="text-sm font-semibold text-neutral-800">未找到匹配的模组</h3>
          <p className="text-xs text-neutral-500 max-w-sm mx-auto">
            没有符合当前关键词或分类条件的已发布模组。你可以尝试清空筛选条件或调整搜索词。
          </p>
          <div className="pt-2">
            <button
              onClick={handleResetFilters}
              className="px-3.5 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200 transition-colors"
            >
              重置所有筛选条件
            </button>
          </div>
        </div>
      ) : (
        /* Populated Grid */
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-neutral-500 px-1">
            <span>
              显示 <strong className="font-semibold text-neutral-800 tabular-nums">{paginatedMods.length}</strong> /{' '}
              <span className="tabular-nums">{filteredMods.length}</span> 个已验证模组
            </span>
            <button
              onClick={handleSimulateReload}
              className="flex items-center gap-1 text-neutral-400 hover:text-neutral-700"
            >
              <RefreshCw className="w-3 h-3" />
              刷新
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {paginatedMods.map((mod) => {
              const latestVer = versions.find((v) => v.id === mod.latest_version_id);
              const isSpritepack = mod.category === 'spritepack';

              return (
                <div
                  key={mod.id}
                  className="bg-white border border-neutral-200 rounded-lg p-5 flex flex-col justify-between hover:border-neutral-300 transition-all group"
                >
                  <div className="space-y-2.5">
                    {/* Zero-Pill Header: Natural unboxed metadata with dot separators */}
                    <div className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                      <span className="font-medium text-emerald-700">
                        {isSpritepack ? 'Spritepack 服饰' : 'Submod 模组'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>作者: {mod.author.display_name}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">MAS {mod.mas_version_range}</span>
                    </div>

                    {/* Title */}
                    <h3
                      onClick={() => onSelectMod(mod.id)}
                      className="text-sm font-semibold text-neutral-900 group-hover:text-emerald-700 cursor-pointer transition-colors line-clamp-1"
                    >
                      {mod.title}
                    </h3>

                    {/* Summary */}
                    <p className="text-xs text-neutral-600 line-clamp-2 leading-relaxed">
                      {mod.summary}
                    </p>

                    <DeprecationNotice deprecated={latestVer?.deprecated} reason={latestVer?.deprecation_reason} />

                    {/* Tags (Zero-Pill: Clean unboxed text with subtle separator) */}
                    <div className="flex flex-wrap items-center gap-1 text-[11px] text-neutral-400 pt-1">
                      {mod.tags.map((tag, idx) => (
                        <span key={tag} className="flex items-center">
                          <span>#{tag}</span>
                          {idx < mod.tags.length - 1 && <span className="mx-1 text-neutral-300">·</span>}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Card Footer */}
                  <div className="pt-4 mt-4 border-t border-neutral-100 flex items-center justify-between text-xs">
                    <div className="text-[11px] text-neutral-500 flex items-center gap-1 font-mono">
                      {!isSpritepack && <><span>v{latestVer?.version || '1.0.0'}</span><span className="text-neutral-300">/</span></>}
                      <span className="tabular-nums">{mod.downloads_count.toLocaleString()} 次下载</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onSelectMod(mod.id)}
                        className="text-xs text-neutral-600 hover:text-neutral-900 font-medium px-2 py-1"
                      >
                        详情
                      </button>
                      <button
                        onClick={() => {
                          if (latestVer && !isSpritepack) {
                            onOpenDownloadModal(latestVer.id);
                          } else {
                            onSelectMod(mod.id);
                          }
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        下载
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Cursor Pagination (Section 1 requirement) */}
          {hasNextCursor && (
            <div className="pt-6 text-center">
              <button
                onClick={() => setCursorPage((prev) => prev + 1)}
                className="px-5 py-2 text-xs font-medium text-neutral-700 bg-white border border-neutral-200 hover:bg-neutral-50 rounded-md transition-colors"
              >
                加载更多模组 (游标分页)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
