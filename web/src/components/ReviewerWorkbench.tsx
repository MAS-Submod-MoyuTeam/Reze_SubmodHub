import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { getReviewSubmission } from '../../../ui/submission-api';
import { Submission, ScanReport, ScannedFile } from '../types/submodhub';
import {
  ShieldAlert,
  ShieldCheck,
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
} from 'lucide-react';

export const ReviewerWorkbench: React.FC = () => {
  const {
    currentUser,
    hasRole,
    submissions,
    versions,
    mods,
    scanReports,
    auditLogs,
    approveSubmission,
    rejectSubmission,
    publishApprovedVersion,
  } = useApp();

  const isReviewer = hasRole('admin');

  // Tab: Queue vs Audit Stream
  const [activeReviewTab, setActiveReviewTab] = useState<'queue' | 'audit'>('queue');

  // Filter in queue
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Active submission for deep inspection
  const [selectedSubId, setSelectedSubId] = useState<string>(() => submissions[0]?.id || '');
  const [reviewDetail, setReviewDetail] = useState<{ mod?: { title?: string; summary?: string; tags?: string[]; supported_platforms?: string[] }; version?: { release_notes?: string; version?: string; size_bytes?: number; sha256?: string; dependencies?: Array<{ mod_id?: string; mod_title?: string; version_range?: string; required?: boolean }> }; scan_report?: { files?: Array<{ source?: string; target?: string; size?: number; sha256?: string; class?: string }>; unsupported?: string[]; warnings?: string[]; conflicts?: unknown[]; sprite_sets?: Array<{ id: string; name: string; items: Array<{ display_name: string }> }> } } | null>(null);

  React.useEffect(() => {
    if (!selectedSubId) return;
    const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
    getReviewSubmission(base, selectedSubId).then((detail) => setReviewDetail(detail as typeof reviewDetail)).catch(() => setReviewDetail(null));
  }, [selectedSubId]);

  // Decision Modal
  const [decisionModalMode, setDecisionModalMode] = useState<'approve' | 'reject' | null>(null);
  const [decisionReason, setDecisionReason] = useState('');

  const activeSubmission = submissions.find((s) => s.id === selectedSubId) || submissions[0];
  const activeVer = versions.find((v) => v.id === activeSubmission?.version_id);
  const activeReportId = activeSubmission?.scan_report_id || activeVer?.scan_report_id;
  const activeReport = activeReportId ? scanReports[activeReportId] : null;
  const activeMod = mods.find((m) => m.id === activeSubmission?.mod_id);

  // Filtered queue
  const filteredSubmissions = submissions.filter((s) => {
    if (statusFilter === 'all') return true;
    return s.state === statusFilter;
  });

  if (!isReviewer) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center space-y-4">
        <ShieldAlert className="w-10 h-10 text-neutral-400 mx-auto" />
        <h2 className="text-base font-bold text-neutral-800">未授权访问审核工作台</h2>
        <p className="text-xs text-neutral-500 max-w-md mx-auto">
          审核工作台仅对管理员开放。
        </p>
      </div>
    );
  }

  const handleOpenDecisionModal = (mode: 'approve' | 'reject') => {
    setDecisionModalMode(mode);
    setDecisionReason(
      mode === 'approve'
        ? '已查阅 ZIP 静态检测报告，未发现需阻断发布的问题。'
        : ''
    );
  };

  const handleConfirmDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSubmission || !decisionModalMode) return;

    if (decisionModalMode === 'approve') {
      await approveSubmission(activeSubmission.id, decisionReason);
    } else {
      await rejectSubmission(activeSubmission.id, decisionReason);
    }

    setDecisionModalMode(null);
    setDecisionReason('');
  };

  const handleConfirmPublish = async () => {
    if (!activeSubmission) return;
    await publishApprovedVersion(activeSubmission.id);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="bg-white border border-neutral-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <span className="font-semibold text-neutral-900">{currentUser?.display_name}</span>
            <span>·</span>
            <span>Aegis 安全与规范审核组</span>
          </div>
          <h1 className="text-lg font-bold text-neutral-900 tracking-tight mt-0.5">
            模组待审队列、代码安全检测与发布管理
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            审核批准后自动发布；公开版本只能下架，不能修改归档字节。
          </p>
        </div>

        {/* Tab switchers */}
        <div className="flex items-center bg-neutral-100 p-0.5 rounded text-xs font-medium">
          <button
            onClick={() => setActiveReviewTab('queue')}
            className={`px-3 py-1.5 rounded transition-colors ${
              activeReviewTab === 'queue' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600'
            }`}
          >
            待审队列 ({submissions.filter((s) => s.state === 'ready_for_review').length})
          </button>
          <button
            onClick={() => setActiveReviewTab('audit')}
            className={`px-3 py-1.5 rounded transition-colors ${
              activeReviewTab === 'audit' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600'
            }`}
          >
            审核与下架审计流水 ({auditLogs.length})
          </button>
        </div>
      </div>

      {activeReviewTab === 'audit' ? (
        /* Audit Trail View (GET /review/audit) */
        <div className="bg-white border border-neutral-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-neutral-900">
                审核、发布与角色变更审计日志 (GET /review/audit)
              </h2>
              <p className="text-xs text-neutral-500">
                所有审核批准、驳回、不可变版本发布与下架操作均带有加密与操作者留痕
              </p>
            </div>
            <span className="text-xs font-mono text-neutral-400">
              共 {auditLogs.length} 条审计记录
            </span>
          </div>

          <div className="divide-y divide-neutral-100">
            {auditLogs.map((log) => {
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
                      操作人: <strong className="text-neutral-700">{log.actor_name}</strong> ({log.actor_role})
                    </span>
                    <span className="font-mono">审计 ID: {log.id}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Review Queue & Inspection Panel */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Submissions Queue List */}
          <div className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4 lg:col-span-1">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
              <h2 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
                待审提交队列 ({filteredSubmissions.length})
              </h2>
            </div>

            {/* Filter Tabs */}
            <div className="flex flex-wrap gap-1 text-[11px]">
              {[
                { id: 'all', label: '全部' },
                { id: 'ready_for_review', label: '待处理' },
                { id: 'approved', label: '已批准待发布' },
                { id: 'rejected', label: '已驳回' },
                { id: 'published', label: '已上线' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-2 py-0.5 rounded transition-colors ${
                    statusFilter === tab.id
                      ? 'bg-neutral-900 text-white font-medium'
                      : 'text-neutral-500 hover:bg-neutral-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Submissions items */}
            <div className="space-y-2">
              {filteredSubmissions.map((sub) => {
                const isSelected = sub.id === activeSubmission?.id;
                const v = versions.find((ver) => ver.id === sub.version_id);
                const reportId = sub.scan_report_id || v?.scan_report_id;
                const report = reportId ? scanReports[reportId] : null;

                return (
                  <button
                    key={sub.id}
                    onClick={() => setSelectedSubId(sub.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-all text-xs space-y-1.5 ${
                      isSelected
                        ? 'border-neutral-900 bg-neutral-50/80 font-medium'
                        : 'border-neutral-200 hover:border-neutral-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-neutral-900 truncate max-w-[160px]">
                        {sub.mod_title}
                      </span>
                      <span className="font-mono text-[11px] text-neutral-600">{sub.category === 'spritepack' ? '精灵包' : `v${sub.version_str}`}</span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-neutral-500">
                      <span>作者: {sub.author_name}</span>
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

                    {report && (
                      <div className="flex items-center gap-2 text-[10px] text-neutral-400 font-mono">
                        <span>{report.resource_stats.total_files} 文件</span>
                        <span>·</span>
                        <span className={report.blockers.length > 0 ? 'text-rose-600 font-bold' : ''}>
                          {report.blockers.length} 阻断
                        </span>
                        <span>·</span>
                        <span>{report.warnings.length} 警告</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
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
                      <span>提交人: {activeSubmission.author_name}</span>
                      <span>·</span>
                      <span className="font-mono text-neutral-700">
                        {new Date(activeSubmission.submitted_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-neutral-900">
                        {activeSubmission.mod_title} {activeSubmission.category === 'spritepack' ? '(精灵包)' : `(v${activeSubmission.version_str})`}
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
                    {activeSubmission.state === 'ready_for_review' && (
                      <>
                        <button
                          onClick={() => handleOpenDecisionModal('reject')}
                          className="px-3 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 hover:bg-rose-100 rounded border border-rose-200 flex items-center gap-1.5 transition-colors"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          驳回申请 (Reject)
                        </button>
                        <button
                          onClick={() => handleOpenDecisionModal('approve')}
                          className="px-3.5 py-1.5 text-xs font-medium text-white bg-sky-700 hover:bg-sky-800 rounded flex items-center gap-1.5 transition-colors shadow-xs"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          批准并发布
                        </button>
                      </>
                    )}

                    {/* Legacy approvals created before automatic publication can still be released. */}
                    {activeSubmission.state === 'approved' && (
                      <div className="flex items-center gap-2">
                        <button onClick={handleConfirmPublish} className="px-4 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded flex items-center gap-1.5 transition-colors shadow-xs"><Sparkles className="w-3.5 h-3.5" />发布不可变版本</button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Independent Audit & Immutable Note Banner */}
                {reviewDetail && (
                  <div className="border border-sky-200 bg-sky-50/50 rounded-lg p-4 space-y-3 text-xs">
                    <h3 className="font-bold text-sky-950">本次提交变更摘要</h3>
                    <div><span className="font-semibold">模组简介：</span>{reviewDetail.mod?.summary || '未填写'}</div>
                    <div><span className="font-semibold">版本说明：</span>{reviewDetail.version?.release_notes || '未填写'}</div>
                    <div><span className="font-semibold">前置依赖：</span>{reviewDetail.version?.dependencies?.map((item) => `${item.mod_title || item.mod_id} ${item.version_range || '*'}`).join('、') || '无'}</div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-neutral-700">
                      <span>归档大小：{reviewDetail.version?.size_bytes || 0} bytes</span>
                      <span className="font-mono">SHA-256：{reviewDetail.version?.sha256 || '-'}</span>
                    </div>
                    <div><span className="font-semibold">文件变化：</span>{reviewDetail.scan_report?.files?.length || 0} 个文件；不支持路径 {reviewDetail.scan_report?.unsupported?.length || 0} 个；冲突 {reviewDetail.scan_report?.conflicts?.length || 0} 个</div>
                    {reviewDetail.scan_report?.sprite_sets && <div className="space-y-1"><span className="font-semibold">精灵包套件：</span>{reviewDetail.scan_report.sprite_sets.length} 套<div className="max-h-36 overflow-auto border border-sky-200 bg-white rounded p-2">{reviewDetail.scan_report.sprite_sets.map((set) => <div key={set.id}>{set.name}：{set.items.map((item) => item.display_name).join('、')}</div>)}</div></div>}
                    {reviewDetail.scan_report?.files && reviewDetail.scan_report.files.length > 0 && (
                      <div className="max-h-40 overflow-auto border border-sky-200 bg-white rounded">
                        {reviewDetail.scan_report.files.map((file, index) => <div key={index} className="px-2 py-1 font-mono text-[10px] border-b border-neutral-100 last:border-0">{file.source || '-'} → {file.target || '-'} ({file.class || 'file'}, {file.size || 0} bytes)</div>)}
                      </div>
                    )}
                  </div>
                )}

                <div className="p-3 bg-neutral-50 rounded border border-neutral-200 text-xs text-neutral-600 leading-relaxed space-y-1">
                  <div className="font-semibold text-neutral-900 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-700" />
                    契约审查准则：
                  </div>
                  <p>
                    1. 审核批准后立即发布，并记录审核人与决策理由。<br />
                    2. 公开版本一旦发布即具有 SHA-256 不可变性约束，只能下架，不能修改归档字节。
                  </p>
                </div>

                {/* Static Check Results & Warnings Highlights */}
                {activeReport && (
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
                      Aegis 深度静态分析结果 (Static Security Inspection)
                    </h3>

                    {/* Blockers */}
                    {activeReport.blockers.length > 0 && (
                      <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-950 space-y-1.5">
                        <div className="font-semibold text-xs flex items-center gap-1.5">
                          <AlertTriangle className="w-4 h-4 text-rose-700" />
                          检出高危阻断项 (Blockers):
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
                          脚本与原生二进制检测
                        </div>
                        <p className="text-[11px] text-neutral-500">
                          {activeReport.resource_stats.binary_flag ? (
                            <span className="text-rose-700 font-semibold">
                              ⚠️ 包含原生执行模块 (.dll / .so)，必须人工逆向审计！
                            </span>
                          ) : (
                            <span className="text-emerald-700 font-medium">
                              ✓ 纯 RenPy 脚本与静态资源，无原生二进制载荷。
                            </span>
                          )}
                        </p>
                        <div className="text-[11px] text-neutral-400 font-mono">
                          .rpy 文件数: {activeReport.resource_stats.scripts_count} · 总字节:{' '}
                          {(activeReport.resource_stats.total_size_bytes / 1024).toFixed(1)} KB
                        </div>
                      </div>

                      {/* Registrations & Giftname Conflict Check */}
                      <div className="p-3 rounded border border-neutral-200 bg-neutral-50/50 space-y-1.5">
                        <div className="font-semibold text-neutral-900 flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-neutral-600" />
                          Sprite 礼物名与注册冲突校验
                        </div>
                        {activeReport.derived_gifts.length > 0 ? (
                          <div className="text-[11px] text-neutral-600 space-y-0.5">
                            <div>登记衍生礼物:</div>
                            <div className="font-mono text-[10px] text-neutral-800 bg-white p-1 rounded border border-neutral-200">
                              {activeReport.derived_gifts.join(', ')}
                            </div>
                            <div className="text-emerald-700 text-[10px]">✓ 未检测到重复注册冲突</div>
                          </div>
                        ) : (
                          <div className="text-[11px] text-neutral-500">
                            未登记Spritepack礼物，无覆盖冲突。
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Package File Tree Inspector */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold text-neutral-800 flex items-center gap-1.5">
                          <FolderTree className="w-4 h-4 text-neutral-600" />
                          完整包文件树与校验和 (Package File Tree)
                        </h4>
                        <span className="text-[11px] font-mono text-neutral-400">
                          共 {activeReport.files.length} 个目标映射文件
                        </span>
                      </div>

                      <div className="border border-neutral-200 rounded overflow-hidden">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500">
                            <tr>
                              <th className="py-2 px-3">归档内路径 (Source Path)</th>
                              <th className="py-2 px-3">安装目标 (Target Path)</th>
                              <th className="py-2 px-3">类型</th>
                              <th className="py-2 px-3">大小</th>
                              <th className="py-2 px-3">静态诊断</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-neutral-100">
                            {activeReport.files.map((file, idx) => (
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
                                <td className="py-2 px-3 text-[11px]">
                                  {file.warnings && file.warnings.length > 0 ? (
                                    <span className="text-rose-600 font-medium">
                                      {file.warnings.join('; ')}
                                    </span>
                                  ) : (
                                    <span className="text-emerald-700">安全合规</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="py-12 text-center text-xs text-neutral-400">
                当前待审队列暂无条目
              </div>
            )}
          </div>
        </div>
      )}

      {/* Decision Input Modal (Approve or Reject) */}
      {decisionModalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-lg border border-neutral-200 shadow-xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">
                {decisionModalMode === 'approve' ? '确认通过审核 (Approve)' : '驳回模组版本申请 (Reject)'}
              </h3>
              <button
                onClick={() => setDecisionModalMode(null)}
                className="text-neutral-400 hover:text-neutral-600 text-xs"
              >
                取消
              </button>
            </div>

            <form onSubmit={handleConfirmDecision} className="p-5 space-y-4 text-xs">
              <p className="text-neutral-600 leading-relaxed">
                {decisionModalMode === 'approve'
                  ? '确认后将立即发布此版本，并按作者提交时的选择更新目录最新版本。'
                  : '驳回后，作者将在工作台查阅此驳回理由，并可从该候选版本复制修订为新版本重新提交。'}
              </p>

              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  审核决策理由 (Mandatory Audit Reason)
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder={
                    decisionModalMode === 'approve'
                      ? '填写合规检查结论与签名说明...'
                      : '详细说明驳回原因，例如检测到未签名二进制、存在越界路径或Sprite注册重名...'
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
                  className="px-3 py-1.5 text-neutral-600 hover:text-neutral-900"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className={`px-4 py-1.5 font-medium rounded text-white transition-colors ${
                    decisionModalMode === 'approve'
                      ? 'bg-sky-700 hover:bg-sky-800'
                      : 'bg-rose-700 hover:bg-rose-800'
                  }`}
                >
                  确认{decisionModalMode === 'approve' ? '批准' : '驳回并留痕'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
