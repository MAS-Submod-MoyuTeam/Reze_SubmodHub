import React, { useState } from 'react';
import { apiBase } from '../apiBase';
import { useApp } from '../context/AppContext';
import { useI18n } from '../i18n';
import { MarkdownText } from './MarkdownText';
import { Pagination } from './Pagination';
import { useReviewPage } from './useReviewPage';
import { mapServerScanReport } from '../context/scanReport';
import { assetPlatformLabel } from '../types/submodhub';
import { formatVersionLabel } from './versionHistory';
import { tabSegmentClass } from './selectionStyles';
import { formatBytes } from './formatBytes';
import { shortHash } from './clientDownload';
import { reviewArchiveErrorText, triggerArchiveSave } from './reviewArchive';
import { fetchReviewArchive, getReviewSubmission, listReviewSubmissions, listReviewAudit, platformScanReportId } from '../../../ui/submission-api';
import { AnimatePresence, m } from './Motion';
import { overlayVariants, panelVariants } from '../../../ui/motion-presets';
import {
  ShieldAlert,
  CheckCircle2,
  XCircle,
  FileCode,
  FolderTree,
  AlertTriangle,
  Send,
  Eye,
  History,
  FileText,
  Clock,
  Sparkles,
  Download,
  ChevronDown,
} from 'lucide-react';

