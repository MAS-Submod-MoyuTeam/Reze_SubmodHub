import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Minus, X } from 'lucide-react';
import {
  activeTagFilterCount,
  describeTagFilter,
  isTagRowExpanded,
  rowActiveCount,
  type TagFilterEntry,
  type TagFilterRow,
  type TagFilterStates,
  type TagGroupCollapse,
} from '../../../../ui/tag-filter';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 抽屉里渲染的行：目录顺序在前，目录外的历史标签追加在后。 */
  rows: TagFilterRow[];
  states: TagFilterStates;
  onToggle: (name: string) => void;
  onClear: () => void;
  loading?: boolean;
  error?: string | null;
}

/**
 * 目录标签筛选抽屉（客户端深色版）。
 *
 * 标签默认不选；点一次为「包含此标签」，再点一次为「排除此标签」，第三次回到未选。
 * 每一项按聊天列表的样子排：第一行标签名，第二行小号灰色描述；子标签默认折叠，
 * 没有子标签的主标签不出现折叠按钮。
 * 三态语义、折叠判定都在 `ui/tag-filter.ts`，与 Web 共用同一份；
 * 这里只有配色不同，避免两端各写一份会漂移的筛选逻辑。
 */
export const TagFilterDrawer: React.FC<Props> = ({
  open,
  onClose,
  rows,
  states,
  onToggle,
  onClear,
  loading = false,
  error = null,
}) => {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [collapse, setCollapse] = useState<TagGroupCollapse>({});
  const active = activeTagFilterCount(states);

  // Esc 关闭：浮层必须能用键盘退出，不能只靠点遮罩。
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus?.();
  }, [open]);

  if (!open) return null;

  const tagButton = (entry: TagFilterEntry, main: boolean, stale: boolean) => {
    const state = states[entry.name];
    const stateText = state === 'include' ? '包含' : state === 'exclude' ? '排除' : '';
    const label = [entry.name, stateText && `（${stateText}）`, entry.description && `：${entry.description}`]
      .filter(Boolean)
      .join('');
    return (
      <button
        key={entry.name}
        type="button"
        data-tag={entry.name}
        data-tag-state={state ?? 'off'}
        aria-label={label}
        aria-pressed={state !== undefined}
        title={stale ? '该标签已不在标签目录中，仍可用来筛选存量模组' : label}
        onClick={() => onToggle(entry.name)}
        className={[
          'w-full text-left rounded border px-2 py-1 transition-colors cursor-pointer',
          main ? 'font-medium' : '',
          stale ? 'border-dashed' : '',
          state === 'include'
            ? 'border-emerald-600 bg-emerald-600 text-white'
            : state === 'exclude'
              ? 'border-rose-800 bg-rose-950 text-rose-300 hover:border-rose-700'
              : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-emerald-600 hover:text-emerald-300',
        ]
          .join(' ')
          .trim()}
      >
        <span className="flex items-center gap-1 text-[11px]">
          {state === 'include' ? (
            <Check className="w-3 h-3 shrink-0" aria-hidden="true" />
          ) : state === 'exclude' ? (
            <Minus className="w-3 h-3 shrink-0" aria-hidden="true" />
          ) : null}
          <span className="truncate">#{entry.name}</span>
        </span>
        {entry.description ? (
          <span
            className={`block text-[10px] leading-snug mt-0.5 ${
              state === 'include' ? 'text-emerald-100' : state === 'exclude' ? 'text-rose-400' : 'text-neutral-500'
            }`}
          >
            {entry.description}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="标签筛选"
      data-testid="tag-filter-drawer"
    >
      <button
        type="button"
        aria-label="关闭标签筛选"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 cursor-default"
      />
      <aside className="relative h-full w-full max-w-sm sm:max-w-md border-l border-neutral-800 bg-neutral-900 text-neutral-200 shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-neutral-800">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-100">标签筛选</h2>
            <p className="text-[11px] mt-0.5 text-neutral-400">
              点一次包含、再点一次排除、第三次取消；包含的标签需同时满足。
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="关闭标签筛选"
            className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {active > 0 ? (
            <p className="text-[11px] text-neutral-400" data-testid="tag-filter-summary">
              {describeTagFilter(states)}
            </p>
          ) : null}

          {loading ? <p className="text-[11px] text-neutral-400">正在读取标签目录…</p> : null}
          {error ? (
            <p role="alert" className="text-[11px] text-rose-400">
              {error}
            </p>
          ) : null}
          {rows.length === 0 && !loading && !error ? (
            <p className="text-[11px] text-neutral-400">目录里还没有可用标签。</p>
          ) : null}

          {rows.map((row) => {
            const expanded = isTagRowExpanded(collapse, row);
            const groupActive = rowActiveCount(row, states);
            return (
              <div
                key={row.main.name}
                data-testid={`tag-filter-row-${row.main.name}`}
                className="border-b border-neutral-800/70 pb-2 last:border-b-0 last:pb-0"
              >
                <div className="flex items-start gap-1">
                  {/* 折叠按钮只负责展开，不改变筛选状态：两个动作必须分开。 */}
                  {row.children.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setCollapse((current) => ({ ...current, [row.main.name]: !expanded }))}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? '收起' : '展开'} ${row.main.name} 的子标签（${row.children.length} 个）`}
                      data-testid={`tag-filter-toggle-${row.main.name}`}
                      className="mt-1 p-0.5 rounded text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 cursor-pointer"
                    >
                      {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                  ) : (
                    <span className="w-[1.125rem] shrink-0" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">{tagButton(row.main, true, row.stale)}</div>
                  {!expanded && groupActive > 0 ? (
                    <span
                      data-testid={`tag-filter-group-active-${row.main.name}`}
                      className="mt-1 shrink-0 rounded-full bg-emerald-900/70 px-1.5 text-[10px] tabular-nums text-emerald-300"
                    >
                      {groupActive}
                    </span>
                  ) : null}
                </div>
                {expanded && row.children.length > 0 ? (
                  <div
                    className="ml-[1.375rem] mt-1 pl-2 border-l border-neutral-800 space-y-1"
                    data-testid={`tag-filter-children-${row.main.name}`}
                  >
                    {row.children.map((child) => tagButton(child, false, row.stale))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="px-4 py-3 border-t border-neutral-800 flex items-center justify-between gap-3">
          <span className="text-[11px] text-neutral-400 tabular-nums" data-testid="tag-filter-count">
            {active === 0 ? '未启用标签筛选' : `已启用 ${active} 个标签`}
          </span>
          <button
            type="button"
            onClick={onClear}
            disabled={active === 0}
            className="px-2.5 py-1 text-[11px] font-medium rounded border border-neutral-700 text-neutral-300 hover:text-white hover:border-neutral-600 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          >
            清除全部
          </button>
        </div>
      </aside>
    </div>
  );
};
