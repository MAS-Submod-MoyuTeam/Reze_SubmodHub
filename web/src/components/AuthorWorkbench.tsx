import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { ModCategory, Platform, ModSummary, ModDependency, ModVersion, ScannedFile, ModSourceType } from '../types/submodhub';
import { validateGitHubSourceInput, formatLastSyncTime, getGitHubRepoUrl } from './sourceConfig';
import { formatVersionCreatedAt } from './versionDate';
import { DeprecationNotice } from './DeprecationNotice';
import { MarkdownText } from './MarkdownText';
import { mapDependencyInput, mapDependencyRangeInput, mapDependencySelection } from './dependencyMapping';
import { DependencyNamePicker } from './DependencyNamePicker';
import { canEditVersion, versionFormState } from './versionFormState';
import { clearModImages, fetchModImages, reorderModImages, uploadModImages } from '../../../ui/submission-api';
import {
  Plus,
  Upload,
  FileCheck,
  AlertTriangle,
  AlertCircle,
  FileCode,
  ShieldCheck,
  FolderTree,
  Send,
  GitBranch,
  Github,
  CheckCircle2,
  Clock,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  X,
  Pencil,
  RefreshCw,
} from 'lucide-react';

export const AuthorWorkbench: React.FC = () => {
  const {
    currentUser,
    hasRole,
    mods,
    versions,
    scanReports,
    submissions,
    createModDraft,
    updateModDraft,
    createCandidateVersion,
    uploadArchiveAndScan,
    uploadDetailImages,
    submitVersionForReview,
    setLatestPublishedVersion,
    unpublishVersion,
    markVersionDeprecated,
    clearVersionDeprecation,
    deleteVersion,
    unpublishMod,
    deleteModDraft,
    editVersion,
    syncModReleases,
    showToast,
  } = useApp();

  // Author role check
  const isAuthor = Boolean(currentUser);

  // Active Mod in Workbench
  const userMods = mods.filter(
    (m) => m.author.id === currentUser?.id || currentUser?.roles.includes('author')
  );
  const [selectedModId, setSelectedModId] = useState<string>(() => userMods[0]?.id || '');

  // Mod Draft Creation Dialog
  const [isNewModModalOpen, setIsNewModModalOpen] = useState(false);
  const [editingModId, setEditingModId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newSummary, setNewSummary] = useState('');
  const [newAuthorDisplayName, setNewAuthorDisplayName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState<ModCategory>('submod');
  const [newMasRange, setNewMasRange] = useState('>=0.12.14');
  const [newPriority, setNewPriority] = useState(20);
  const [newTagsStr, setNewTagsStr] = useState('');
  const [newPlatforms, setNewPlatforms] = useState<Platform[]>(['windows', 'android']);
  const [pendingDetailImages, setPendingDetailImages] = useState<File[]>([]);
  const [pendingDetailImageKeys, setPendingDetailImageKeys] = useState<string[]>([]);
  const [existingDetailImages, setExistingDetailImages] = useState<string[]>([]);
  const [detailImageOrder, setDetailImageOrder] = useState<string[]>([]);
  const [clearExistingDetailImages, setClearExistingDetailImages] = useState(false);
  const [draggedDetailImage, setDraggedDetailImage] = useState<number | null>(null);
  const [detailImageOrderDirty, setDetailImageOrderDirty] = useState(false);
  const [newSourceType, setNewSourceType] = useState<ModSourceType>('local');
  const [newGitHubOwner, setNewGitHubOwner] = useState('');
  const [newGitHubRepo, setNewGitHubRepo] = useState('');
  const [newGitHubAssetRegex, setNewGitHubAssetRegex] = useState('');
  const [newGitHubSourceCode, setNewGitHubSourceCode] = useState(false);
  const [isSyncingReleases, setIsSyncingReleases] = useState(false);

  // Version Draft Creation Dialog
  const [versionFormTarget, setVersionFormTarget] = useState<'new' | string | null>(null);
  const [newVerString, setNewVerString] = useState('');
  const [newReleaseNotes, setNewReleaseNotes] = useState('');
  const [newDependencies, setNewDependencies] = useState<ModDependency[]>([{ mod_id: '', mod_title: '', version_range: '', required: true }]);
  const [manualVersions, setManualVersions] = useState<Record<string, string>>({});

  // Upload simulation state
  const [isUploading, setIsUploading] = useState(false);
  const [submittingVersionId, setSubmittingVersionId] = useState<string | null>(null);
  const [latestOnPublish, setLatestOnPublish] = useState<Record<string, boolean>>({});
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedVersionForUpload, setSelectedVersionForUpload] = useState<string>('');
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const uploadVersionIdRef = useRef<string>('');

  // GitHub Import Dialog
  const [isGithubImportOpen, setIsGithubImportOpen] = useState(false);
  const [githubReleaseUrl, setGithubReleaseUrl] = useState('');

  // Submissions Tab vs Workbench Mod Tab
  const [workbenchView, setWorkbenchView] = useState<'mods' | 'submissions'>('mods');

  // Currently inspected Scan Report modal
  const [inspectingReportId, setInspectingReportId] = useState<string | null>(null);

  const activeMod = mods.find((m) => m.id === selectedModId) || userMods[0];
  const activeModVersions = versions.filter((v) => v.mod_id === activeMod?.id);
  const authorSubmissions = submissions.filter(
    (s) => s.author_id === currentUser?.id || currentUser?.roles.includes('author')
  );
  const pendingDetailPreviewUrls = useMemo(() => new Map(pendingDetailImages.map((file, index) => [pendingDetailImageKeys[index], URL.createObjectURL(file)])), [pendingDetailImages, pendingDetailImageKeys]);
  useEffect(() => () => { pendingDetailPreviewUrls.forEach((url) => URL.revokeObjectURL(url)); }, [pendingDetailPreviewUrls]);
  const detailImageItems = detailImageOrder.map((key) => ({ key, url: key.startsWith('new:') ? pendingDetailPreviewUrls.get(key) : key, pending: key.startsWith('new:') }));

  const openVersionForm = (version?: ModVersion) => {
    const initial = versionFormState(version);
    setNewVerString(initial.version);
    setNewReleaseNotes(initial.releaseNotes);
    setNewDependencies(initial.dependencies);
    setVersionFormTarget(version?.id || 'new');
  };

  const handleCreateDraftSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    if (newSourceType === 'github_releases') {
      const sourceValidation = validateGitHubSourceInput({
        owner: newGitHubOwner,
        repo: newGitHubRepo,
        assetRegex: newGitHubAssetRegex,
        sourceCode: newGitHubSourceCode,
      });
      if (!sourceValidation.valid) {
        showToast('error', sourceValidation.error || 'GitHub 源配置不合法');
        return;
      }
    }

    const tags = newTagsStr
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    if (editingModId) {
      const saved = await updateModDraft(editingModId, {
        title: newTitle.trim(),
        summary: newSummary,
        author_display_name: newAuthorDisplayName,
        description: newDescription,
        category: newCategory,
        mas_version_range: newMasRange,
        recommended_priority: Number(newPriority),
        tags,
        supported_platforms: newPlatforms,
        source_type: newSourceType,
        github_owner: newGitHubOwner.trim(),
        github_repo: newGitHubRepo.trim(),
        github_asset_regex: newGitHubAssetRegex.trim(),
        github_source_code: newGitHubSourceCode,
      });
      if (saved) {
        const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
        if (pendingDetailImages.length > 0) {
          const pendingByKey = new Map(pendingDetailImageKeys.map((key, index) => [key, pendingDetailImages[index]]));
          const orderedFiles = detailImageOrder.filter((key) => key.startsWith('new:')).map((key) => pendingByKey.get(key)).filter((file): file is File => Boolean(file));
          const uploaded = await uploadModImages(base, editingModId, orderedFiles, true);
          const uploadedItems = uploaded.items || [];
          const newUrls = new Map(pendingDetailImageKeys.map((key, index) => [key, uploadedItems[index]?.url || '']));
          const current = await fetchModImages(base, editingModId);
          const currentByFilename = new Map(current.map((item) => [decodeURIComponent(item.url.split('/').pop() || ''), item.url]));
          const orderedFilenames = detailImageOrder.map((key) => {
            const url = key.startsWith('new:') ? newUrls.get(key) : key;
            return decodeURIComponent(url?.split('/').pop() || '');
          }).filter((filename) => currentByFilename.has(filename));
          if (orderedFilenames.length === current.length) await reorderModImages(base, editingModId, orderedFilenames);
          showToast('success', `已追加 ${orderedFiles.length} 张详情图。`);
        }
        else if (clearExistingDetailImages) {
          try { await clearModImages(base, editingModId); showToast('success', '模组详情图已清空。'); } catch (error) { showToast('error', `清空详情图失败：${error instanceof Error ? error.message : 'unknown_error'}`); }
        } else if (detailImageOrderDirty) {
          try {
            const filenames = detailImageOrder.map((url) => decodeURIComponent(url.split('/').pop() || ''));
            await reorderModImages(base, editingModId, filenames);
            showToast('success', '模组详情图顺序已保存。');
          } catch (error) { showToast('error', `详情图排序保存失败：${error instanceof Error ? error.message : 'unknown_error'}`); }
        }
        setIsNewModModalOpen(false);
        setEditingModId(null);
        setPendingDetailImages([]);
        setPendingDetailImageKeys([]);
        setExistingDetailImages([]);
        setDetailImageOrder([]);
        setClearExistingDetailImages(false);
        setDetailImageOrderDirty(false);
      }
      return;
    }

    const createdId = await createModDraft({
      title: newTitle,
      summary: newSummary,
      author_display_name: newAuthorDisplayName,
      description: newDescription,
      category: newCategory,
      mas_version_range: newMasRange,
      recommended_priority: Number(newPriority),
      tags,
      supported_platforms: newPlatforms,
      source_type: newSourceType,
      github_owner: newGitHubOwner.trim(),
      github_repo: newGitHubRepo.trim(),
      github_asset_regex: newGitHubAssetRegex.trim(),
      github_source_code: newGitHubSourceCode,
    });

    if (createdId) {
      if (pendingDetailImages.length > 0) await uploadDetailImages(createdId, pendingDetailImages);
      setSelectedModId(createdId);
      setIsNewModModalOpen(false);
      setNewTitle('');
      setNewSummary('');
      setNewDescription('');
      setEditingModId(null);
      setPendingDetailImages([]);
      setPendingDetailImageKeys([]);
      setExistingDetailImages([]);
      setDetailImageOrder([]);
      setClearExistingDetailImages(false);
      setDetailImageOrderDirty(false);
    }
  };

  const openModEditor = (mod: ModSummary) => {
    setEditingModId(mod.id);
    setNewTitle(mod.title);
    setNewSummary(mod.summary);
    setNewAuthorDisplayName(mod.author.display_name || '');
    setNewDescription(mod.description || '');
    setNewCategory(mod.category);
    setNewMasRange(mod.mas_version_range);
    setNewPriority(mod.recommended_priority);
    setNewTagsStr(mod.tags.join(', '));
    setNewPlatforms(mod.supported_platforms);
    setNewSourceType(mod.source_type || 'local');
    setNewGitHubOwner(mod.github_owner || '');
    setNewGitHubRepo(mod.github_repo || '');
    setNewGitHubAssetRegex(mod.github_asset_regex || '');
    setNewGitHubSourceCode(Boolean(mod.github_source_code));
    setPendingDetailImages([]);
    setPendingDetailImageKeys([]);
    setClearExistingDetailImages(false);
    setExistingDetailImages([]);
    setDetailImageOrder([]);
    setDetailImageOrderDirty(false);
    setDraggedDetailImage(null);
    setIsNewModModalOpen(true);
  };

  const openNewModEditor = () => {
    setEditingModId(null);
    setNewTitle('');
    setNewSummary('');
    setNewAuthorDisplayName('');
    setNewDescription('');
    setNewCategory('submod');
    setNewMasRange('>=0.12.14');
    setNewPriority(20);
    setNewTagsStr('');
    setNewPlatforms(['windows', 'android']);
    setNewSourceType('local');
    setNewGitHubOwner('');
    setNewGitHubRepo('');
    setNewGitHubAssetRegex('');
    setNewGitHubSourceCode(false);
    setPendingDetailImages([]);
    setPendingDetailImageKeys([]);
    setExistingDetailImages([]);
    setDetailImageOrder([]);
    setClearExistingDetailImages(false);
    setDetailImageOrderDirty(false);
    setDraggedDetailImage(null);
    setIsNewModModalOpen(true);
  };

  const moveDetailImage = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= detailImageOrder.length || to >= detailImageOrder.length) return;
    setDetailImageOrder((images) => {
      const next = [...images];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDetailImageOrderDirty(true);
  };

  const removeDetailImage = (key: string) => {
    setDetailImageOrder((items) => items.filter((item) => item !== key));
    if (key.startsWith('new:')) {
      const index = pendingDetailImageKeys.indexOf(key);
      if (index >= 0) {
        setPendingDetailImageKeys((keys) => keys.filter((item) => item !== key));
        setPendingDetailImages((files) => files.filter((_, fileIndex) => fileIndex !== index));
      }
    } else {
      setDetailImageOrderDirty(true);
      setExistingDetailImages((items) => items.filter((item) => item !== key));
    }
  };

  useEffect(() => {
    if (!editingModId) return;
    const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
    fetchModImages(base, editingModId).then((items) => { const urls = items.map((item) => item.url); setExistingDetailImages(urls); setDetailImageOrder(urls); }).catch(() => { setExistingDetailImages([]); setDetailImageOrder([]); });
  }, [editingModId]);

  const handleCreateVersionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMod || !versionFormTarget) return;

    const dependencies = newDependencies.filter((dependency) => dependency.mod_id.trim());
    if (versionFormTarget === 'new') {
      const versionId = await createCandidateVersion(activeMod.id, newVerString.trim(), newReleaseNotes.trim(), dependencies);
      if (!versionId) return;
    } else if (!await editVersion(versionFormTarget, newVerString.trim(), newReleaseNotes.trim(), dependencies)) {
      return;
    }
    setVersionFormTarget(null);
  };

  const handleUploadArchive = async (versionId: string, file: File) => {
    setIsUploading(true);
    setSelectedVersionForUpload(versionId);
    setUploadProgress(20);
    try {
      await uploadArchiveAndScan(versionId, file);
      setUploadProgress(100);
      setInspectingReportId(`scan_${versionId}`);
    } catch {
      // Context action already exposes the server error toast.
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setSelectedVersionForUpload('');
    }
  };


  const handleSpritepackUpload = async (file: File) => {
    if (!activeMod) return;
    const candidate = activeModVersions.find((version) => ['draft', 'uploaded', 'rejected', 'scanning'].includes(version.state));
    const versionId = candidate?.id || await createCandidateVersion(activeMod.id, 'current', '');
    if (versionId) await handleUploadArchive(versionId, file);
  };

  const handleGithubImport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubReleaseUrl.trim()) return;

    showToast('info', '正在解析 GitHub Release Asset 并拉取归档 (POST /author/github-imports)...');

    setTimeout(async () => {
      const newModId = await createModDraft({
        title: 'GitHub Imported Submod',
        summary: `导入自 ${githubReleaseUrl}，自动转换至候选版本并触发 Aegis 扫描。`,
        category: 'submod',
        tags: ['github-imported', 'dialogue'],
      });
      setSelectedModId(newModId);
      if (!newModId) return;
      const vId = await createCandidateVersion(newModId, '1.0.0-gh', '从 GitHub Release 资产导入。');
      if (vId) await uploadArchiveAndScan(vId, { name: 'github_release_asset.zip', size: 3600000 });
      setIsGithubImportOpen(false);
      setGithubReleaseUrl('');
    }, 800);
  };

  if (!isAuthor) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-neutral-400 mx-auto" />
        <h2 className="text-base font-bold text-neutral-800">未授权访问作者工作台</h2>
        <p className="text-xs text-neutral-500 max-w-md mx-auto">
          作者工作台需要先登录。
        </p>
      </div>
    );
  }

  const inspectingReport = inspectingReportId ? scanReports[inspectingReportId] : null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <input
        ref={archiveInputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          const versionId = uploadVersionIdRef.current;
          if (file && versionId === 'spritepack:new') void handleSpritepackUpload(file);
          else if (file && versionId) void handleUploadArchive(versionId, file);
        }}
        />
      {/* Top Banner & Stats */}
      <div className="bg-white border border-neutral-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <span className="font-semibold text-neutral-900">{currentUser?.display_name}</span>
            <span>·</span>
            <span>作者专属工作区</span>
          </div>
          <h1 className="text-lg font-bold text-neutral-900 tracking-tight mt-0.5">
            模组创作、ZIP 上传与扫描报告管理
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            支持旧式 ZIP 静态解构、Aegis 安全与冲突检测、不可变版本发布提交
          </p>
        </div>

        {/* View Switcher & Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-neutral-100 p-0.5 rounded text-xs font-medium mr-2">
            <button
              onClick={() => setWorkbenchView('mods')}
              className={`px-3 py-1.5 rounded transition-colors ${
                workbenchView === 'mods' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600'
              }`}
            >
              模组与候选版本
            </button>
            <button
              onClick={() => setWorkbenchView('submissions')}
              className={`px-3 py-1.5 rounded transition-colors ${
                workbenchView === 'submissions'
                  ? 'bg-white text-neutral-900 shadow-xs'
                  : 'text-neutral-600'
              }`}
            >
              提交历史与修订 ({authorSubmissions.length})
            </button>
          </div>

          <button
            onClick={() => setIsGithubImportOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200/80 rounded transition-colors"
          >
            <Github className="w-3.5 h-3.5 text-neutral-800" />
            GitHub 导入
          </button>

                  <button
                    onClick={openNewModEditor}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            新建模组草稿
          </button>
        </div>
      </div>

      {workbenchView === 'submissions' ? (
        /* Submissions & Revision History View */
        <div className="bg-white border border-neutral-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-neutral-900">版本审核提交历史与驳回修订</h2>
              <p className="text-xs text-neutral-500">查看各版本的审核流转状态与驳回理由。</p>
            </div>
            <span className="text-xs font-mono text-neutral-400">
              共 {authorSubmissions.length} 条记录
            </span>
          </div>

          {authorSubmissions.length === 0 ? (
            <div className="py-12 text-center text-xs text-neutral-400">暂无提交审核记录</div>
          ) : (
            <div className="divide-y divide-neutral-100">
              {authorSubmissions.map((sub) => {
                const subVer = versions.find((v) => v.id === sub.version_id);
                const isRejected = sub.state === 'rejected';
                const isApproved = sub.state === 'approved';
                const isPublished = sub.state === 'published';

                return (
                  <div key={sub.id} className="py-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-neutral-900 text-xs">
                          {sub.mod_title}
                        </span>
                        <span className="font-mono text-xs text-neutral-600">{sub.category === 'spritepack' ? '精灵包' : `v${sub.version_str}`}</span>
                        <span
                          className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                            isPublished
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : isApproved
                              ? 'bg-sky-50 text-sky-800 border border-sky-200'
                              : isRejected
                              ? 'bg-rose-50 text-rose-800 border border-rose-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {isPublished
                            ? '已发布 (不可变)'
                            : isApproved
                            ? '已批准待发布'
                            : isRejected
                            ? '已驳回 (需修订)'
                            : '待审队列中 (ready_for_review)'}
                        </span>
                      </div>
                      <span className="text-[11px] text-neutral-400 font-mono">
                        提交于 {new Date(sub.submitted_at).toLocaleString()}
                      </span>
                    </div>

                    {/* Decision reason & reviewer info */}
                    {sub.decision_reason && (
                      <div
                        className={`p-3 rounded text-xs leading-relaxed ${
                          isRejected
                            ? 'bg-rose-50/70 border border-rose-200 text-rose-950'
                            : 'bg-neutral-50 border border-neutral-200 text-neutral-800'
                        }`}
                      >
                        <div className="flex items-center justify-between font-semibold mb-1">
                          <span>
                            {isRejected ? '审核员驳回理由与修改意见:' : '审核员审批通过记录:'}
                          </span>
                          <span className="text-[11px] text-neutral-500 font-normal">
                            审核人: {sub.reviewer_name || 'Aegis 核心审核组'}
                          </span>
                        </div>
                        <p>{sub.decision_reason}</p>

                        {isRejected && subVer?.state === 'rejected' && (
                          <div className="pt-2 mt-2 border-t border-rose-200/80 flex items-center justify-between">
                            <span className="text-[11px] text-rose-700">
                              修改版本资料并重新上传 ZIP 后，可再次提交审核。
                            </span>
                            <button
                              onClick={() => {
                                setSelectedModId(subVer.mod_id);
                                setWorkbenchView('mods');
                                openVersionForm(subVer);
                              }}
                              className="px-3 py-1 text-xs font-medium text-white bg-rose-700 hover:bg-rose-800 rounded transition-colors flex items-center gap-1"
                            >
                              编辑被驳回版本
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Scan report link */}
                    {(sub.scan_report_id || subVer?.scan_report_id) && (
                      <div className="flex items-center gap-2 pt-1 text-[11px]">
                        <button
                          onClick={() => setInspectingReportId(sub.scan_report_id || subVer?.scan_report_id || null)}
                          className="text-emerald-700 hover:underline flex items-center gap-1 font-medium"
                        >
                          <FileCheck className="w-3.5 h-3.5" />
                          查看关联的 Aegis 静态扫描报告
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Mods & Candidate Versions Management View */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: My Mods Selector */}
          <div className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4 lg:col-span-1">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
              <h2 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
                我的模组列表 ({userMods.length})
              </h2>
              <button
                onClick={openNewModEditor}
                className="text-xs text-emerald-700 hover:underline font-medium"
              >
                + 新建草稿
              </button>
            </div>

            <div className="space-y-1.5">
              {userMods.map((m) => {
                const isSelected = m.id === activeMod?.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedModId(m.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-all text-xs space-y-1 ${
                      isSelected
                        ? 'border-neutral-900 bg-neutral-50/80 font-medium'
                        : 'border-neutral-200 hover:border-neutral-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-neutral-900 truncate max-w-[170px]">
                        {m.title}
                      </span>
                      <span className="text-[10px] font-mono text-neutral-400">
                        {m.category === 'spritepack' ? 'Spritepack' : 'Submod'}
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-500 line-clamp-1">{m.summary}</p>
                    <div className="flex items-center justify-between pt-1 text-[10px] text-neutral-400">
                      <span>MAS {m.mas_version_range}</span>
                      <span>{m.is_published ? '已公开' : '草稿开发中'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Selected Mod Management & Versions */}
          <div className="bg-white border border-neutral-200 rounded-lg p-6 space-y-6 lg:col-span-2">
            {activeMod ? (
              <>
                {/* Active Mod Header */}
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-neutral-100 pb-4">
                  <div>
                    <div className="flex items-center gap-2 text-xs text-neutral-500 mb-1">
                      <span className="font-mono text-neutral-400">ID: {activeMod.id}</span>
                      <span>·</span>
                      <span className="font-medium text-emerald-700">{activeMod.category}</span>
                      <span>·</span>
                      <span>优先级权重: {activeMod.recommended_priority}</span>
                    </div>
                    <h2 className="text-base font-bold text-neutral-900">{activeMod.title}</h2>
                    <p className="text-xs text-neutral-600 mt-1">{activeMod.summary}</p>
                    {activeMod.source_type === 'github_releases' && (
                      <div className="mt-2.5 p-2.5 bg-neutral-50 border border-neutral-200 rounded text-xs space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-neutral-500 flex items-center gap-1">
                            <Github className="w-3.5 h-3.5" />
                            GitHub 源:
                          </span>
                          <a
                            href={getGitHubRepoUrl(activeMod.github_owner, activeMod.github_repo)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-700 hover:underline font-mono"
                          >
                            {activeMod.github_owner}/{activeMod.github_repo}
                          </a>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-600">
                          <span>正则: <code className="text-neutral-800">{activeMod.github_asset_regex || '无（仅源码包）'}</code></span>
                          <span>最近同步: {formatLastSyncTime(activeMod.github_last_sync_at)}</span>
                        </div>
                        {activeMod.github_last_sync_error && (
                          <div className="text-[11px] text-rose-600 bg-rose-50 p-1.5 rounded border border-rose-200 mt-1">
                            同步状态: {activeMod.github_last_sync_error}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openModEditor(activeMod)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 border border-neutral-300 hover:bg-neutral-50 rounded transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      编辑模组
                    </button>
                    {activeMod.is_published ? <button type="button" onClick={() => { if (window.confirm('确认下架这个模组？版本、归档和详情图会保留。')) void unpublishMod(activeMod.id); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 border border-amber-200 hover:bg-amber-50 rounded transition-colors">下架模组</button> : activeModVersions.every((version) => version.state !== 'published') && <button type="button" onClick={() => { if (window.confirm('确认删除草稿模组？候选版本、扫描记录和详情图会一并删除。')) void deleteModDraft(activeMod.id); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-700 border border-rose-200 hover:bg-rose-50 rounded transition-colors">删除草稿模组</button>}
                    {activeMod.source_type === 'github_releases' ? (
                      <button
                        type="button"
                        disabled={isSyncingReleases}
                        onClick={async () => {
                          setIsSyncingReleases(true);
                          try {
                            await syncModReleases(activeMod.id);
                          } finally {
                            setIsSyncingReleases(false);
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded transition-colors"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isSyncingReleases ? 'animate-spin' : ''}`} />
                        {isSyncingReleases ? '正在同步...' : '立即同步 Releases'}
                      </button>
                    ) : (
                      activeMod.category !== 'spritepack' && (
                        <button
                          onClick={() => openVersionForm()}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          + 创建候选版本
                        </button>
                      )
                    )}
                  </div>
                </div>

                {activeMod.category === 'spritepack' ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="text-xs font-bold text-neutral-900 uppercase">当前精灵包</h3>
                      <button
                        type="button"
                        disabled={isUploading || activeModVersions.some((version) => version.state === 'ready_for_review')}
                        onClick={() => {
                          uploadVersionIdRef.current = 'spritepack:new';
                          if (archiveInputRef.current) archiveInputRef.current.value = '';
                          archiveInputRef.current?.click();
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded disabled:opacity-40"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        {activeModVersions.some((version) => version.state === 'published') ? '上传替换包' : '上传精灵包 ZIP'}
                      </button>
                    </div>
                    {activeModVersions.some((version) => version.state === 'published') && <p className="text-xs text-neutral-600">已有公开精灵包。替换包审核通过后将成为唯一可下载的包。</p>}
                    {!activeModVersions.length && <p className="text-xs text-neutral-500">尚未上传精灵包。</p>}
                    {activeModVersions.filter((version) => version.state !== 'published' && version.state !== 'unpublished').map((version) => {
                      const report = version.scan_report_id ? scanReports[version.scan_report_id] : null;
                      return (
                        <div key={version.id} className="border border-neutral-200 rounded-md p-4 space-y-3 text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold text-neutral-800">待发布包 · {version.state}</span>
                            {version.state !== 'ready_for_review' && <button onClick={() => { if (window.confirm('确认删除此草稿包？')) void deleteVersion(version.id); }} className="text-rose-700">删除草稿</button>}
                          </div>
                          {report?.sprite_sets && (
                            <div className="space-y-2">
                              <div className="font-medium text-neutral-700">识别到 {report.sprite_sets.length} 套 · {report.sprite_sets.reduce((count, set) => count + set.items.length, 0)} 个 JSON 项目</div>
                              <div className="max-h-48 overflow-y-auto border border-neutral-200 rounded p-2 space-y-1">
                                {report.sprite_sets.map((set) => <div key={set.id}><span className="font-medium">{set.name}</span><span className="text-neutral-500"> · {set.items.map((item) => item.display_name).join('、')}</span></div>)}
                              </div>
                            </div>
                          )}
                          {report?.blockers?.length ? <p className="text-rose-700">扫描阻断：{report.blockers.join('；')}</p> : null}
                          {version.state === 'uploaded' && report && (
                            <button disabled={Boolean(report.blockers?.length) || submittingVersionId === version.id} onClick={async () => {
                              setSubmittingVersionId(version.id);
                              try { await submitVersionForReview(version.id, true); } finally { setSubmittingVersionId(null); }
                            }} className="px-3 py-1.5 bg-emerald-700 text-white rounded disabled:opacity-40 flex items-center gap-1.5">
                              <Send className="w-3.5 h-3.5" />提交审核
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
                      候选与发布版本列表 ({activeModVersions.length})
                    </h3>
                    <span className="text-[11px] text-neutral-400">
                      上传 ZIP 归档后将自动触发静态解析流水线
                    </span>
                  </div>

                  {activeModVersions.length === 0 ? (
                    <div className="py-8 text-center border border-dashed border-neutral-200 rounded-lg space-y-2">
                      <p className="text-xs text-neutral-500">当前模组尚无任何候选版本。</p>
                      <button
                        onClick={() => openVersionForm()}
                        className="text-xs text-emerald-700 hover:underline font-medium"
                      >
                        立即创建第一个版本 (如 1.0.0)
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {activeModVersions.map((v) => {
                        const report = v.scan_report_id ? scanReports[v.scan_report_id] : null;
                        const hasBlockers = report && report.blockers.length > 0;
                        const isUnderReview = v.state === 'ready_for_review';
                        const isPublished = v.state === 'published';
                        const isDraft = v.state === 'draft';
                        const isUploaded = v.state === 'uploaded';

                        return (
                          <div
                            key={v.id}
                            className="p-4 rounded-lg border border-neutral-200 bg-neutral-50/50 space-y-3"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-neutral-900 font-mono">
                                  {v.version ? `v${v.version}` : '版本待识别'}
                                </span>
                                <span
                                  className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                                    isPublished
                                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                      : isUnderReview
                                      ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                      : v.state === 'rejected'
                                      ? 'bg-rose-50 text-rose-800 border border-rose-200'
                                      : 'bg-neutral-100 text-neutral-700'
                                  }`}
                                >
                                  状态: {v.state}
                                </span>
                                {v.is_immutable && (
                                  <span className="text-[10px] text-neutral-400 font-mono">
                                    [不可变归档]
                                  </span>
                                )}
                              </div>

                              {!isPublished && (
                                <button onClick={() => { if (window.confirm('确认删除此版本？该操作不可恢复。')) void deleteVersion(v.id); }} className="px-2.5 py-1.5 text-xs text-rose-700 border border-rose-200 rounded hover:bg-rose-50">{isDraft ? '删除草稿' : '删除旧版本'}</button>
                              )}
                              {isPublished && (
                                <>
                                  {activeMod?.latest_version_id === v.id ? (
                                    <span className="text-[11px] text-emerald-700">目录最新版本</span>
                                  ) : (
                                    <button onClick={() => void setLatestPublishedVersion(v.id)} className="px-2.5 py-1.5 text-xs text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-50">设为最新版本</button>
                                  )}
                                  <button onClick={() => { const reason = window.prompt('请输入下架理由'); if (reason?.trim()) void unpublishVersion(v.id, reason); }} className="px-2.5 py-1.5 text-xs text-amber-700 border border-amber-200 rounded hover:bg-amber-50">下架版本</button>
                                </>
                              )}
                              {!v.deprecated && v.state !== 'draft' && (
                                <button onClick={() => { const reason = window.prompt('请输入不推荐使用的原因'); if (reason?.trim()) void markVersionDeprecated(v.id, reason); }} className="px-2.5 py-1.5 text-xs text-orange-700 border border-orange-200 rounded hover:bg-orange-50">标记不推荐</button>
                              )}
                              {v.deprecated && (
                                <button onClick={() => { if (window.confirm('取消不推荐标记并清除原因？')) void clearVersionDeprecation(v.id); }} className="px-2.5 py-1.5 text-xs text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-50">取消不推荐</button>
                              )}
                              {canEditVersion(v.state) && (
                                <button onClick={() => openVersionForm(v)} className="px-2.5 py-1.5 text-xs text-sky-700 border border-sky-200 rounded hover:bg-sky-50">{isDraft ? '编辑草稿' : '编辑版本'}</button>
                              )}

                              <span className="text-[11px] text-neutral-400 font-mono">
                                创建于: {formatVersionCreatedAt(v.created_at)}
                              </span>
                            </div>

                              {/* Release Notes */}
                            <MarkdownText value={v.release_notes || '暂无发布说明'} className="text-xs text-neutral-600 bg-white p-2.5 rounded border border-neutral-200/80" />

                            <DeprecationNotice deprecated={v.deprecated} reason={v.deprecation_reason} />

                            {v.dependencies.length > 0 && (
                              <div className="space-y-2 text-xs">
                                <div className="font-medium text-neutral-700">依赖模组</div>
                                <div className="text-[11px] text-neutral-500">版本范围可留空；例如 &gt;1.0.0（即 1.0.0&lt;X）或 1.0.0&lt;X&lt;2.0.0</div>
                                {v.dependencies.map((dep, index) => (
                                  <div key={`${dep.mod_id}-${index}`} className="flex flex-wrap items-center gap-2">
                                    {isUploaded ? (
                                      <>
                                        <DependencyNamePicker
                                          label={`${dep.mod_title || dep.mod_id} 对应站内模组`}
                                          value={dep.linked_mod_id ? (mods.find((candidate) => candidate.id === dep.linked_mod_id)?.title || dep.mod_title || dep.mod_id) : (dep.mod_title || dep.mod_id)}
                                          options={mods.filter((candidate) => candidate.is_published && candidate.id !== v.mod_id)}
                                          onCommit={(name) => void editVersion(v.id, v.version, v.release_notes, v.dependencies.map((item, position) => position === index ? mapDependencyInput(item, name, mods, v.mod_id) : item))}
                                          onSelect={(mod) => void editVersion(v.id, v.version, v.release_notes, v.dependencies.map((item, position) => position === index ? mapDependencySelection(item, mod) : item))}
                                        />
                                        <input
                                          aria-label={`${dep.mod_title || dep.mod_id} 依赖版本范围（可空）`}
                                          value={dep.version_range ?? ''}
                                          onChange={(event) => void editVersion(v.id, v.version, v.release_notes, v.dependencies.map((item, position) => position === index ? mapDependencyRangeInput(item, event.target.value) : item))}
                                          placeholder="版本范围（可空）"
                                          className="w-44 max-w-full border border-neutral-300 bg-white rounded px-2 py-1.5 font-mono"
                                        />
                                      </>
                                    ) : <span className="text-neutral-600">{dep.mod_title || dep.mod_id} · {dep.version_range || '不限版本'} · {dep.linked_mod_id ? `已关联：${mods.find((candidate) => candidate.id === dep.linked_mod_id)?.title || dep.linked_mod_id}` : '未关联站内模组'}</span>}
                                  </div>
                                ))}
                              </div>
                            )}

                              {isUploaded && !v.version && (
                                <div className="flex flex-wrap items-end gap-2 text-xs">
                                  <label className="flex-1 min-w-48 text-neutral-700">
                                    <span className="block mb-1">未识别到唯一版本标识，请手动填写</span>
                                    <input value={manualVersions[v.id] || ''} onChange={(event) => setManualVersions((prev) => ({ ...prev, [v.id]: event.target.value }))} placeholder="例如 1.27.1" className="w-full px-2.5 py-1.5 rounded border border-neutral-300 bg-white font-mono" />
                                  </label>
                                  <button disabled={!manualVersions[v.id]?.trim()} onClick={() => void editVersion(v.id, manualVersions[v.id].trim(), v.release_notes)} className="px-3 py-1.5 rounded bg-neutral-900 text-white disabled:opacity-40">保存版本标识</button>
                                </div>
                              )}

                            {/* Scan Summary Banner if report available */}
                            {report && (
                              <div className="p-3 bg-white rounded border border-neutral-200 space-y-2 text-xs">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 font-medium text-neutral-800">
                                    <FileCheck className="w-4 h-4 text-neutral-600" />
                                    <span>ZIP 静态检测报告: {report.files.length} 个文件</span>
                                    {report.resource_stats.binary_flag && (
                                      <span className="text-[10px] text-amber-800 font-semibold">
                                        检出二进制，仅提示
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => setInspectingReportId(report.id)}
                                    className="text-xs text-emerald-700 hover:underline font-medium"
                                  >
                                    查阅完整报告与文件树 →
                                  </button>
                                </div>

                                {report.resource_stats.binary_flag && (
                                  <p className="text-[11px] text-amber-900">检测到二进制文件。请查阅文件路径与 SHA-256；这不是恶意代码判定，也不会单独阻止提交审核。</p>
                                )}

                                {report.blockers.length > 0 && (
                                  <div className="p-2 bg-rose-50 rounded border border-rose-200 text-rose-800 text-[11px] space-y-1">
                                    <div className="font-semibold flex items-center gap-1">
                                      <AlertCircle className="w-3.5 h-3.5" />
                                      存在 {report.blockers.length} 项阻断错误 (禁止提交审核):
                                    </div>
                                    <ul className="list-disc list-inside space-y-0.5">
                                      {report.blockers.map((b, idx) => (
                                        <li key={idx}>{b}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Version Action Toolbar */}
                            <div className="pt-1 flex flex-wrap items-center justify-between gap-3 text-xs">
                              <div className="flex items-center gap-2">
                                {/* Upload / Re-upload ZIP Trigger */}
                                {!isPublished && (
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      disabled={isUploading}
                                      onClick={() => {
                                        uploadVersionIdRef.current = v.id;
                                        setSelectedVersionForUpload(v.id);
                                        if (archiveInputRef.current) archiveInputRef.current.value = '';
                                        archiveInputRef.current?.click();
                                      }}
                                      className="px-3 py-1.5 font-medium text-neutral-800 bg-white hover:bg-neutral-100 rounded border border-neutral-300 flex items-center gap-1.5 transition-colors"
                                    >
                                      <Upload className="w-3.5 h-3.5 text-neutral-600" />
                                      {report ? '重新上传 ZIP 归档' : '上传 ZIP 归档 (application/zip)'}
                                    </button>
                                  </div>
                                )}
                              </div>

                              {/* Submit for Review Action (Section 1 & 2 contract) */}
                              {!isPublished && !isUnderReview && isUploaded && report && (
                                <div className="flex items-center gap-2">
                                <label className="flex items-center gap-1.5 text-[11px] text-neutral-600"><input type="checkbox" checked={latestOnPublish[v.id] ?? true} onChange={(event) => setLatestOnPublish((prev) => ({ ...prev, [v.id]: event.target.checked }))} />发布后设为最新版本</label>
                                <button
                                  disabled={Boolean(hasBlockers) || !v.version || submittingVersionId === v.id}
                                  onClick={async () => {
                                    setSubmittingVersionId(v.id);
                                    try { await submitVersionForReview(v.id, latestOnPublish[v.id] ?? true); } finally { setSubmittingVersionId(null); }
                                  }}
                                  className={`px-3.5 py-1.5 font-medium rounded flex items-center gap-1.5 transition-colors shadow-xs ${
                                    hasBlockers || !v.version || submittingVersionId === v.id
                                      ? 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                                      : 'bg-emerald-700 hover:bg-emerald-800 text-white'
                                  }`}
                                >
                                  <Send className="w-3.5 h-3.5" />
                                  提交审核 (POST /submit)
                                </button>
                                </div>
                              )}

                              {isUnderReview && (
                                <span className="text-xs text-amber-700 flex items-center gap-1">
                                  <Clock className="w-3.5 h-3.5" />
                                  审核中，等待审核员决策
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                )}
              </>
            ) : (
              <div className="py-12 text-center text-neutral-400 text-xs">
                请先在左侧选择或新建一个模组草稿。
              </div>
            )}
          </div>
        </div>
      )}

      {/* Uploading Progress Modal */}
      {isUploading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full space-y-4 text-center shadow-xl animate-in fade-in">
            <Upload className="w-8 h-8 text-emerald-700 mx-auto animate-bounce" />
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                正在上传 ZIP 归档并执行静态安全扫描
              </h3>
              <p className="text-xs text-neutral-500 mt-1">
                解构目录树、计算 SHA-256、检查 Ren'Py 脚本语法与 Sprite 锚点...
              </p>
            </div>
            <div className="w-full bg-neutral-100 rounded-full h-2 overflow-hidden">
              <div
                className="bg-emerald-600 h-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <div className="text-[11px] font-mono text-neutral-400">
              Idempotency-Key 校验通过 · {uploadProgress}%
            </div>
          </div>
        </div>
      )}

      {/* Full Scan Report Inspector Modal */}
      {inspectingReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-lg border border-neutral-200 shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
            <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between shrink-0 bg-neutral-50/50">
              <div className="flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-neutral-700" />
                <div>
                  <h3 className="text-sm font-bold text-neutral-900">
                    ZIP 逐文件静态检测报告
                  </h3>
                  <div className="text-[11px] text-neutral-500 font-mono">
                    ID: {inspectingReport.id} · 扫描状态: {inspectingReport.status}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setInspectingReportId(null)}
                className="text-neutral-400 hover:text-neutral-700 text-xs px-2 py-1 rounded"
              >
                关闭
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 text-xs text-neutral-700 leading-relaxed">
              {/* Blockers & Warnings */}
              {inspectingReport.blockers.length > 0 && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 space-y-1.5">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-rose-700" />
                    静态检测阻断原因 (Blockers - 禁止提交上线):
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    {inspectingReport.blockers.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {inspectingReport.warnings.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-700" />
                    合规性警告提示 (Warnings - 审核员将重点关注):
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-xs">
                    {inspectingReport.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {inspectingReport.resource_stats.binary_flag && (
                <p className="text-amber-900 bg-amber-50 border border-amber-200 rounded p-3">二进制文件仅作静态提示，未自动阻断；此报告不判定文件是否恶意。</p>
              )}

              {inspectingReport.unsupported_paths.length > 0 && (
                <div className="p-3 bg-neutral-50 border border-neutral-200 rounded space-y-1">
                  <div className="font-semibold">未映射到 MAS 安装路径的归档文件</div>
                  <ul className="list-disc list-inside font-mono break-all">
                    {inspectingReport.unsupported_paths.map((path) => <li key={path}>{path}</li>)}
                  </ul>
                </div>
              )}

              {/* Submod Registration Confidence Rule (Section 2 explicit requirement) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-neutral-900 uppercase tracking-wider text-xs">
                    静态 Submod 注册标识 (Registrations)
                  </h4>
                  <span className="text-[11px] text-rose-700 font-medium">
                    * 契约规范：未知静态解析结果不得显示成“安全”
                  </span>
                </div>
                <div className="border border-neutral-200 rounded divide-y divide-neutral-100">
                  {inspectingReport.registrations.length === 0 ? (
                    <div className="p-3 text-neutral-500">未检测到可识别的 `Submod(...)` 注册声明。请确认 ZIP 已包含 `.rpy` 注册代码；这不代表代码安全或无注册。</div>
                  ) : inspectingReport.registrations.map((reg) => (
                    <div
                      key={reg.submod_id}
                      className="p-3 flex items-center justify-between bg-white text-xs"
                    >
                      <div>
                        <div className="font-semibold text-neutral-900">{reg.name}</div>
                        <div className="text-[11px] text-neutral-500 font-mono">
                          ID: {reg.submod_id} · 版本: {reg.version} · 作者: {reg.author}
                          {reg.source_path && <><br />来源文件: {reg.source_path}</>}
                        </div>
                      </div>
                      <span
                        className={`text-[11px] font-mono px-2 py-0.5 rounded font-semibold ${
                          reg.confidence === 'known'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-rose-100 text-rose-900 border border-rose-300'
                        }`}
                      >
                        解析置信度: {reg.confidence.toUpperCase()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sprite Identities & Derived Gifts */}
              {inspectingReport.sprite_identities.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-bold text-neutral-900 uppercase tracking-wider text-xs">
                    Spritepack 衍生礼物登记 (.gift 解析)
                  </h4>
                  <div className="border border-neutral-200 rounded divide-y divide-neutral-100">
                    {inspectingReport.sprite_identities.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-3 flex items-center justify-between bg-white text-xs"
                      >
                        <div>
                          <div className="font-semibold text-neutral-900 font-mono">
                            {item.giftname}.gift
                          </div>
                          <div className="text-[11px] text-neutral-500">
                            类别: {item.category} · 包含姿态: {item.poses.join(', ')}
                          </div>
                        </div>
                        <span className="text-[11px] font-mono text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          礼物名已锚定
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Package Files Tree / Detailed Table */}
              <div className="space-y-2">
                <h4 className="font-bold text-neutral-900 uppercase tracking-wider text-xs">
                  逐文件清单与校验和 (Files Tree)
                </h4>
                <div className="border border-neutral-200 rounded overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left text-xs border-collapse">
                    <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 font-medium">
                      <tr>
                        <th className="py-2 px-3">路径与文件类别</th>
                        <th className="py-2 px-3">大小</th>
                        <th className="py-2 px-3">SHA-256 校验和</th>
                        <th className="py-2 px-3">警告</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {inspectingReport.files.map((f, i) => (
                        <tr key={i} className="hover:bg-neutral-50/70">
                          <td className="py-2 px-3">
                            <div className="font-mono text-neutral-900 font-medium text-[11px]">
                              {f.source_path}
                            </div>
                            <div className="text-[10px] text-neutral-400 capitalize">
                              种类: {f.kind}
                            </div>
                          </td>
                          <td className="py-2 px-3 font-mono tabular-nums text-neutral-600 text-[11px]">
                            {(f.size_bytes / 1024).toFixed(1)} KB
                          </td>
                          <td className="py-2 px-3 font-mono tabular-nums text-[10px] text-neutral-500 break-all" title={f.sha256}>
                            {f.sha256}
                          </td>
                          <td className="py-2 px-3 text-[11px]">
                            {f.warnings && f.warnings.length > 0 ? (
                              <span className="text-rose-600 font-medium">
                                {f.warnings.join('; ')}
                              </span>
                            ) : (
                              <span className="text-neutral-500">无逐文件提示</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-neutral-200 bg-neutral-50/50 flex justify-end">
              <button
                onClick={() => setInspectingReportId(null)}
                className="px-4 py-1.5 text-xs font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded transition-colors"
              >
                完成查看
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Mod Draft Modal */}
      {isNewModModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-lg border border-neutral-200 shadow-xl max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">{editingModId ? '编辑模组元数据 (PATCH /author/mods/{id})' : '新建模组草稿 (POST /author/mods)'}</h3>
              <button
                onClick={() => { setIsNewModModalOpen(false); setEditingModId(null); }}
                className="text-neutral-400 hover:text-neutral-600 text-xs"
              >
                取消
              </button>
            </div>

            <form onSubmit={handleCreateDraftSubmit} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block font-medium text-neutral-700 mb-1">内容与版本来源 (Source)</label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-neutral-100 rounded border border-neutral-200">
                  <button
                    type="button"
                    onClick={() => setNewSourceType('local')}
                    className={`py-1.5 text-xs font-medium rounded transition-colors ${
                      newSourceType === 'local'
                        ? 'bg-white text-neutral-900 shadow-xs border border-neutral-200/60'
                        : 'text-neutral-500 hover:text-neutral-800'
                    }`}
                  >
                    本站上传 (本地候选版本)
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewSourceType('github_releases')}
                    className={`py-1.5 text-xs font-medium rounded transition-colors ${
                      newSourceType === 'github_releases'
                        ? 'bg-white text-neutral-900 shadow-xs border border-neutral-200/60'
                        : 'text-neutral-500 hover:text-neutral-800'
                    }`}
                  >
                    GitHub Releases
                  </button>
                </div>
              </div>

              {newSourceType === 'github_releases' && (
                <div className="rounded border border-emerald-200 bg-emerald-50/40 p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-neutral-700 mb-1">GitHub 组织/用户 (Owner) *</label>
                      <input
                        type="text"
                        required={newSourceType === 'github_releases'}
                        placeholder="例如: Monika-After-Story"
                        value={newGitHubOwner}
                        onChange={(e) => setNewGitHubOwner(e.target.value)}
                        className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600 bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-neutral-700 mb-1">GitHub 仓库名 (Repo) *</label>
                      <input
                        type="text"
                        required={newSourceType === 'github_releases'}
                        placeholder="例如: MonikaModDev"
                        value={newGitHubRepo}
                        onChange={(e) => setNewGitHubRepo(e.target.value)}
                        className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600 bg-white font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-medium text-neutral-700 mb-1">Release 资产文件名正则 (RE2)</label>
                    <input
                      type="text"
                      placeholder="例如: ^MyMod[-_]v?\d+\.\d+\.\d+.*\.zip$"
                      value={newGitHubAssetRegex}
                      onChange={(e) => setNewGitHubAssetRegex(e.target.value)}
                      className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600 bg-white font-mono"
                    />
                    <p className="mt-1 text-[11px] text-neutral-500">
                      匹配 Release 资产文件名，仅匹配 .zip 文件才允许下载。示例: <code className="bg-neutral-100 px-1 py-0.5 rounded">^MyMod.*\.zip$</code>
                    </p>
                  </div>

                  <div className="flex items-start gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="gh_source_code_fallback"
                      checked={newGitHubSourceCode}
                      onChange={(e) => setNewGitHubSourceCode(e.target.checked)}
                      className="mt-0.5 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <label htmlFor="gh_source_code_fallback" className="text-xs text-neutral-700 cursor-pointer">
                      无匹配时使用 Release source code ZIP
                      <span className="block text-[11px] text-neutral-500">
                        若资产正则未匹配到任何 .zip 资产，自动回退使用 GitHub Release 的源码包 (zipball)。
                      </span>
                    </label>
                  </div>
                </div>
              )}

              <div>
                <label className="block font-medium text-neutral-700 mb-1">模组标题 (Title)</label>
                <input
                  type="text"
                  required
                  placeholder="例如: Monika Cozy Winter Dates"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  一句话简介 (Summary)
                </label>
                <textarea
                  rows={2}
                  required
                  placeholder="简要概括该模组为玩家带来的全新体验与内容..."
                  value={newSummary}
                  onChange={(e) => setNewSummary(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  详细简介 (Markdown，可选)
                </label>
                <textarea
                  rows={6}
                  placeholder={'## 模组介绍\n\n支持 Markdown，可填写功能、安装说明和兼容性信息。'}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600 font-mono"
                />
                <p className="mt-1 text-[11px] text-neutral-400">
                  将在模组详情页渲染；留空时使用一句话简介。
                </p>
              </div>

              <div>
                <label className="block font-medium text-neutral-700 mb-1">作者显示名（可选）</label>
                <input
                  type="text"
                  value={newAuthorDisplayName}
                  onChange={(e) => setNewAuthorDisplayName(e.target.value)}
                  placeholder="留空则使用上传者账号名称"
                  className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600"
                />
                <p className="mt-1 text-[11px] text-neutral-400">仅修改目录中的作者显示，不改变上传者权限。</p>
              </div>

              <div className="rounded border border-neutral-200 bg-neutral-50 p-3 space-y-2">
                <label className="block font-medium text-neutral-700">模组详情图（可选，最多 8 张）</label>
                {detailImageItems.length > 0 && !clearExistingDetailImages && <div className="grid grid-cols-4 gap-2">{detailImageItems.map((item, index) => <div key={item.key} draggable onDragStart={() => setDraggedDetailImage(index)} onDragEnd={() => setDraggedDetailImage(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (draggedDetailImage !== null) moveDetailImage(draggedDetailImage, index); setDraggedDetailImage(null); }} className={`cursor-grab rounded border bg-white p-1 active:cursor-grabbing ${draggedDetailImage === index ? 'border-emerald-500 opacity-60' : item.pending ? 'border-amber-300' : 'border-neutral-200'}`} title="拖动以调整顺序"><div className="relative"><img src={item.url} alt={`${item.pending ? '待上传' : '已有'}详情图 ${index + 1}`} className="h-16 w-full rounded object-cover" /><button type="button" aria-label={`删除详情图 ${index + 1}`} onClick={(event) => { event.stopPropagation(); removeDetailImage(item.key); }} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-xs text-white hover:bg-rose-600">×</button></div><span className="block text-center text-[10px] text-neutral-400">#{index + 1}{item.pending ? ' · 待上传' : ''}</span></div>)}</div>}
                {detailImageItems.length > 1 && !clearExistingDetailImages && <p className="text-[11px] text-neutral-500">拖动图片调整展示顺序，保存模组后生效。</p>}
                {editingModId && existingDetailImages.length > 0 && <button type="button" onClick={() => setClearExistingDetailImages((value) => !value)} className="text-[11px] text-rose-700 hover:underline">{clearExistingDetailImages ? '保留现有详情图' : '清空现有详情图'}</button>}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    const available = Math.max(0, 8 - detailImageOrder.length);
                    const additions = files.slice(0, available);
                    const keys = additions.map((_, index) => `new:${Date.now()}:${index}`);
                    setPendingDetailImages((current) => [...current, ...additions]);
                    setPendingDetailImageKeys((current) => [...current, ...keys]);
                    setDetailImageOrder((current) => [...current, ...keys]);
                    setClearExistingDetailImages(false);
                  }}
                  className="block w-full text-xs text-neutral-600 file:mr-2 file:rounded file:border-0 file:bg-neutral-900 file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-neutral-800"
                />
                <p className="text-[11px] text-neutral-500">支持 PNG、JPEG、WebP、GIF；单张最多 10 MB。选择新图片会追加到现有详情图，最多 8 张。</p>
                {pendingDetailImages.length > 0 && <p className="text-[11px] text-emerald-700">已追加 {pendingDetailImages.length} 张待上传图片，可先拖动调整完整顺序。</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-neutral-700 mb-1">分类 (Category)</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as ModCategory)}
                    className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600 bg-white"
                  >
                    <option value="submod">Submod (功能扩展/剧本模组)</option>
                    <option value="spritepack">Spritepack (服饰/发带/配件)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-neutral-700 mb-1">
                    MAS 兼容范围
                  </label>
                  <input
                    type="text"
                    required
                    value={newMasRange}
                    onChange={(e) => setNewMasRange(e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-neutral-700 mb-1">
                    推荐优先级 (0-100)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={newPriority}
                    onChange={(e) => setNewPriority(Number(e.target.value))}
                    className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-medium text-neutral-700 mb-1">标签 (逗号分隔)</label>
                  <input
                    type="text"
                    value={newTagsStr}
                    onChange={(e) => setNewTagsStr(e.target.value)}
                    placeholder="例如：dialogue, cozy, dates"
                    className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => { setIsNewModModalOpen(false); setEditingModId(null); }}
                  className="px-3 py-1.5 text-neutral-600 hover:text-neutral-900"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-white bg-emerald-700 hover:bg-emerald-800 rounded font-medium transition-colors"
                >
                  {editingModId ? '保存修改' : '保存草稿'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Candidate Version Modal */}
      {versionFormTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-lg border border-neutral-200 shadow-xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">
                {versionFormTarget === 'new' ? '创建候选版本' : '编辑候选版本'}
              </h3>
              <button
                onClick={() => setVersionFormTarget(null)}
                className="text-neutral-400 hover:text-neutral-600 text-xs"
              >
                取消
              </button>
            </div>

            <form onSubmit={handleCreateVersionSubmit} className="p-5 space-y-4 text-xs overflow-y-auto">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium text-neutral-700">前置子模组依赖</span>
                  <button type="button" onClick={() => setNewDependencies((previous) => [...previous, { mod_id: '', mod_title: '', version_range: '', required: true }])} className="inline-flex items-center gap-1 text-emerald-700 hover:underline"><Plus className="h-3.5 w-3.5" />添加依赖</button>
                </div>
                <div className="mb-2 text-[11px] text-neutral-500">版本范围可留空；例如 &gt;1.0.0（即 1.0.0&lt;X）或 1.0.0&lt;X&lt;2.0.0</div>
                <div className="space-y-2">
                  {newDependencies.map((dependency, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-2">
                      <DependencyNamePicker
                        label={`依赖模组 ${index + 1}`}
                        value={dependency.linked_mod_id ? (mods.find((mod) => mod.id === dependency.linked_mod_id)?.title || dependency.mod_title || dependency.mod_id) : (dependency.mod_title || dependency.mod_id)}
                        options={mods.filter((mod) => mod.is_published && mod.id !== activeMod?.id)}
                        onInput={(name) => setNewDependencies((previous) => previous.map((item, position) => position === index ? mapDependencyInput(item, name, mods, activeMod?.id || '') : item))}
                        onCommit={(name) => setNewDependencies((previous) => previous.map((item, position) => position === index ? mapDependencyInput(item, name, mods, activeMod?.id || '') : item))}
                        onSelect={(mod) => setNewDependencies((previous) => previous.map((item, position) => position === index ? mapDependencySelection(item, mod, false) : item))}
                      />
                      <input
                        aria-label={`依赖模组 ${index + 1} 的版本范围（可空）`}
                        value={dependency.version_range}
                        onChange={(event) => setNewDependencies((previous) => previous.map((item, position) => position === index ? mapDependencyRangeInput(item, event.target.value) : item))}
                        placeholder="版本范围（可空）"
                        className="min-w-44 flex-1 rounded border border-neutral-300 bg-white px-2 py-1.5 font-mono"
                      />
                      <button type="button" title="移除依赖" aria-label={`移除依赖 ${index + 1}`} onClick={() => setNewDependencies((previous) => previous.filter((_, position) => position !== index))} className="p-1.5 text-neutral-500 hover:text-rose-700"><X className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  版本标识 (Version String)
                </label>
                <input
                  type="text"
                  placeholder="例如: 1.3.0 或 1.3.0-rc1"
                  value={newVerString}
                  onChange={(e) => setNewVerString(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600 font-mono"
                />
              </div>

              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  发行说明 (Markdown，可选)
                </label>
                <textarea
                  rows={3}
                  placeholder={'## 更新内容\n- **新增**功能\n- 修复问题'}
                  value={newReleaseNotes}
                  onChange={(e) => setNewReleaseNotes(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setVersionFormTarget(null)}
                  className="px-3 py-1.5 text-neutral-600 hover:text-neutral-900"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-white bg-neutral-900 hover:bg-neutral-800 rounded font-medium transition-colors"
                >
                  {versionFormTarget === 'new' ? '确认建立候选版本' : '保存版本资料'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GitHub Releases Import Modal */}
      {isGithubImportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-lg border border-neutral-200 shadow-xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Github className="w-4 h-4 text-neutral-900" />
                <h3 className="text-sm font-semibold text-neutral-900">
                  GitHub Releases 自动化草稿导入
                </h3>
              </div>
              <button
                onClick={() => setIsGithubImportOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 text-xs"
              >
                取消
              </button>
            </div>

            <form onSubmit={handleGithubImport} className="p-5 space-y-4 text-xs">
              <p className="text-neutral-600 leading-relaxed">
                按照契约要求（Section 3），系统支持将 GitHub Release URL
                或资产直接导入为草稿，并走完全相同的 Aegis 静态安全扫描与规范审核流程。
              </p>

              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  GitHub Release 资产地址 (URL)
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://github.com/monika-fan/my-submod/releases/tag/v1.0.0"
                  value={githubReleaseUrl}
                  onChange={(e) => setGithubReleaseUrl(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600 font-mono"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => setIsGithubImportOpen(false)}
                  className="px-3 py-1.5 text-neutral-600 hover:text-neutral-900"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-white bg-neutral-900 hover:bg-neutral-800 rounded font-medium transition-colors"
                >
                  开始解析导入
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
