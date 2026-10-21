import React from 'react';
import { Send, Upload } from 'lucide-react';
import { Pagination } from './Pagination';
import type { ModVersion, ScanReport } from '../types/submodhub';

// A spritepack mod has exactly one downloadable package, so the author only
// manages the drafts that lead up to it. This panel owns that branch on its own
// so it can be rendered and asserted without the whole author workbench.
export interface SpritepackPanelProps {
  hasPublishedVersion: boolean;
  hasPendingReview: boolean;
  uploading: boolean;
  loading: boolean;
  error?: string;
  loaded: boolean;
  versions: ModVersion[];
  scanReports: Record<string, ScanReport | undefined>;
  submittingVersionId: string | null;
  total: number;
  page: number;
  pageSize: number;
  onUpload: () => void;
  onRetry: () => void;
  onDeleteVersion: (versionId: string) => void;
  onSubmitReview: (versionId: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const isPublishedPackage = (version: ModVersion) => version.state === 'published' || version.state === 'unpublished';

export function SpritepackPanel({
  hasPublishedVersion, hasPendingReview, uploading, loading, error, loaded, versions, scanReports,
  submittingVersionId, total, page, pageSize, onUpload, onRetry, onDeleteVersion, onSubmitReview, onPageChange, onPageSizeChange,
}: SpritepackPanelProps) {
  const drafts = versions.filter((version) => !isPublishedPackage(version));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-xs font-bold text-neutral-900 uppercase">当前精灵包</h3>
        <button
          type="button"
          disabled={uploading || hasPendingReview}
          onClick={onUpload}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded disabled:opacity-40"
        >
          <Upload className="w-3.5 h-3.5" />
          {hasPublishedVersion ? '上传替换包' : '上传精灵包 ZIP'}
        </button>
      </div>
      {hasPublishedVersion && <p className="text-xs text-neutral-600">已有公开精灵包。替换包审核通过后将成为唯一可下载的包。</p>}
      {loading && <p role="status" className="text-xs text-neutral-500">正在加载版本…</p>}
      {error && <p role="alert" className="text-xs text-rose-700">版本加载失败：{error} <button onClick={onRetry} className="underline">重试</button></p>}
      {loaded && !versions.length && <p className="text-xs text-neutral-500">尚未上传精灵包。</p>}
      {drafts.map((version) => {
        const report = version.scan_report_id ? scanReports[version.scan_report_id] : null;
        const blockers = report?.blockers || [];
        return (
          <div key={version.id} className="border border-neutral-200 rounded-md p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-neutral-800">待发布包 · {version.state}</span>
              {version.state !== 'ready_for_review' && <button onClick={() => onDeleteVersion(version.id)} className="text-rose-700">删除草稿</button>}
            </div>
            {report?.sprite_sets && (
              <div className="space-y-2">
                <div className="font-medium text-neutral-700">识别到 {report.sprite_sets.length} 套 · {report.sprite_sets.reduce((count, set) => count + set.items.length, 0)} 个 JSON 项目</div>
                <div className="max-h-48 overflow-y-auto border border-neutral-200 rounded p-2 space-y-1">
                  {report.sprite_sets.map((set) => <div key={set.id}><span className="font-medium">{set.name}</span><span className="text-neutral-500"> · {set.items.map((item) => item.display_name).join('、')}</span></div>)}
                </div>
              </div>
            )}
            {blockers.length > 0 && <p className="text-rose-700">扫描阻断：{blockers.join('；')}</p>}
            {version.state === 'uploaded' && report && (
              <button disabled={blockers.length > 0 || submittingVersionId === version.id} onClick={() => onSubmitReview(version.id)} className="px-3 py-1.5 bg-emerald-700 text-white rounded disabled:opacity-40 flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5" />提交审核
              </button>
            )}
          </div>
        );
      })}
      {loaded && <Pagination label="精灵包版本" total={total} page={page} pageSize={pageSize} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />}
    </div>
  );
}
