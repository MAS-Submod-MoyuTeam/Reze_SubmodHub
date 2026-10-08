import React, { useState, useMemo } from 'react';
import { Mod, Category, Installation } from '../types/submodhub';
import { formatBytes } from '../utils/formatters';
import { Search, X, Sparkles, Filter, WifiOff, Download, ChevronRight, CheckCircle2, AlertOctagon } from 'lucide-react';

interface CatalogTabProps {
  mods: Mod[];
  currentInstallation: Installation;
  onSelectMod: (mod: Mod) => void;
  offlineMode: boolean;
}

export const CatalogTab: React.FC<CatalogTabProps> = ({
  mods,
  currentInstallation,
  onSelectMod,
  offlineMode,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<Category | 'all'>('all');
  const [selectedTag, setSelectedTag] = useState<string>('all');

  const allTags = useMemo(() => {
    const set = new Set<string>();
    mods.forEach((m) => m.tags.forEach((t) => set.add(t)));
    return ['all', ...Array.from(set)];
  }, [mods]);

  const filteredMods = useMemo(() => {
    return mods.filter((mod) => {
      // Category filter
      if (selectedCategory !== 'all' && mod.category !== selectedCategory) {
        return false;
      }
      // Tag filter
      if (selectedTag !== 'all' && !mod.tags.includes(selectedTag)) {
        return false;
      }
      // Search query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = mod.title.toLowerCase().includes(query);
        const matchesSummary = mod.summary.toLowerCase().includes(query);
        const matchesAuthor = mod.author.display_name.toLowerCase().includes(query);
        const matchesTag = mod.tags.some((t) => t.toLowerCase().includes(query));
        if (!matchesTitle && !matchesSummary && !matchesAuthor && !matchesTag) {
          return false;
        }
      }
      return true;
    });
  }, [mods, selectedCategory, selectedTag, searchQuery]);

  return (
    <div className="flex-1 flex flex-col overflow-y-auto pb-4">
      {/* Offline Mode Banner */}
      {offlineMode && (
        <div className="bg-amber-950/60 border-b border-amber-800/60 px-4 py-2 flex items-center justify-between text-xs text-amber-200">
          <div className="flex items-center gap-2">
            <WifiOff className="w-3.5 h-3.5 text-amber-400" />
            <span>离线模式：当前仅展示本地已缓存模组目录与本地已下载安装包。</span>
          </div>
          <span className="text-[10px] text-amber-300 font-mono">CACHE VALID</span>
        </div>
      )}

      {/* Search Bar & Filter Header */}
      <div className="p-4 space-y-3 bg-slate-900/60 border-b border-slate-800/60">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索模组名称、作者、话题或特性..."
            className="w-full h-11 pl-10 pr-9 bg-slate-950/80 border border-slate-800 rounded-2xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Category Segmented Control */}
        <div className="flex items-center p-1 bg-slate-950 rounded-xl border border-slate-800/80">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${
              selectedCategory === 'all'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            全部模组
          </button>
          <button
            onClick={() => setSelectedCategory('submod')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${
              selectedCategory === 'submod'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Submod 增强
          </button>
          <button
            onClick={() => setSelectedCategory('spritepack')}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${
              selectedCategory === 'spritepack'
                ? 'bg-slate-800 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Spritepack 服饰
          </button>
        </div>

        {/* Tags horizontal filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar text-xs">
          <span className="text-[11px] text-slate-500 shrink-0 flex items-center gap-1 mr-1">
            <Filter className="w-3 h-3" />
            标签:
          </span>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setSelectedTag(tag)}
              className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                selectedTag === tag
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : 'bg-slate-800/50 text-slate-400 hover:text-slate-300 border border-slate-750'
              }`}
            >
              {tag === 'all' ? '全部标签' : `#${tag}`}
            </button>
          ))}
        </div>
      </div>

      {/* Catalog Results List */}
      <div className="p-4 space-y-3 flex-1">
        <div className="flex items-center justify-between text-xs text-slate-400 px-1">
          <span>共找到 {filteredMods.length} 个模组包</span>
          <span className="font-mono text-[11px]">当前 MAS: {currentInstallation.mas_version}</span>
        </div>

        {filteredMods.length === 0 ? (
          <div className="p-8 text-center bg-slate-950/40 rounded-3xl border border-slate-800/60 my-6">
            <Sparkles className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <h4 className="text-sm font-medium text-slate-300">无匹配结果</h4>
            <p className="text-xs text-slate-500 mt-1">
              请尝试更换搜索词或重置分类筛选。
            </p>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('all');
                setSelectedTag('all');
              }}
              className="mt-4 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors"
            >
              重置所有筛选
            </button>
          </div>
        ) : (
          filteredMods.map((mod) => {
            const isLegacyConflict = mod.id === 'mod_unstable_legacy';

            return (
              <div
                key={mod.id}
                onClick={() => onSelectMod(mod)}
                className="group relative bg-slate-950/70 hover:bg-slate-850/80 active:bg-slate-800/90 border border-slate-800/80 hover:border-slate-700 rounded-3xl p-4 transition-all cursor-pointer shadow-sm"
              >
                {/* Visual Header / Color Stripe Indicator */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-slate-100 group-hover:text-rose-300 transition-colors leading-snug">
                      {mod.title}
                    </h3>

                    {/* Zero-Pill Metadata Line */}
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-1.5 flex-wrap">
                      <span className="text-slate-300 font-medium">{mod.author.display_name}</span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span className="capitalize">{mod.category}</span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span className="font-mono text-slate-300">{mod.latest_version}</span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span>{formatBytes(mod.size_bytes)}</span>
                    </div>
                  </div>

                  <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-slate-300 shrink-0 mt-1 transition-transform group-hover:translate-x-0.5" />
                </div>

                {/* Summary */}
                <p className="text-xs text-slate-400 mt-2.5 line-clamp-2 leading-relaxed">
                  {mod.summary}
                </p>

                {/* Compatibility & Tags footer (Unboxed Discipline) */}
                <div className="mt-3.5 pt-3 border-t border-slate-850 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    {isLegacyConflict ? (
                      <div className="flex items-center gap-1 text-rose-400 text-[11px] font-medium">
                        <AlertOctagon className="w-3.5 h-3.5 shrink-0" />
                        <span>MAS 版本不兼容 / 冲突</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-emerald-400 text-[11px] font-medium">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>兼容 MAS {mod.mas_version_range}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 text-[11px] text-slate-500">
                    <Download className="w-3 h-3 text-slate-500" />
                    <span className="font-mono tabular-nums">{mod.downloads_count.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
