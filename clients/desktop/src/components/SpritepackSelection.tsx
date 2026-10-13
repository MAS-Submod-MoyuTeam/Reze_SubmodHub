import React from 'react';
import type { SpriteSet } from '../../../../ui/catalog-api';
import { AlertCircle, AlertTriangle, Info, RefreshCw } from 'lucide-react';
import type { SelectionBaseline, SpriteSelectionDiff } from '../spritepackUtils';

export interface SpritepackSelectionProps {
  spriteSets: SpriteSet[];
  selectedSets: string[];
  onToggleSet: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  baseline: SelectionBaseline;
  diff: SpriteSelectionDiff;
  legacyRiskConfirmed?: boolean;
  onToggleLegacyRisk?: (confirmed: boolean) => void;
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
  baseline,
  diff,
  legacyRiskConfirmed,
  onToggleLegacyRisk,
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

  if (baseline.mode === 'loading') {
    return (
      <div className="rounded border border-neutral-800 bg-neutral-950 p-4 text-center text-xs text-neutral-400">
        正在读取当前实例安装状态...
      </div>
    );
  }

  if (baseline.mode === 'error') {
    return (
      <div role="alert" className="flex items-center justify-between rounded border border-rose-800 bg-rose-950/50 p-3 text-xs text-rose-200">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          <span>当前实例安装状态读取失败，请先在主界面刷新或重试。</span>
        </div>
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

  const installedSet = new Set(baseline.installedIds);

  return (
    <section className="space-y-3" aria-label="外观套装选择">
      {/* 1. 已安装固定提示 */}
      {baseline.mode === 'known_installed' && (
        <div role="status" className="flex items-start gap-2 rounded border border-sky-800/80 bg-sky-950/40 p-2.5 text-xs text-sky-200">
          <Info className="h-4 w-4 shrink-0 mt-0.5 text-sky-400" />
          <div className="leading-relaxed">
            已选择当前安装的项目。勾选其他套装可追加安装；取消勾选已安装套装并应用后，这些套装将被卸载。
          </div>
        </div>
      )}

      {/* 2. 旧安装记录未知提示与风险确认 */}
      {baseline.mode === 'unknown_installed' && (
        <div role="alert" className="space-y-2.5 rounded border border-amber-800/80 bg-amber-950/40 p-3 text-xs text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
            <div className="leading-relaxed">
              旧安装记录无法识别已安装套装，请重新选择最终保留的套装；应用将替换旧安装内容。
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer font-medium text-amber-300 select-none pl-6">
            <input
              type="checkbox"
              checked={Boolean(legacyRiskConfirmed)}
              onChange={(e) => onToggleLegacyRisk?.(e.target.checked)}
              className="rounded border-neutral-700 bg-neutral-900 text-amber-500 focus:ring-amber-500"
            />
            <span>我已知晓并确认将替换旧安装内容</span>
          </label>
        </div>
      )}

      {/* 3. 版本缺失集合提示 */}
      {baseline.unavailableInstalledIds.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded border border-amber-800/80 bg-amber-950/40 p-2.5 text-xs text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
          <div className="leading-relaxed">
            以下已安装套装在当前版本不可用，应用后将移除旧安装内容：
            <span className="font-mono font-semibold ml-1">{baseline.unavailableInstalledIds.join(', ')}</span>
          </div>
        </div>
      )}

      {/* 列表头部与摘要 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-neutral-100">外观套装 · {spriteSets.length} 套</h3>
          {baseline.mode === 'known_installed' ? (
            <span className="text-xs text-neutral-300">
              ({diff.summaryText})
            </span>
          ) : (
            <span className="text-xs text-neutral-400">
              ({diff.summaryText})
            </span>
          )}
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
        baseline.mode === 'known_installed' || baseline.mode === 'unknown_installed' ? (
          <div role="status" className="rounded border border-rose-800/80 bg-rose-950/40 p-2.5 text-xs text-rose-300">
            已取消所有套装。点击下方“卸载此精灵包”将彻底卸载此模组。
          </div>
        ) : (
          <div role="alert" className="rounded border border-amber-800/80 bg-amber-950/40 p-2.5 text-xs text-amber-300">
            请至少选择一个套装以继续安装。
          </div>
        )
      )}

      <div className="space-y-3">
        {spriteSets.map((set) => {
          const isChecked = selectedSets.includes(set.id);
          const wasInstalled = installedSet.has(set.id);

          return (
            <div
              key={set.id}
              className={`rounded border transition-colors ${
                isChecked
                  ? 'border-emerald-800/70 bg-neutral-950/90'
                  : 'border-neutral-800/80 bg-neutral-950/40 opacity-75'
              } p-3`}
            >
              <div className="flex items-center justify-between gap-2">
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

                {/* 徽标显示：由基线决定 */}
                <div className="shrink-0 flex items-center gap-1.5">
                  {wasInstalled ? (
                    isChecked ? (
                      <span className="rounded border border-emerald-800/80 bg-emerald-950/80 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                        已安装
                      </span>
                    ) : (
                      <span className="rounded border border-rose-800/80 bg-rose-950/80 px-1.5 py-0.5 text-[10px] font-medium text-rose-300">
                        应用后将卸载
                      </span>
                    )
                  ) : (
                    isChecked && (
                      <span className="rounded border border-sky-800/80 bg-sky-950/80 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                        待安装
                      </span>
                    )
                  )}
                </div>
              </div>

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