export const ReviewerWorkbench: React.FC = () => {
  const { t, resolve } = useI18n();
  const {
    currentUser,
    hasRole,
    approveSubmission,
    rejectSubmission,
    publishApprovedVersion,
    showToast,
  } = useApp();

  const isReviewer = hasRole('admin');

  // Tab: Queue vs Audit Stream
  const [activeReviewTab, setActiveReviewTab] = useState<'queue' | 'audit'>('queue');

  // Filter in queue
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const [queuePage, setQueuePage] = useState(1);
  const [queuePageSize, setQueuePageSize] = useState(10);
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(20);
  const base = apiBase();
  const userId = currentUser?.id;
  const loadQueue = React.useCallback((signal: AbortSignal) => listReviewSubmissions(base, { page: queuePage, pageSize: queuePageSize, state: statusFilter }, signal), [base, queuePage, queuePageSize, statusFilter, userId]);
  const loadAudit = React.useCallback((signal: AbortSignal) => listReviewAudit(base, { page: auditPage, pageSize: auditPageSize }, signal), [base, auditPage, auditPageSize, userId]);
  // The query key names what a page actually answers. Reloading the same key (a
  // mutation, the periodic refresh) keeps the rows on screen while it refetches;
  // only a real query change blanks them, so the queue does not flash between a
  // decision and its renewal.
  const queueRequest = useReviewPage(loadQueue, isReviewer && activeReviewTab === 'queue', `queue|${userId}|${queuePage}|${queuePageSize}|${statusFilter}`);
  const auditRequest = useReviewPage(loadAudit, isReviewer && activeReviewTab === 'audit', `audit|${userId}|${auditPage}|${auditPageSize}`);
  const queue = queueRequest.data;
  const audit = auditRequest.data;
  React.useEffect(() => { if (queue && queue.page !== queuePage) setQueuePage(queue.page); }, [queue, queuePage]);
  React.useEffect(() => { if (audit && audit.page !== auditPage) setAuditPage(audit.page); }, [audit, auditPage]);

  const [selectedSubId, setSelectedSubId] = useState('');
  const activeSubmission = queue?.items.find((submission) => submission.id === selectedSubId) || queue?.items[0];
  const activeSubmissionId = activeSubmission?.id;
  const activeSubmissionState = activeSubmission?.state;
  const loadDetail = React.useCallback((signal: AbortSignal) => getReviewSubmission(base, activeSubmissionId!, (input, init) => fetch(input, { ...init, signal })), [base, activeSubmissionId, activeSubmissionState, userId]);
  const detailRequest = useReviewPage(loadDetail, isReviewer && !!activeSubmissionId && activeReviewTab === 'queue', `detail|${userId}|${activeSubmissionId}|${activeSubmissionState}`);
  const reviewDetail = detailRequest.data;
  // A per-platform version owns one report per build. The reviewer decides for all
  // of them, so the panel follows an explicit platform choice — defaulting to the
  // platform the version summary points at — instead of showing one fixed report
  // and letting the other build through unexamined.
  const shippedPlatforms = reviewDetail?.version?.platform_assets;
  const [reportPlatform, setReportPlatform] = useState('');
  const chosenPlatform = reportPlatform && shippedPlatforms?.some((asset) => asset.platform === reportPlatform)
    ? reportPlatform
    : shippedPlatforms?.[0]?.platform || '';
  const selectedServerReport = shippedPlatforms?.length
    ? reviewDetail?.scan_reports?.[platformScanReportId(reviewDetail.version.id, chosenPlatform)]
    : reviewDetail?.scan_report;
  const activeReport = React.useMemo(
    () => (reviewDetail && selectedServerReport
      ? mapServerScanReport(reviewDetail.version.id, selectedServerReport, shippedPlatforms?.length ? platformScanReportId(reviewDetail.version.id, chosenPlatform) : undefined)
      : null),
    [reviewDetail, selectedServerReport, chosenPlatform, shippedPlatforms?.length],
  );
  // The per-file table is reference material: these counts let the folded summary
  // still say whether opening it is worth a reviewer's time.
  const reportFiles = activeReport?.files ?? [];
  const reportBinaryCount = reportFiles.filter((file) => file.kind === 'binary').length;
  const reportConflictCount = activeReport?.blockers.length ?? 0;
  const [decisionModalMode, setDecisionModalMode] = useState<'approve' | 'reject' | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [decisionSubmissionId, setDecisionSubmissionId] = useState('');
  const [actionPending, setActionPending] = useState(false);
  const [archiveDownloading, setArchiveDownloading] = useState(false);
  // The archive under review is not published yet, so the public archive endpoint
  // would 404 it. The server also says which builds it still stores: a rejection
  // freezes the build into a snapshot without bytes, and a deleted version keeps
  // its submission only, so the page must not offer a download that cannot work.
  // The download follows the platform whose report is on screen, so the ZIP a
  // reviewer opens is the build the file list above describes.
  const archivePlatform = shippedPlatforms?.length && (chosenPlatform === 'windows' || chosenPlatform === 'android') ? chosenPlatform : undefined;
  const archiveAvailability = reviewDetail?.archive_availability;
  const archiveReady = Boolean(reviewDetail) && (archivePlatform
    ? (archiveAvailability?.platforms || []).some((platform) => platform === archivePlatform)
    : Boolean(archiveAvailability?.shared));

  const handleDownloadArchive = async () => {
    if (!activeSubmissionId || !archiveReady || archiveDownloading) return;
    setArchiveDownloading(true);
    try {
      const archive = await fetchReviewArchive(base, activeSubmissionId, archivePlatform);
      triggerArchiveSave(archive.blob, archive.filename);
      showToast('success', t('reviewer.downloadOk', { size: formatBytes(archive.size_bytes, t('common.unknown')), filename: archive.filename }));
    } catch (error) {
      showToast('error', t('reviewer.downloadFailed', { error: reviewArchiveErrorText(error) }));
    } finally {
      setArchiveDownloading(false);
    }
  };

  if (!isReviewer) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center space-y-4">
        <ShieldAlert className="w-10 h-10 text-neutral-400 mx-auto" />
        <h2 className="text-base font-bold text-neutral-800">{t('reviewer.notAuthorizedTitle')}</h2>
        <p className="text-xs text-neutral-500 max-w-md mx-auto">
          {t('reviewer.notAuthorizedBody')}
        </p>
      </div>
    );
  }

  const handleOpenDecisionModal = (mode: 'approve' | 'reject') => {
    setDecisionModalMode(mode);
    setDecisionSubmissionId(activeSubmissionId || '');
    setDecisionReason(
      mode === 'approve'
        ? t('reviewer.defaultApproveReason')
        : ''
    );
  };

  const handleConfirmDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!decisionSubmissionId || !decisionModalMode || actionPending) return;
    setActionPending(true);
    try {
      const success = decisionModalMode === 'approve'
        ? await approveSubmission(decisionSubmissionId, decisionReason)
        : await rejectSubmission(decisionSubmissionId, decisionReason);
      if (success) {
        setDecisionModalMode(null);
        setDecisionReason('');
        queueRequest.reload();
        auditRequest.reload();
        detailRequest.reload();
      }
    } finally { setActionPending(false); }
  };

  const handleConfirmPublish = async () => {
    if (!activeSubmission || actionPending) return;
    setActionPending(true);
    try {
      if (await publishApprovedVersion(activeSubmission.id)) {
        queueRequest.reload();
        auditRequest.reload();
        detailRequest.reload();
      }
    } finally { setActionPending(false); }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="bg-white border border-neutral-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <span className="font-semibold text-neutral-900">{currentUser?.display_name}</span>
            <span>·</span>
            <span>{t('reviewer.heroBadge')}</span>
          </div>
          <h1 className="text-lg font-bold text-neutral-900 tracking-tight mt-0.5">
            {t('reviewer.heroBody')}
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            {t('reviewer.heroNote')}
          </p>
        </div>

        {/* Tab switchers */}
        <div className="flex items-center bg-neutral-100 p-0.5 rounded text-xs font-medium">
          <button
            onClick={() => setActiveReviewTab('queue')}
            aria-pressed={activeReviewTab === 'queue'}
            className={`${tabSegmentClass(activeReviewTab === 'queue')} active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600`}
          >
            {t('reviewer.pendingQueue', { count: queue?.pending_count ?? '…' })}
          </button>
          <button
            onClick={() => setActiveReviewTab('audit')}
            aria-pressed={activeReviewTab === 'audit'}
            className={`${tabSegmentClass(activeReviewTab === 'audit')} active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600`}
          >
            {audit ? t('reviewer.auditTabWithTotal', { total: audit.total }) : t('reviewer.auditTab')}
          </button>
        </div>
      </div>

      {activeReviewTab === 'audit' ? (
        /* Audit Trail View (GET /review/audit) */
        <div className="bg-white border border-neutral-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-neutral-900">
                {t('reviewer.auditEndpoint')}
              </h2>
              <p className="text-xs text-neutral-500">
                {t('reviewer.auditHint')}
              </p>
            </div>
            <span className="text-xs font-mono text-neutral-400">
              {t('reviewer.auditCount', { total: audit?.total ?? '…' })}
            </span>
          </div>

          {auditRequest.loading && <p role="status" className="py-8 text-center text-xs text-neutral-500">{t('reviewer.auditLoading')}</p>}
          {auditRequest.error && <p role="alert" className="text-xs text-rose-700">{t('reviewer.auditLoadFailed', { error: auditRequest.error })} <button type="button" onClick={auditRequest.reload} className="rounded px-1 py-0.5 transition-colors underline hover:bg-neutral-100 active:bg-neutral-200 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">{t('common.retry')}</button></p>}
          <div className="divide-y divide-neutral-100">
            {audit?.items.map((log) => {
              const actionColors: Record<string, string> = {
                version_publish: 'bg-emerald-50 text-emerald-800 border-emerald-200',
                submission_approve: 'bg-sky-50 text-sky-800 border-sky-200',
                submission_reject: 'bg-rose-50 text-rose-800 border-rose-200',
                version_unpublish: 'bg-amber-50 text-amber-800 border-amber-200',
                role_grant: 'bg-purple-50 text-purple-800 border-purple-200',
              };

              return (
                <div key={log.id} className="py-3.5 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] font-mono px-2 py-0.5 rounded border font-semibold ${
                          actionColors[log.action] || 'bg-neutral-100 text-neutral-700'
                        }`}
                      >
                        {log.action}
                      </span>
                      <span className="font-semibold text-neutral-900">{log.target_label}</span>
                    </div>
                    <span className="text-[11px] font-mono text-neutral-400">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                  </div>

                  <p className="text-neutral-600 bg-neutral-50 p-2 rounded border border-neutral-100 text-xs">
                    {log.reason}
                  </p>

                  <div className="flex items-center justify-between text-[11px] text-neutral-400">
                    <span>
                      {t('reviewer.actor')}<strong className="text-neutral-700">{log.actor_name}</strong> ({log.actor_role})
                    </span>
                    <span className="font-mono">{t('reviewer.auditId', { id: log.id })}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {audit && audit.total === 0 && <p className="py-8 text-center text-xs text-neutral-500">{t('reviewer.auditEmpty')}</p>}
          {audit && <Pagination label={t('reviewer.auditPagerLabel')} total={audit.total} page={audit.page} pageSize={auditPageSize} onPageChange={setAuditPage} onPageSizeChange={(size) => { setAuditPageSize(size); setAuditPage(1); }} />}
        </div>
      ) : (
        /* Review Queue & Inspection Panel */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Submissions Queue List */}
          <div className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4 lg:col-span-1">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
              <h2 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
                {t('reviewer.queueTitle', { total: queue?.total ?? '…' })}
              </h2>
            </div>

            {/* Filter Tabs */}
            <div className="flex flex-wrap gap-1 text-[11px]">
              {[
                { id: 'all', label: t('reviewer.filterAll') },
                { id: 'ready_for_review', label: t('reviewer.filterPending') },
                { id: 'approved', label: t('reviewer.filterApproved') },
                { id: 'rejected', label: t('reviewer.filterRejected') },
                { id: 'published', label: t('reviewer.filterPublished') },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => { setStatusFilter(tab.id); setQueuePage(1); setSelectedSubId(''); }}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    statusFilter === tab.id
                      ? 'bg-neutral-900 text-white font-medium'
                      : 'text-neutral-500 hover:bg-neutral-100'
                  } active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {queueRequest.loading && <p role="status" className="py-8 text-center text-xs text-neutral-500">{t('reviewer.queueLoading')}</p>}
            {queueRequest.error && <p role="alert" className="text-xs text-rose-700">{t('reviewer.queueLoadFailed', { error: queueRequest.error })} <button type="button" onClick={queueRequest.reload} className="rounded px-1 py-0.5 transition-colors underline hover:bg-neutral-100 active:bg-neutral-200 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">{t('common.retry')}</button></p>}
            {/* Submissions items */}
            <div className="space-y-2">
              {queue?.items.map((sub) => {
                const isSelected = sub.id === activeSubmission?.id;

                return (
                  <button
                    key={sub.id}
                    onClick={() => setSelectedSubId(sub.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-all text-xs space-y-1.5 ${
                      isSelected
                        ? 'border-neutral-900 bg-neutral-50/80 font-medium'
                        : 'border-neutral-200 hover:border-neutral-300 bg-white'
                    } active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-neutral-900 truncate max-w-[160px]">
                        {sub.mod_title}
                      </span>
                      <span className="font-mono text-[11px] text-neutral-600">{sub.category === 'spritepack' ? t('reviewer.spritepack') : formatVersionLabel(sub.version_str)}</span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-neutral-500">
                      <span>{t('reviewer.authorLabel', { name: sub.author_name })}</span>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                          sub.state === 'ready_for_review'
                            ? 'bg-amber-100 text-amber-800'
                            : sub.state === 'approved'
                            ? 'bg-sky-100 text-sky-800'
                            : sub.state === 'published'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {sub.state}
                      </span>
                    </div>


                  </button>
                );
              })}
            </div>
            {queue && queue.total === 0 && <p className="py-8 text-center text-xs text-neutral-500">{t('reviewer.queueEmpty')}</p>}
            {queue && <Pagination label={t('reviewer.queuePagerLabel')} total={queue.total} page={queue.page} pageSize={queuePageSize} onPageChange={(page) => { setQueuePage(page); setSelectedSubId(''); }} onPageSizeChange={(size) => { setQueuePageSize(size); setQueuePage(1); setSelectedSubId(''); }} />}
          </div>

          {/* Right Column: Deep Inspection & Audit Actions */}
          <div className="bg-white border border-neutral-200 rounded-lg p-6 space-y-6 lg:col-span-2">
            {activeSubmission ? (
              <>
                {/* Inspection Header */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-neutral-100 pb-4">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-neutral-500 mb-1">
                      <span className="font-mono text-neutral-400">ID: {activeSubmission.id}</span>
                      <span>·</span>
                      <span>{t('reviewer.submitter', { name: activeSubmission.author_name })}</span>
                      <span>·</span>
                      <span className="font-mono text-neutral-700">
                        {new Date(activeSubmission.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-neutral-900">
                        {activeSubmission.mod_title} {activeSubmission.category === 'spritepack' ? t('reviewer.spritepackParen') : `(${formatVersionLabel(activeSubmission.version_str)})`}
                      </h2>
                      <span
                        className={`text-xs font-mono px-2 py-0.5 rounded font-semibold ${
                          activeSubmission.state === 'ready_for_review'
                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                            : activeSubmission.state === 'approved'
                            ? 'bg-sky-50 text-sky-800 border border-sky-200'
                            : activeSubmission.state === 'published'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-rose-50 text-rose-800 border border-rose-200'
                        }`}
                      >
                        {activeSubmission.state}
                      </span>
                    </div>
                  </div>

                  {/* Decision & Publish Buttons */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {/* Approve / Reject Actions */}
                    {activeSubmission.state === 'ready_for_review' && reviewDetail && (
                      <>
                        <button
                          onClick={() => handleOpenDecisionModal('reject')}
                          className="px-3 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 rounded border border-rose-200 flex items-center gap-1.5 transition-colors active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          {t('reviewer.reject')}
                        </button>
                        <button
                          onClick={() => handleOpenDecisionModal('approve')}
                          className="px-3.5 py-1.5 text-xs font-medium text-white bg-sky-700 hover:bg-sky-800 rounded flex items-center gap-1.5 transition-colors shadow-xs active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {t('reviewer.approve')}
                        </button>
                      </>
                    )}

                    {/* Legacy approvals created before automatic publication can still be released. */}
                    {activeSubmission.state === 'approved' && reviewDetail && (
                      <div className="flex items-center gap-2">
                        <button onClick={handleConfirmPublish} disabled={actionPending} className="px-4 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded flex items-center gap-1.5 transition-colors shadow-xs active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"><Sparkles className="w-3.5 h-3.5" />{t('reviewer.publish')}</button>
                      </div>
                    )}
                  </div>
                </div>

                {detailRequest.loading && <p role="status" className="text-xs text-neutral-500">{t('reviewer.detailLoading')}</p>}
                {detailRequest.error && <p role="alert" className="text-xs text-rose-700">{t('reviewer.detailLoadFailed', { error: detailRequest.error })} <button type="button" onClick={detailRequest.reload} className="rounded px-1 py-0.5 transition-colors underline hover:bg-neutral-100 active:bg-neutral-200 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">{t('common.retry')}</button></p>}
                {/* Independent Audit & Immutable Note Banner */}
                {reviewDetail && (
                  <div className="border border-sky-200 bg-sky-50/50 rounded-lg p-4 space-y-3 text-xs">
                    <h3 className="font-bold text-sky-950">{t('reviewer.summaryTitle')}</h3>
                    <div><span className="font-semibold">{t('reviewer.summaryMod')}</span>{resolve(reviewDetail.mod?.summary) || t('reviewer.noReason')}</div>
                    <div><span className="font-semibold">{t('reviewer.summaryVersion')}</span><MarkdownText value={reviewDetail.version?.release_notes || t('reviewer.noReason')} /></div>
                    <div><span className="font-semibold">{t('reviewer.summaryDeps')}</span>{(reviewDetail.version?.dependencies as Array<{ mod_title?: string; mod_id?: string; version_range?: string }> | undefined)?.map((item) => `${item.mod_title || item.mod_id} ${item.version_range || '*'}`).join(t('common.listSeparator')) || t('reviewer.none')}</div>
                    {shippedPlatforms?.length ? (
                      <div className="space-y-1">
                        <div className="text-[11px] text-neutral-700">{t('reviewer.splitArchiveHint')}</div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {shippedPlatforms.map((asset) => (
                            <button
                              key={asset.platform}
                              type="button"
                              aria-pressed={chosenPlatform === asset.platform}
                              onClick={() => setReportPlatform(asset.platform)}
                              className={`px-2 py-1 rounded border text-[11px] font-medium transition-colors ${chosenPlatform === asset.platform ? 'bg-sky-900 text-white border-sky-900' : 'bg-white text-sky-900 border-sky-200 hover:border-sky-400'} active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600`}
                            >
                              {assetPlatformLabel(asset.platform)}
                            </button>
                          ))}
                        </div>
                        {shippedPlatforms.filter((asset) => asset.platform === chosenPlatform).map((asset) => (
                          <div key={asset.platform} className="grid grid-cols-2 gap-2 text-[11px] text-neutral-700">
                            <span>{t('reviewer.archiveSize', { size: `${asset.size_bytes || 0} bytes` })}</span>
                            <span className="font-mono break-all">{t('reviewer.sha256', { hash: asset.sha256 || '-' })}</span>
                          </div>
                        ))}
                        {!selectedServerReport && (
                          <div role="alert" className="text-[11px] font-semibold text-rose-700">
                            {t('reviewer.missingPlatformReport', { platform: assetPlatformLabel(chosenPlatform) })}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 text-[11px] text-neutral-700">
                        <span>{t('reviewer.archiveSize', { size: `${reviewDetail.version?.size_bytes || 0} bytes` })}</span>
                        <span className="font-mono">{t('reviewer.sha256', { hash: reviewDetail.version?.sha256 || '-' })}</span>
                      </div>
                    )}
                    {/* Inspecting the package itself, not just its file list, is the point
                        of a manual review; the bytes live behind an administrator-only route. */}
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleDownloadArchive}
                        disabled={!archiveReady || archiveDownloading}
                        className="px-2.5 py-1 rounded border border-sky-300 bg-white text-sky-900 text-[11px] font-medium hover:border-sky-500 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:text-neutral-400 flex items-center gap-1.5 transition-colors active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {archiveDownloading
                          ? t('reviewer.downloadingArchive')
                          : t('reviewer.downloadArchive', { platform: archivePlatform ? ` ${assetPlatformLabel(archivePlatform)} ` : ' ' })}
                      </button>
                      {!archiveReady && (
                        <span className="text-[11px] text-neutral-500">
                          {archivePlatform
                            ? t('reviewer.archiveUnavailablePlatform')
                            : t('reviewer.archiveUnavailable')}
                        </span>
                      )}
                    </div>
                    {selectedServerReport && (
                      <div><span className="font-semibold">{shippedPlatforms?.length ? t('reviewer.reportChanges', { platform: assetPlatformLabel(chosenPlatform) }) : t('reviewer.fileChanges')}</span>{t('reviewer.reportCounts', { files: selectedServerReport.files?.length || 0, unsupported: selectedServerReport.unsupported?.length || 0, conflicts: selectedServerReport.conflicts?.length || 0 })}</div>
                    )}
                    {selectedServerReport?.sprite_sets && <div className="space-y-1"><span className="font-semibold">{t('reviewer.spriteSets')}</span>{t('reviewer.spriteSetCount', { count: selectedServerReport.sprite_sets.length })}<div className="max-h-36 overflow-auto border border-sky-200 bg-white rounded p-2">{selectedServerReport.sprite_sets.map((set) => <div key={set.id}>{set.name}{t('common.colon')}{set.items.map((item) => item.display_name).join(t('common.listSeparator'))}</div>)}</div></div>}
                    {selectedServerReport?.files && selectedServerReport.files.length > 0 && (
                      <div className="max-h-40 overflow-auto border border-sky-200 bg-white rounded">
                        {selectedServerReport.files.map((file, index) => <div key={index} className="px-2 py-1 font-mono text-[10px] border-b border-neutral-100 last:border-0">{file.source || '-'} → {file.target || '-'} ({file.class || 'file'}, {file.size || 0} bytes)</div>)}
                      </div>
                    )}
                  </div>
                )}

                {/* Static Check Results & Warnings Highlights */}
                {activeReport && (
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
                      {t('reviewer.staticTitle')}
                    </h3>

                    {/* Blockers */}
                    {activeReport.blockers.length > 0 && (
                      <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-950 space-y-1.5">
                        <div className="font-semibold text-xs flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 text-rose-700" />
                          {t('reviewer.blockersTitle')}
                        </div>
                        <ul className="list-disc list-inside text-xs space-y-1">
                          {activeReport.blockers.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Warnings & Risk Vectors */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      {/* Script / Binary Analysis */}
                      <div className="p-3 rounded border border-neutral-200 bg-neutral-50/50 space-y-1.5">
                        <div className="font-semibold text-neutral-900 flex items-center gap-1.5">
                          <FileCode className="w-4 h-4 text-neutral-600" />
                          {t('reviewer.binaryTitle')}
                        </div>
                        <p className="text-[11px] text-neutral-500">
                          {activeReport.resource_stats.binary_flag ? (
                            <span className="text-rose-700 font-semibold">
                              {t('reviewer.binaryFound')}
                            </span>
                          ) : (
                            <span className="text-emerald-700 font-medium">
                              {t('reviewer.binaryClean')}
                            </span>
                          )}
                        </p>
                        <div className="text-[11px] text-neutral-400 font-mono">
                          {t('reviewer.scriptStats', { count: activeReport.resource_stats.scripts_count })}{' '}
                          {(activeReport.resource_stats.total_size_bytes / 1024).toFixed(1)} KB
                        </div>
                      </div>

                      {/* Registrations & Giftname Conflict Check: the verdict stays in the
                          summary because folding it would hide whether a human is needed. */}
                      <details className="group rounded border border-neutral-200 bg-neutral-50/50">
                        <summary className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 cursor-pointer select-none list-none hover:bg-neutral-100/60 rounded [&::-webkit-details-marker]:hidden active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
                          <span className="font-semibold text-neutral-900 flex items-center gap-1.5">
                            <Sparkles className="w-4 h-4 text-neutral-600" />
                            {t('reviewer.spriteCheckTitle')}
                          </span>
                          {reportConflictCount > 0 ? (
                            <span className="text-[10px] text-rose-700 font-semibold">{t('reviewer.spriteConflicts', { count: reportConflictCount })}</span>
                          ) : (
                            <span className="text-[10px] text-emerald-700">{t('reviewer.spriteNoConflict')}</span>
                          )}
                          <span className="ml-auto flex items-center gap-1 text-[11px] text-neutral-500">
                            <span className="group-open:hidden">{t('common.expand')}</span>
                            <span className="hidden group-open:inline">{t('common.collapse')}</span>
                            <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" />
                          </span>
                        </summary>
                        <div className="px-3 pb-3 space-y-1.5 border-t border-neutral-200/70 pt-2">
                          {activeReport.derived_gifts.length > 0 ? (
                            <div className="text-[11px] text-neutral-600 space-y-0.5">
                              <div>{t('reviewer.registeredGifts')}</div>
                              <div className="font-mono text-[10px] text-neutral-800 bg-white p-1 rounded border border-neutral-200">
                                {activeReport.derived_gifts.join(', ')}
                              </div>
                            </div>
                          ) : (
                            <div className="text-[11px] text-neutral-500">
                              {reportConflictCount > 0
                                ? t('reviewer.noGiftWithConflicts', { count: reportConflictCount })
                                : t('reviewer.noGiftNoConflicts')}
                            </div>
                          )}
                        </div>
                      </details>
                    </div>

                    {/* Package File Tree Inspector: the per-file table is reference
                        material, so it starts folded — the conclusion cards above say
                        whether anything needs a human, and the summary keeps the counts
                        that decide whether opening it is worth the reviewer's time. */}
                    <details className="group rounded border border-neutral-200 bg-white overflow-hidden">
                      <summary className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 cursor-pointer select-none list-none hover:bg-neutral-50 [&::-webkit-details-marker]:hidden active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
                        <span className="text-xs font-semibold text-neutral-800 flex items-center gap-1.5">
                          <FolderTree className="w-4 h-4 text-neutral-600" />
                          {t('reviewer.fileTreeTitle')}
                        </span>
                        <span className="text-[11px] text-neutral-500">
                          {t('reviewer.fileTreeCount', { count: reportFiles.length })}
                          {reportBinaryCount > 0 && (
                            <span className="text-rose-700 font-semibold"> · {t('reviewer.binaryCount', { count: reportBinaryCount })}</span>
                          )}
                        </span>
                        <span className="ml-auto flex items-center gap-1 text-[11px] text-neutral-500">
                          <span className="group-open:hidden">{t('reviewer.expandFileHashes')}</span>
                          <span className="hidden group-open:inline">{t('common.collapse')}</span>
                          <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" />
                        </span>
                      </summary>

                      <div className="border-t border-neutral-200 overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500">
                            <tr>
                              <th className="py-2 px-3">{t('reviewer.colSource')}</th>
                              <th className="py-2 px-3">{t('reviewer.colTarget')}</th>
                              <th className="py-2 px-3">{t('reviewer.colKind')}</th>
                              <th className="py-2 px-3">{t('reviewer.colSize')}</th>
                              <th className="py-2 px-3">SHA-256</th>
                              <th className="py-2 px-3">{t('reviewer.colDiagnosis')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-neutral-100">
                            {reportFiles.map((file, idx) => (
                              <tr key={idx} className="hover:bg-neutral-50">
                                <td className="py-2 px-3 font-mono text-[11px] text-neutral-800">
                                  {file.source_path}
                                </td>
                                <td className="py-2 px-3 font-mono text-[11px] text-neutral-600">
                                  {file.target_path}
                                </td>
                                <td className="py-2 px-3">
                                  <span
                                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                      file.kind === 'binary'
                                        ? 'bg-rose-100 text-rose-800 font-bold'
                                        : file.kind === 'script'
                                        ? 'bg-purple-50 text-purple-800'
                                        : 'bg-neutral-100 text-neutral-700'
                                    }`}
                                  >
                                    {file.kind}
                                  </span>
                                </td>
                                <td className="py-2 px-3 font-mono tabular-nums text-neutral-600 text-[11px]">
                                  {(file.size_bytes / 1024).toFixed(1)} KB
                                </td>
                                <td className="py-2 px-3 font-mono text-[10px] text-neutral-500 whitespace-nowrap" title={file.sha256}>
                                  {shortHash(file.sha256) || '—'}
                                </td>
                                <td className="py-2 px-3 text-[11px]">
                                  {file.warnings && file.warnings.length > 0 ? (
                                    <span className="text-rose-600 font-medium">
                                      {file.warnings.join('; ')}
                                    </span>
                                  ) : (
                                    <span className="text-emerald-700">{t('reviewer.safe')}</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>
                )}
              </>
            ) : (
              <div className="py-12 text-center text-xs text-neutral-400">
                {queueRequest.loading ? t('reviewer.queueLoadingShort') : queueRequest.error ? t('reviewer.queueLoadFailedShort') : t('reviewer.queueEmpty')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Decision Input Modal (Approve or Reject) */}
      <AnimatePresence>
        {decisionModalMode && (
          <m.div
            variants={overlayVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          >
            <m.div
                variants={panelVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="bg-white rounded-lg border border-neutral-200 shadow-xl max-w-md w-full overflow-hidden"
              >

            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">
                {decisionModalMode === 'approve' ? t('reviewer.approveTitle') : t('reviewer.rejectTitle')}
              </h3>
              <button
                disabled={actionPending} onClick={() => setDecisionModalMode(null)}
                className="text-neutral-400 hover:text-neutral-600 text-xs active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                {t('common.cancel')}
              </button>
            </div>

            <form onSubmit={handleConfirmDecision} className="p-5 space-y-4 text-xs">
              <p className="text-neutral-600 leading-relaxed">
                {decisionModalMode === 'approve'
                  ? t('reviewer.approveBody')
                  : t('reviewer.rejectBody')}
              </p>

              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  {t('reviewer.reasonLabel')}
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder={
                    decisionModalMode === 'approve'
                      ? t('reviewer.reasonPlaceholderApprove')
                      : t('reviewer.reasonPlaceholderReject')
                  }
                  value={decisionReason}
                  onChange={(e) => setDecisionReason(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-neutral-900"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setDecisionModalMode(null)}
                  className="px-3 py-1.5 text-neutral-600 hover:text-neutral-900 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit" disabled={actionPending}
                  className={`px-4 py-1.5 font-medium rounded text-white transition-colors ${
                    decisionModalMode === 'approve'
                      ? 'bg-sky-700 hover:bg-sky-800'
                      : 'bg-rose-700 hover:bg-rose-800'
                  } active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600`}
                >
                  {decisionModalMode === 'approve' ? t('reviewer.confirmApprove') : t('reviewer.confirmReject')}
                </button>
              </div>
            </form>
          </m.div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
};
