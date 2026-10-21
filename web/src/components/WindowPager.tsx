import React from 'react';

// A keyset window cannot jump to a page number: the server hands out the cursor
// of the neighbouring window, so the only moves are one window back or forward.
// `start` is the 0-based index of the first visible row and is display-only, so
// both directions are derived from the row indices rather than from cursor
// presence — that keeps the buttons correct even when the cursors are opaque.
export interface WindowPagerProps {
  label: string;
  total: number;
  start: number;
  shown: number;
  pageSize: number;
  onPrevious: () => void;
  onNext: () => void;
  onPageSizeChange: (size: number) => void;
}

export function WindowPager({ label, total, start, shown, pageSize, onPrevious, onNext, onPageSizeChange }: WindowPagerProps) {
  const hasPrevious = start > 0;
  const hasNext = start + shown < total;
  const buttonClass = 'min-w-8 min-h-8 px-2 rounded border border-neutral-200 text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600';

  return (
    <nav aria-label={`${label}窗口翻页`} className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-3 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-neutral-500">
        <span aria-live="polite">共 {total} 条{shown > 0 ? ` · ${start + 1}–${start + shown} 条` : ''}</span>
        <label className="flex items-center gap-1">
          每页
          <select aria-label={`${label}每页条数`} value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} className="min-h-8 rounded border border-neutral-200 bg-white px-1 text-neutral-700">
            {[10, 20, 50].map((size) => <option key={size} value={size}>{size} 条</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" disabled={!hasPrevious} onClick={onPrevious} className={buttonClass}>上一页</button>
        <button type="button" disabled={!hasNext} onClick={onNext} className={buttonClass}>下一页</button>
        <span className="ml-1 text-neutral-400">按窗口翻页</span>
      </div>
    </nav>
  );
}
