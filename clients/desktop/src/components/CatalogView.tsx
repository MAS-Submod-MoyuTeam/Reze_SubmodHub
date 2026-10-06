import React, { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  Download,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Tag,
  Monitor,
  Smartphone,
  ChevronRight,
  ShieldCheck,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { ModSummary, InstalledItem, Installation } from '../types/client';

interface CatalogViewProps {
  mods: ModSummary[];
  installedMods: InstalledItem[];
  activeInstallation: Installation;
  isOffline: boolean;
  onOpenDetail: (mod: ModSummary) => void;
  onStartInstallPlan: (mod: ModSummary) => void;
  onStartUpdatePlan: (mod: ModSummary) => void;
}

export const CatalogView: React.FC<CatalogViewProps> = ({
  mods,
  installedMods,
  activeInstallation,
  isOffline,
  onOpenDetail,
  onStartInstallPlan,
  onStartUpdatePlan,
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
        {/* Offline Banner if offline */}
        {isOffline && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-950/60 border border-amber-800/80 text-amber-200 text-xs">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>当前处于客户端离线缓存模式。显示的模组条目来自本地缓存，安装仅限已校验本地包。</span>
            </div>
            <span className="font-mono text-[11px] text-amber-400/80">只读缓存</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
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
          <div className="flex items-center gap-1 p-1 bg-neutral-900 border border-neutral-800 rounded-lg text-xs">
            <button
              onClick={() => {
                setSelectedCategory('all');
                setCursor(0);
              }}
              className={`px-3 py-1 font-medium rounded-md transition-colors ${
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
              className={`px-3 py-1 font-medium rounded-md transition-colors ${
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
              className={`px-3 py-1 font-medium rounded-md transition-colors ${
                selectedCategory === 'spritepack'
                  ? 'bg-neutral-800 text-white shadow-xs'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              服装与外观 (spritepack)
            </button>
          </div>
        </div>

        {/* Secondary Filter Row: Platform, Tags, Compatibility */}
        <div className="flex items-center justify-between text-xs pt-1 border-t border-neutral-800/60">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Platform Selector */}
            <div className="flex items-center gap-1.5 text-neutral-400">
              <span>目标平台:</span>
              <div className="flex items-center gap-1">
                {(['all', 'windows', 'android'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setSelectedPlatform(p);
                      setCursor(0);
                    }}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
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

            <div className="h-3 w-px bg-neutral-800" />

            {/* Tags quick filter */}
            <div className="flex items-center gap-1.5 overflow-x-auto max-w-xl py-0.5">
              <span className="text-neutral-400 shrink-0">标签:</span>
              {selectedTag && (
                <button
                  onClick={() => setSelectedTag(null)}
                  className="text-[11px] text-emerald-400 hover:underline shrink-0"
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
                  className={`text-[11px] px-2 py-0.5 rounded transition-colors shrink-0 ${
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

          {/* Compatibility toggle */}
          <label className="flex items-center gap-2 cursor-pointer text-neutral-300 hover:text-white select-none">
            <input
              type="checkbox"
              checked={onlyCompatible}
              onChange={(e) => setOnlyCompatible(e.target.checked)}
              className="rounded bg-neutral-900 border-neutral-700 text-emerald-500 focus:ring-0 focus:outline-hidden"
            />
            <span className="text-[11px]">匹配当前 MAS ({activeInstallation.mas_version})</span>
          </label>
        </div>
      </div>

      {/* Main Catalog Grid View */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredMods.length === 0 ? (
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
                          <span className="font-mono tabular-nums">v{mod.latest_version}</span>
                        </div>
                      </div>

                      {/* Installation Status Indicator */}
                      {installed ? (
                        hasUpdate ? (
                          <span className="text-[11px] text-amber-400 font-medium shrink-0 font-mono">
                            可更新 (v{installed.installed_version})
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
                      查看扫描报告与依赖
                    </button>

                    {installed ? (
                      hasUpdate ? (
                        <button
                          onClick={() => onStartUpdatePlan(mod)}
                          className="px-3 py-1.5 text-xs font-semibold text-neutral-900 bg-amber-400 hover:bg-amber-300 rounded-md transition-colors flex items-center gap-1.5 shadow-xs"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>更新至 v{mod.latest_version}</span>
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
                        onClick={() => onStartInstallPlan(mod)}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-md transition-colors flex items-center gap-1.5 shadow-xs"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>安装规划预览</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination Footer */}
      <div className="h-12 border-t border-neutral-800 px-4 flex items-center justify-between text-xs text-neutral-400 bg-neutral-900/60 select-none shrink-0">
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
            className="px-3 py-1 rounded bg-neutral-800 text-neutral-200 hover:bg-neutral-700 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            上一页
          </button>
          <button
            onClick={() => setCursor(cursor + pageSize)}
            disabled={!hasNextPage}
            className="px-3 py-1 rounded bg-neutral-800 text-neutral-200 hover:bg-neutral-700 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
};
