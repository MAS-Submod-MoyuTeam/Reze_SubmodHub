import React from 'react';
import { useI18n } from '../i18n';

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
  // 文案原本写死中文，切到英文后整条分页仍是中文；字典里已有 windowPager.*
  // 与 pagination.pageSize* 键，这里直接复用。
  const { t } = useI18n();
  const hasPrevious = start > 0;
  const hasNext = start + shown < total;
  const buttonClass = 'min-w-8 min-h-8 px-2 rounded border border-neutral-200 text-neutral-600 transition-colors hover:bg-neutral-100 hover:border-neutral-300 active:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600';

  return (
    <nav aria-label={t('windowPager.navLabel', { label })} className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-3 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-neutral-500">
        <span aria-live="polite">
          {shown > 0
            ? t('windowPager.summaryWithRange', { total, from: start + 1, to: start + shown })
            : t('windowPager.summary', { total })}
        </span>
        <label className="flex items-center gap-1">
          {t('pagination.pageSizeLabel')}
          <select aria-label={t('pagination.pageSizeAria', { label })} value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} className="min-h-8 rounded border border-neutral-200 bg-white px-1 text-neutral-700">
            {[10, 20, 50].map((size) => <option key={size} value={size}>{t('pagination.pageSizeOption', { count: size })}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" disabled={!hasPrevious} onClick={onPrevious} className={buttonClass}>{t('pagination.previous')}</button>
        <button type="button" disabled={!hasNext} onClick={onNext} className={buttonClass}>{t('pagination.next')}</button>
        <span className="ml-1 text-neutral-400">{t('windowPager.hint')}</span>
      </div>
    </nav>
  );
}
