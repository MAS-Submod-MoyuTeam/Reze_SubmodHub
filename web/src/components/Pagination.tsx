/**
 * 分页条。
 *
 * 这里之前把「共 N 条 / 每页 / 上一页 / 下一页 / 第 N 页」全写死在组件里，
 * 于是作者台与审核台切到英文后仍是中文。字典里本来就有整套 `pagination.*`
 * 键（迁移时漏挂了），现在直接用，不再新增一套命名。
 */
import React from 'react';
import { useI18n } from '../i18n';

type PaginationProps = {
  label: string;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
};

export function Pagination({ label, total, page, pageSize, onPageChange, onPageSizeChange }: PaginationProps) {
  const { t } = useI18n();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstPage = Math.max(1, Math.min(page - 2, totalPages - 4));
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, index) => firstPage + index);
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);
  const buttonClass = 'min-w-8 min-h-8 px-2 rounded border border-neutral-200 text-neutral-600 transition-colors hover:bg-neutral-100 hover:border-neutral-300 active:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600';

  return (
    <nav aria-label={t('pagination.navLabel', { label })} className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-3 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-neutral-500">
        <span aria-live="polite">{t('pagination.summary', { total, from, to })}</span>
        <label className="flex items-center gap-1">
          {t('pagination.pageSizeLabel')}
          <select aria-label={t('pagination.pageSizeAria', { label })} value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} className="min-h-8 rounded border border-neutral-200 bg-white px-1 text-neutral-700">
            {[10, 20, 50].map((size) => <option key={size} value={size}>{t('pagination.pageSizeOption', { count: size })}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" aria-label={t('pagination.first')} disabled={page <= 1} onClick={() => onPageChange(1)} className={buttonClass}>«</button>
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className={buttonClass}>{t('pagination.previous')}</button>
        {pages.map((number) => <button key={number} type="button" aria-label={t('pagination.pageAria', { page: number })} aria-current={page === number ? 'page' : undefined} onClick={() => onPageChange(number)} className={`${buttonClass} ${page === number ? 'bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800' : ''} active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600`}>{number}</button>)}
        <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} className={buttonClass}>{t('pagination.next')}</button>
        <button type="button" aria-label={t('pagination.last')} disabled={page >= totalPages} onClick={() => onPageChange(totalPages)} className={buttonClass}>»</button>
        <span className="ml-1 text-neutral-500">{t('pagination.pageOf', { page, totalPages })}</span>
      </div>
    </nav>
  );
}
