import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Filter,
  Download,
  CheckCircle2,
  ArrowUp,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { ModSummary, InstalledItem, Installation } from '../types/client';
import type { DownloadProgress } from '../../../../ui/catalog-api';
import { useLoadMoreOnScroll } from './useLoadMoreOnScroll';
import { usePaneScrolled } from './usePaneScrolled';
import { scrollPaneToTop } from './scrollToTop';
import { clampLoadedPage, visibleSubmodCount, hasMoreSubmods, loadFooterLabel, submodUnit } from './catalogPaging';

interface CatalogViewProps {
  mods: ModSummary[];
  installedMods: InstalledItem[];
  activeInstallation: Installation;
  /** 最近一次目录拉取的失败原因；null 表示上次拉取成功。没有离线快照，失败必须以独立状态呈现。 */
  catalogError: string | null;
  /**
   * 目录请求在飞（含首屏那一次）：启动时 `mods` 必然为空，所以这段窗口里列表区只能有加载骨架，
   * 不能在真实目录到达前先报「未找到符合条件的模组」。
   */
  isCatalogRefreshing: boolean;
  onReloadCatalog: () => void;
  onOpenDetail: (mod: ModSummary) => void;
  onStartInstallPlan: (mod: ModSummary) => void;
  onStartUpdatePlan: (mod: ModSummary) => void;
  installingModId: string | null;
  installProgress: DownloadProgress | null;
  /**
   * 客户端运行平台：Windows 客户端默认筛 Windows，Android 客户端默认筛 Android。
   * 目前只有这两种构建（Linux / macOS 没有发布计划）；浏览器里的 Web 目录则在
   * AppContext 里保持「全部」。
   */
  defaultPlatform?: 'windows' | 'android';
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
  defaultPlatform = 'windows',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'submod' | 'spritepack'>('all');
  const [selectedPlatform, setSelectedPlatform] = useState<'all' | 'windows' | 'android'>(defaultPlatform);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  /** 已加载页数：滚动到列表底部即 +1，目录分页与 Web 一致，不再用页码翻页。 */
  const [loadedPage, setLoadedPage] = useState(1);
  const pageSize = 6;
  /** 目录滚动容器：自动续页的观察根必须是真正滚动的元素，不能是窗口视口。 */
  const [scrollPane, setScrollPane] = useState<HTMLDivElement | null>(null);

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
      // 兼容性过滤不存在：`mas_version_range` 目前是自由文本，没有可用的版本比较规则，
      // 界面上的开关一直是禁用的。这里不写任何猜测性判断，也不留永远不会执行的死分支。
      return true;
    });
  }, [mods, selectedCategory, selectedPlatform, selectedTag, searchQuery]);

  // 页数每次渲染都按命中总数收敛：切回更宽的筛选时，页数会被夹到结果能覆盖的上限，
  // 不会把用户从没滚动加载过的条目一次塞回首屏。
  const pageCount = clampLoadedPage(loadedPage, pageSize, filteredMods.length);
  const visibleCount = visibleSubmodCount(pageCount, pageSize, filteredMods.length);
  const paginatedMods = filteredMods.slice(0, visibleCount);
  const hasNextPage = hasMoreSubmods(visibleCount, filteredMods.length);
  // 列表区有独立状态（失败 / 无匹配）时不存在可滚动的内容，也不该出现计数页脚。
  const showsList = !catalogError && filteredMods.length > 0;
  const footerLabel = loadFooterLabel(showsList ? visibleCount : 0, filteredMods.length, submodUnit);
  // 「一条目录数据都还没有、但请求在飞」就是加载中，而不是「没有匹配」：首屏请求与
  // 空目录刷新都落在这里。结论性文案只在请求真正落地后出现，否则启动时会先闪一帧
  // 「未找到符合条件的模组」再被真实目录替换。只留一个真值来源（请求在飞），
  // 不再另设「首屏是否加载过」的平行状态。
  const showsCatalogSkeleton = !catalogError && mods.length === 0 && isCatalogRefreshing;

  // 自动续页与手动「加载更多」共用同一个动作，避免两条各自演进的续页路径。
  // 只许再追加一页：观察器重挂前已经排队的回调，以及在列表里点按钮，都可能在同一批已渲染
  // 条目上各触发一次，不夹住就会出现「一次滚动叠出好几页」。
  const loadMore = useCallback(() => {
    setLoadedPage((prev) => {
      const clamped = clampLoadedPage(prev, pageSize, filteredMods.length);
      return hasMoreSubmods(visibleSubmodCount(clamped, pageSize, filteredMods.length), filteredMods.length)
        ? clamped + 1
        : clamped;
    });
  }, [filteredMods.length]);

  // 滚动进入哨兵预取区即续页；页脚的手动「加载更多」是键盘与无 IntersectionObserver 环境的兜底。
  // 「一页装不满可视区」的情况交给观察器在行数变化后重新挂载继续追加。
  const loadMoreSentinelRef = useLoadMoreOnScroll({
    hasMore: hasNextPage,
    onLoadMore: loadMore,
    loadedCount: paginatedMods.length,
    scrollRoot: scrollPane,
  });

  // 目录整体刷新后，旧页数会堆出一屏与刷新结果无关的历史条目，回到第一页。
  // 筛选不走这里：命中数一变就按新总数收敛，用户不必自己把多出来的一屏滚掉。
  const lastReloadingRef = useRef(isCatalogRefreshing);
  useEffect(() => {
    if (lastReloadingRef.current && !isCatalogRefreshing) setLoadedPage(1);
    lastReloadingRef.current = isCatalogRefreshing;
  }, [isCatalogRefreshing]);

  const resetPaging = () => setLoadedPage(1);

  const scrolled = usePaneScrolled(scrollPane);

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
                resetPaging();
              }}
              placeholder="搜索模组名称、简介、作者或标签..."
              className="w-full pl-9 pr-4 py-1.5 bg-neutral-900 border border-neutral-700/80 rounded-lg text-xs text-neutral-200 placeholder-neutral-500 focus:outline-hidden focus:border-neutral-500 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  resetPaging();
                }}
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
                resetPaging();
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
                resetPaging();
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
                resetPaging();
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
                      resetPaging();
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

            {/* Compatibility toggle。项目未定义 MAS 兼容区间的表达式语义（`>=0.12.14` 只是自由文本），
                不做猜测性解析：这个开关不参与过滤，如实禁用并标注，避免勾选后毫无效果。
                没有 state 也没有 onChange：勾不上的控件不假装自己是个开关。 */}
            <label
              title="尚未实现：兼容区间目前是自由文本，没有可用的版本比较规则"
              className="flex items-center gap-1.5 text-neutral-500 cursor-not-allowed select-none shrink-0"
            >
              <input
                type="checkbox"
                checked={false}
                disabled
                readOnly
                className="rounded bg-neutral-900 border-neutral-700 text-emerald-500 focus:ring-0 focus:outline-hidden disabled:cursor-not-allowed"
              />
              <span className="text-[11px]">匹配当前 MAS ({activeInstallation.mas_version})（暂不可用）</span>
            </label>
          </div>

          {/* Tags quick filter */}
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full no-scrollbar py-0.5">
            <span className="text-neutral-400 shrink-0">标签:</span>
            {selectedTag && (
              <button
                onClick={() => {
                  setSelectedTag(null);
                  resetPaging();
                }}
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
                  resetPaging();
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
        {/* 这个面板是目录真正的滚动容器，续页观察根必须绑定到它，而不是窗口视口。 */}
        <div ref={setScrollPane} data-testid="catalog-scroll-pane" aria-busy={showsCatalogSkeleton || undefined} className="h-full overflow-y-auto p-4 pb-20">
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
          ) : showsCatalogSkeleton ? (
            /* Loading Skeleton State: 请求落地前只摆占位卡片，不报任何结论 */
            <div className="space-y-3" data-testid="catalog-loading-skeleton" role="status">
              <div className="flex items-center gap-2 text-xs text-neutral-400 bg-neutral-900/40 p-2.5 rounded-lg border border-neutral-800/60">
                <RefreshCw className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none text-emerald-400 shrink-0" aria-hidden="true" />
                <span>正在读取模组目录…</span>
              </div>
              {/* 占位卡片与真卡片同构，数量跟随真实页大小：加载完成时列表高度不会突然跳一截。 */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5" aria-hidden="true">
                {Array.from({ length: pageSize }, (_, index) => (
                  <div
                    key={index}
                    data-testid="catalog-loading-card"
                    className="bg-neutral-900/40 border border-neutral-800/60 rounded-xl p-4 flex flex-col justify-between animate-pulse motion-reduce:animate-none"
                  >
                    <div className="space-y-2.5">
                      <div className="h-4 bg-neutral-800/80 rounded w-3/4" />
                      <div className="h-3 bg-neutral-800/60 rounded w-1/2" />
                      <div className="h-3 bg-neutral-800/40 rounded w-full" />
                      <div className="h-3 bg-neutral-800/40 rounded w-2/3" />
                      <div className="h-3 bg-neutral-800/30 rounded w-1/3" />
                    </div>
                    <div className="pt-3 border-t border-neutral-800/80 flex items-center justify-between gap-2">
                      <div className="h-6 w-16 bg-neutral-800/50 rounded-md" />
                      <div className="h-6 w-20 bg-neutral-800/60 rounded-md" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : filteredMods.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 text-neutral-400">
              <Filter className="w-10 h-10 text-neutral-600 mb-3" />
              <h3 className="text-base font-semibold text-neutral-200">未找到符合条件的模组</h3>
              <p className="text-xs text-neutral-400 mt-1 max-w-sm">
                {selectedPlatform === 'all'
                  ? '请尝试修改关键词，或清除平台与标签过滤条件。'
                  : `当前只显示 ${selectedPlatform === 'windows' ? 'Windows' : 'Android'} 平台的模组，另一个平台的模组不会出现在这里。`}
              </p>
              <div className="mt-4 flex items-center gap-2">
                {selectedPlatform !== 'all' && (
                  <button
                    onClick={() => {
                      setSelectedPlatform('all');
                      resetPaging();
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-emerald-100 bg-emerald-800 hover:bg-emerald-700 rounded-lg transition-colors"
                  >
                    显示全部平台
                  </button>
                )}
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedCategory('all');
                    setSelectedPlatform('all');
                    setSelectedTag(null);
                    resetPaging();
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-neutral-200 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors"
                >
                  重置所有筛选
                </button>
              </div>
            </div>
          ) : (
            <>
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

              {/* 续页哨兵：必须留在滚动面板内部、最后一张卡片之后，滚动进入预取区即续页。
                  手动入口不放在这里——它会被卸载而失去键盘焦点；常驻的那个在页脚。 */}
              <div
                ref={loadMoreSentinelRef}
                data-testid="catalog-load-more"
                data-has-more={hasNextPage ? 'true' : 'false'}
                className="pt-4 text-center"
              />
            </>
          )}
        </div>

        {/* 悬浮刷新：只在「模组大厅」出现；刷新期间置灰并持续旋转，直到重新拉取结束。
            加载失败时隐藏，避免与空态里的「重新加载目录」按钮重复同一个入口。 */}
        {/* 悬浮控件自下而上排：刷新在下，返回顶部叠在它上方，两者都是 `w-11 h-11`，
            不会互相遮挡。返回顶部只在离开顶部后出现，滚到顶就自行收回。 */}
        {scrolled && (
          <button
            type="button"
            onClick={() => scrollPaneToTop(scrollPane)}
            aria-label="返回顶部"
            title="返回顶部"
            data-testid="catalog-back-to-top"
            className="absolute right-4 bottom-[4.5rem] z-10 w-11 h-11 rounded-full flex items-center justify-center border border-neutral-700 bg-neutral-800/95 text-neutral-300 shadow-lg transition-colors cursor-pointer hover:border-emerald-700/70 hover:bg-neutral-800 hover:text-emerald-300"
          >
            <ArrowUp className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
        {!catalogError && (
          <button
            type="button"
            onClick={onReloadCatalog}
            disabled={isCatalogRefreshing}
            aria-busy={isCatalogRefreshing || undefined}
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

      {/* 页脚：随下拉自动续页，不再翻页。全部条目早已在内存里，续页只是逐页渲染，
          所以这里只说「已渲染 / 共」，不谎报「正在加载」；失败与无匹配由列表区各自说明。 */}
      {mods.length > 0 && (
        <div
          data-testid="catalog-load-footer"
          aria-live="polite"
          className="min-h-[3rem] h-auto border-t border-neutral-800 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400 bg-neutral-900/60 select-none shrink-0"
        >
          <div>{footerLabel}</div>
          {showsList && hasNextPage ? (
            <button
              type="button"
              onClick={loadMore}
              className="px-2.5 py-1 rounded bg-neutral-800 text-neutral-200 hover:bg-neutral-700 transition-colors cursor-pointer"
            >
              加载更多
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
};
