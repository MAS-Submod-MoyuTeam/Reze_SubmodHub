import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { ModSummary, Platform } from '../types/submodhub';
import { DeprecationNotice } from './DeprecationNotice';
import { formatVersionLabel } from './versionHistory';
import { useLoadMoreOnScroll } from './useLoadMoreOnScroll';
import { fetchTagCatalog, type TagGroup } from '../../../ui/tags-api';
import { buildTagFilterModel, childTagsFor } from './tagFilters';
import {
  Search,
  Download,
  Filter,
  Layers,
  Sparkles,
  AlertCircle,
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
    catalogLoading,
    catalogError,
    reloadCatalog,
  } = useApp();

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

  // 标签目录是筛选区的第一来源：顺序与主/子层级都由管理员维护。
  // 读取失败时回退到上面的聚合结果，筛选功能不因此不可用。
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  useEffect(() => {
    let cancelled = false;
    const base = `${((import.meta as any).env?.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
    fetchTagCatalog(base)
      .then((catalog) => {
        if (!cancelled) setTagGroups(catalog.groups);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const tagFilterModel = useMemo(() => buildTagFilterModel(tagGroups, allTags), [tagGroups, allTags]);
  const childTagOptions = useMemo(() => childTagsFor(tagFilterModel, tagFilter), [tagFilterModel, tagFilter]);

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

  // 自动续页与手动按钮共用同一个动作，避免两条各自演进的续页路径。
  const loadMore = useCallback(() => setCursorPage((prev) => prev + 1), []);

  // 滚动进入哨兵预取区即续页；手动按钮只作为无障碍 / 无 IntersectionObserver 的兜底。
  // 代价是首屏会把「视口 + 240px 预取区」填满后才停（observer 首次 observe 就会回调一次），
  // 实际可见条数因此多于 pageSize——这是填满视口而非留白的有意取舍。
  const loadMoreSentinelRef = useLoadMoreOnScroll({
    hasMore: hasNextCursor,
    onLoadMore: loadMore,
    loadedCount: paginatedMods.length,
  });

  // 刷新会整体替换目录，旧游标会留下一屏与刷新结果无关的历史堆积。
  const handleReloadCatalog = async () => {
    await reloadCatalog();
    setCursorPage(1);
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setCategoryFilter('all');
    setPlatformFilter('all');
    setTagFilter('all');
    setCursorPage(1);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Hero / Filter Bar Header */}
      <div className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">
              Monika After Story 模组与服饰目录
            </h1>
            <p className="text-xs text-neutral-500 mt-1">
              汇集经过静态安全扫描与规范审核的 MAS Submod 与 Spritepack 资源
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

          {/* Tag Filter: 主标签一行；选中带子标签的主标签后再展开子标签行 */}
          <div className="space-y-1">
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
              {tagFilterModel.mains.map((tag) => (
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
              {tagFilterModel.stale.map((tag) => (
                <button
                  key={tag}
                  onClick={() => {
                    setTagFilter(tag);
                    setCursorPage(1);
                  }}
                  title="该标签已不在标签目录中"
                  className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${
                    tagFilter === tag
                      ? 'bg-neutral-200 text-neutral-900 font-medium'
                      : 'text-neutral-400 hover:text-neutral-700'
                  }`}
                >
                  #{tag}
                </button>
              ))}
            </div>
            {childTagOptions.length > 0 ? (
              <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 pl-9">
                <span className="text-neutral-400 text-xs">子标签:</span>
                {childTagOptions.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => {
                      setTagFilter(tag);
                      setCursorPage(1);
                    }}
                    className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${
                      tagFilter === tag
                        ? 'bg-emerald-700 text-white font-medium'
                        : 'text-neutral-500 hover:text-emerald-700'
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Catalog List / Grid */}
      {catalogLoading ? (
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
      ) : catalogError ? (
        /* Load Failure State: 没有离线快照，失败必须与「无结果」区分开 */
        <div className="bg-white border border-amber-200 rounded-lg p-12 text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
          <h3 className="text-sm font-semibold text-neutral-800">目录加载失败</h3>
          <p className="text-xs text-neutral-500 max-w-md mx-auto">
            无法从服务器读取已发布目录：{catalogError}。项目不提供离线缓存快照，请检查网络后重新加载。
          </p>
          <div className="pt-2">
            <button
              onClick={() => void handleReloadCatalog()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-amber-800 bg-amber-50 hover:bg-amber-100 rounded border border-amber-200 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              重新加载目录
            </button>
          </div>
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
            <span aria-live="polite">
              显示 <strong className="font-semibold text-neutral-800 tabular-nums">{paginatedMods.length}</strong> /{' '}
              <span className="tabular-nums">{filteredMods.length}</span> 个已验证模组
            </span>
            <button
              onClick={() => void handleReloadCatalog()}
              disabled={catalogLoading}
              className="flex items-center gap-1 text-neutral-400 hover:text-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
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
                      {!isSpritepack && latestVer?.version && <><span>{formatVersionLabel(latestVer.version)}</span><span className="text-neutral-300">/</span></>}
                      <span className="tabular-nums" title={`描述签发尝试：${mod.download_attempts || 0}；内置服务端传输：${mod.downloads_count}。客户端报告并非独立交付审计。`}>{isSpritepack ? `${mod.downloads_count.toLocaleString()} 次服务端传输` : `${(mod.client_reported_downloads || 0).toLocaleString()} 次客户端报告完成`}</span>
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
          <div ref={loadMoreSentinelRef} className="pt-6 text-center">
            {hasNextCursor && (
              <>
                <button
                  onClick={loadMore}
                  className="px-5 py-2 text-xs font-medium text-neutral-700 bg-white border border-neutral-200 hover:bg-neutral-50 rounded-md transition-colors"
                >
                  加载更多模组 (游标分页)
                </button>
                <p className="mt-2 text-[11px] text-neutral-400">继续向下滚动会自动加载下一页</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
