import React from 'react';
import type { SpriteSet } from '../../../../ui/catalog-api';
import { AlertCircle, RefreshCw } from 'lucide-react';

export interface SpritepackSelectionProps {
  spriteSets: SpriteSet[];
  selectedSets: string[];
  onToggleSet: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}

export const SpritepackSelection: React.FC<SpritepackSelectionProps> = ({
  spriteSets,
  selectedSets,
  onToggleSet,
  onSelectAll,
  onDeselectAll,
  loading,
  error,
  onRetry,
}) => {
  const allSelected = spriteSets.length > 0 && selectedSets.length === spriteSets.length;
  const noneSelected = selectedSets.length === 0;

  if (loading) {
    return (
      <div className="rounded border border-neutral-800 bg-neutral-950 p-4 text-center text-xs text-neutral-400">
        正在读取外观套装清单...
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex items-center justify-between rounded border border-rose-800 bg-rose-950/50 p-3 text-xs text-rose-200">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>套装读取失败：{error}</span>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
          >
            <RefreshCw className="h-3 w-3" /> 重试
          </button>
        )}
      </div>
    );
  }

  if (spriteSets.length === 0) {
    return (
      <div className="rounded border border-neutral-800 bg-neutral-950 p-4 text-center text-xs text-neutral-400">
        暂无公开外观套装
      </div>
    );
  }

  return (
    <section className="space-y-3" aria-label="外观套装选择">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-neutral-100">外观套装 · {spriteSets.length} 套</h3>
          <span className="text-xs text-neutral-400">
            (已选 <span className="font-semibold text-emerald-400">{selectedSets.length}</span>/{spriteSets.length})
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={allSelected ? onDeselectAll : onSelectAll}
            className="rounded bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-200 hover:bg-neutral-700 hover:text-white"
          >
            {allSelected ? '取消全选' : '全选'}
          </button>
        </div>
      </div>

      {noneSelected && (
        <div role="alert" className="rounded border border-amber-800/80 bg-amber-950/40 p-2.5 text-xs text-amber-300">
          请至少选择一个套装以继续安装。
        </div>
      )}

      <div className="space-y-3">
        {spriteSets.map((set) => {
          const isChecked = selectedSets.includes(set.id);
          return (
            <div
              key={set.id}
              className={`rounded border transition-colors ${
                isChecked
                  ? 'border-emerald-800/70 bg-neutral-950/90'
                  : 'border-neutral-800/80 bg-neutral-950/40 opacity-75'
              } p-3`}
            >
              <label className="flex cursor-pointer items-center gap-2.5 font-semibold text-neutral-200">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => onToggleSet(set.id)}
                  className="h-4 w-4 rounded border-neutral-700 bg-neutral-800 text-emerald-600 focus:ring-emerald-500"
                />
                <span className="text-sm">{set.name}</span>
                <span className="text-xs text-neutral-500 font-normal">({set.items.length} 件物品)</span>
              </label>

              {set.items.length > 0 && (
                <div className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {set.items.map((item, index) => {
                    const previewUrl = item.preview_url
                      ? new URL(item.preview_url, window.location.origin).href
                      : undefined;
                    return (
                      <div key={`${set.id}-${index}`} className="min-w-0 text-xs text-neutral-300">
                        {previewUrl ? (
                          <img
                            src={previewUrl}
                            alt={item.display_name}
                            loading="lazy"
                            className="mb-1 aspect-square w-full rounded border border-neutral-800 bg-neutral-900 object-contain"
                          />
                        ) : (
                          <div className="mb-1 aspect-square w-full rounded border border-neutral-800 bg-neutral-900 flex items-center justify-center text-[10px] text-neutral-500">
                            无预览
                          </div>
                        )}
                        <span className="block truncate text-neutral-300" title={item.display_name}>
                          {item.display_name}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
