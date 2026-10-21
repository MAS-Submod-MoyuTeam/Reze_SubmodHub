import React from 'react';

type PaginationProps = {
  label: string;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
};

export function Pagination({ label, total, page, pageSize, onPageChange, onPageSizeChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstPage = Math.max(1, Math.min(page - 2, totalPages - 4));
  const pages = Array.from({ length: Math.min(5, totalPages) }, (_, index) => firstPage + index);
  const buttonClass = 'min-w-8 min-h-8 px-2 rounded border border-neutral-200 text-neutral-600 hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600';

  return (
    <nav aria-label={`${label}分页`} className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-3 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-neutral-500">
        <span aria-live="polite">共 {total} 条 · {total ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, total)} 条</span>
        <label className="flex items-center gap-1">
          每页
          <select aria-label={`${label}每页条数`} value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))} className="min-h-8 rounded border border-neutral-200 bg-white px-1 text-neutral-700">
            {[10, 20, 50].map((size) => <option key={size} value={size}>{size} 条</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" aria-label="第一页" disabled={page <= 1} onClick={() => onPageChange(1)} className={buttonClass}>«</button>
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className={buttonClass}>上一页</button>
        {pages.map((number) => <button key={number} type="button" aria-label={`第 ${number} 页`} aria-current={page === number ? 'page' : undefined} onClick={() => onPageChange(number)} className={`${buttonClass} ${page === number ? 'bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800' : ''}`}>{number}</button>)}
        <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} className={buttonClass}>下一页</button>
        <button type="button" aria-label="最后一页" disabled={page >= totalPages} onClick={() => onPageChange(totalPages)} className={buttonClass}>»</button>
        <span className="ml-1 text-neutral-500">{page} / {totalPages} 页</span>
      </div>
    </nav>
  );
}
