import React from 'react';
import { ArrowUp, RefreshCw, Tag } from 'lucide-react';

interface Props {
  scrolled: boolean;
  onBackToTop: () => void;
  /** 标签筛选正在生效的标签数；0 表示没有筛，按钮不显示角标。 */
  activeTagCount: number;
  tagDrawerOpen: boolean;
  onToggleTagDrawer: () => void;
  catalogRefreshing: boolean;
  onReloadCatalog: () => void;
  /** 目录加载失败时不出现刷新：失败条里的重试才是唯一入口。 */
  catalogFailed: boolean;
}

const BUTTON =
  'pointer-events-auto w-11 h-11 rounded-full flex items-center justify-center border shadow-lg transition-colors';

/**
 * 目录页右下角的悬浮控件组（Web 浅色版）：返回顶部 / 标签筛选 / 刷新。
 *
 * 标签按钮紧挨刷新按钮，角标只报「正在生效的标签数」，不区分包含与排除——
 * 具体是哪些标签由抽屉和空状态文案说明。刷新在失败时隐藏，避免与失败条重复同一入口。
 */
export const CatalogFloatingControls: React.FC<Props> = ({
  scrolled,
  onBackToTop,
  activeTagCount,
  tagDrawerOpen,
  onToggleTagDrawer,
  catalogRefreshing,
  onReloadCatalog,
  catalogFailed,
}) => {
  return (
    <div className="flex flex-col items-end gap-3">
      {scrolled ? (
        <button
          type="button"
          onClick={onBackToTop}
          aria-label="返回顶部"
          title="返回顶部"
          data-testid="catalog-back-to-top"
          className={`${BUTTON} cursor-pointer border-neutral-200 bg-white/95 text-neutral-600 hover:border-emerald-300 hover:text-emerald-700`}
        >
          <ArrowUp className="w-4 h-4" aria-hidden="true" />
        </button>
      ) : null}

      <button
        type="button"
        onClick={onToggleTagDrawer}
        aria-expanded={tagDrawerOpen}
        aria-haspopup="dialog"
        aria-label={activeTagCount > 0 ? `标签筛选（已启用 ${activeTagCount} 个标签）` : '标签筛选'}
        title={activeTagCount > 0 ? `标签筛选（已启用 ${activeTagCount} 个标签）` : '标签筛选'}
        data-testid="catalog-tags"
        className={`${BUTTON} relative cursor-pointer ${
          tagDrawerOpen || activeTagCount > 0
            ? 'border-emerald-600 bg-emerald-700 text-white'
            : 'border-neutral-200 bg-white/95 text-neutral-600 hover:border-emerald-300 hover:text-emerald-700'
        }`}
      >
        <Tag className="w-4 h-4" aria-hidden="true" />
        {activeTagCount > 0 ? (
          <span
            data-testid="catalog-tags-badge"
            className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] font-semibold leading-[1.1rem] text-center tabular-nums bg-emerald-600 text-white"
          >
            {activeTagCount}
          </span>
        ) : null}
      </button>

      {catalogFailed ? null : (
        <button
          type="button"
          onClick={onReloadCatalog}
          disabled={catalogRefreshing}
          aria-busy={catalogRefreshing}
          aria-label="刷新模组目录"
          title={catalogRefreshing ? '正在刷新模组目录…' : '刷新模组目录'}
          data-testid="catalog-refresh"
          className={`${BUTTON} ${
            catalogRefreshing
              ? 'cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400'
              : 'cursor-pointer border-neutral-200 bg-white/95 text-neutral-600 hover:border-emerald-300 hover:text-emerald-700'
          }`}
        >
          <RefreshCw className={`w-4 h-4 ${catalogRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
        </button>
      )}
    </div>
  );
};
