import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiBase } from '../apiBase';
import { useAuthorWorkspace } from './useAuthorWorkspace';
import { Pagination } from './Pagination';
import { SpritepackPanel } from './SpritepackPanel';
import { WindowPager } from './WindowPager';
import { ModCategory, Platform, ModSummary, ModDependency, ModVersion, ScannedFile, ModSourceType, ASSET_PLATFORMS, ASSET_PLATFORM_LABELS, assetPlatformLabel, type AssetPlatform, type GitHubPlatformRule, type PlatformAsset } from '../types/submodhub';
import {
  validateGitHubSourceInput,
  validatePlatformRule,
  configuredPlatformsForRules,
  supportedPlatformsForSource,
  platformModeTradeoff,
  formatLastSyncTime,
  getGitHubRepoUrl,
  onDemandModeTradeoff,
  WORKFLOW_FILE_PATH,
} from './sourceConfig';
import { formatVersionCreatedAt } from './versionDate';
import { formatVersionLabel } from './versionHistory';
import { DeprecationNotice } from './DeprecationNotice';
import { MarkdownText } from './MarkdownText';
import { mapDependencyInput, mapDependencyRangeInput, mapDependencySelection } from './dependencyMapping';
import { DependencyNamePicker } from './DependencyNamePicker';
import { canEditVersion, versionFormState } from './versionFormState';
import { VersionArchiveUploader } from './VersionArchiveUploader';
import { localPlatformDeclaration, missingPlatformArchives, toggleLocalPlatform, uploadPlatforms, versionArchiveShape } from './versionShipping';
import { clearModImages, fetchModImages, platformScanReportId, reorderModImages, uploadModImages } from '../../../ui/submission-api';
import { fetchTagCatalog, type TagGroup } from '../../../ui/tags-api';
import { TagPicker } from './TagPicker';
import { useI18n, LANG_SHORT_LABELS, SUPPORTED_LANGS, type Lang, type LocalizedText } from '../i18n';
import { withLocalizedValue } from '../../../ui/localized-text';
import { isValidTagSelection, orderByCatalog } from './tagSelection';
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
  EyeOff,
  Copy,
} from 'lucide-react';
import { AnimatePresence, m } from './Motion';
import { overlayVariants, panelVariants } from '../../../ui/motion-presets';
import { tabSegmentClass, valueSegmentClass } from './selectionStyles';

export const AuthorWorkbench: React.FC = () => {
  const { t, resolve, lang } = useI18n();
  const workspace = useAuthorWorkspace();
  const { workbenchView, setWorkbenchView, userMods, activeMod, activeModVersions, authorSubmissions, setSelectedModId, modRequest, versionRequest, historyRequest } = workspace;
  const {
    currentUser,
    hasRole,
    mods,
    versions,
    scanReports,
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
    fetchModWorkflowSnippet,
    fetchWorkflowTemplate,
    showToast,
    refreshWindowText,
  } = workspace.app;

  // Author role check
  const isAuthor = Boolean(currentUser);

  // Deleting a mod is only safe while it is still a pure draft: nothing live,
  // nothing live before, and no retired version. The flags are aggregated over
  // every version on the server, so this never depends on the loaded window; an
  // unknown flag (a mod the list did not describe) must not unlock the delete.
  const canDeleteActiveModDraft = !activeMod?.is_published
    && activeMod?.has_published_version !== true && activeMod?.has_archived_version !== true;

  // Mod Draft Creation Dialog
  const [isNewModModalOpen, setIsNewModModalOpen] = useState(false);
  const [editingModId, setEditingModId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  // 简介与详细简介都是多语言文本：草稿里存 {语言: 文本}，编辑时只改当前语言。
  const [newSummary, setNewSummary] = useState<LocalizedText>({});
  const [summaryLang, setSummaryLang] = useState<Lang>(lang);
  const [newAuthorDisplayName, setNewAuthorDisplayName] = useState('');
  const [newDescription, setNewDescription] = useState<LocalizedText>({});
  const [newCategory, setNewCategory] = useState<ModCategory>('submod');
  const [newMasRange, setNewMasRange] = useState('>=0.12.14');
  const [newPriority, setNewPriority] = useState(20);
  const [newTags, setNewTags] = useState<string[]>([]);
  // 标签只能从站点目录里选：目录由管理员在设置页维护，作者端不做任何硬编码。
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  const [tagCatalogLoading, setTagCatalogLoading] = useState(false);
  const [tagCatalogError, setTagCatalogError] = useState<string | null>(null);
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
  // 分平台抓取：打开后每个平台各自用一条正则匹配同一次 Release 的资产，
  // 全平台共用正则不再参与匹配；关闭时保持原来的“一个文件覆盖全平台”。
  // 「发版通知」是默认选中的发现方式：作者在仓库放一个 GitHub Action，发 Release
  // 时由它带着下面的文件名正则通知站内。正则随文件一起走，所以这里派生的是
  // 「将要写进那个文件的内容」，与提交给服务端的规则是同一份事实。
  // 站内按需抓取始终在跑（见 GITHUB_SYNC_MAX_AGE），关掉这个开关只是不生成 Action，
  // 所以「默认」只能落在这里，不能落在按需抓取上。
  const [newGitHubAction, setNewGitHubAction] = useState(true);
  const [newGitHubSplitPlatforms, setNewGitHubSplitPlatforms] = useState(false);
  const [newPlatformRules, setNewPlatformRules] = useState<Record<AssetPlatform, { regex: string; sourceCode: boolean }>>({
    windows: { regex: '', sourceCode: false },
    android: { regex: '', sourceCode: false },
  });
  // 两种版本发现方式的取舍必须如实展示给作者：清单模式用“多维护一个文件”换“零延迟”。
  // 窗口引用服务端实际生效的值，避免文案与设置页不一致。
  const onDemandTradeoff = onDemandModeTradeoff(refreshWindowText);
  const splitPlatformTradeoff = platformModeTradeoff();
  const [isCopyingWorkflow, setIsCopyingWorkflow] = useState(false);
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
  // Which platform the picked file belongs to. Empty means the single archive
  // that serves every platform.
  const uploadPlatformRef = useRef<AssetPlatform | ''>('');

  // Opens the shared file input for one platform (or for the whole version).
  const pickArchive = (versionId: string, platform: AssetPlatform | '') => {
    uploadVersionIdRef.current = versionId;
    uploadPlatformRef.current = platform;
    if (archiveInputRef.current) archiveInputRef.current.value = '';
    archiveInputRef.current?.click();
  };

  // GitHub Import Dialog
  const [isGithubImportOpen, setIsGithubImportOpen] = useState(false);
  const [githubReleaseUrl, setGithubReleaseUrl] = useState('');

  // 每次打开新建/编辑弹窗都重新读取目录：管理员刚改过的标签必须立刻可选，
  // 所以这里不做长缓存；读取失败时禁用选择器而不是退回旧的硬编码标签。
  const tagCatalogBase = apiBase();
  useEffect(() => {
    if (!isNewModModalOpen) return;
    let cancelled = false;
    setTagCatalogLoading(true);
    setTagCatalogError(null);
    fetchTagCatalog(tagCatalogBase)
      .then((catalog) => {
        if (cancelled) return;
        setTagGroups(catalog.groups);
      })
      .catch(() => {
        if (!cancelled) setTagCatalogError(t('tagCatalog.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setTagCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isNewModModalOpen, tagCatalogBase]);

  // Currently inspected Scan Report modal
  const [inspectingReportId, setInspectingReportId] = useState<string | null>(null);

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

  // 分平台模式提交给服务端的规则：只映射真正配置过的平台，留空的平台就是
  // 「不发布该平台」；关闭分平台时提交空数组，服务端据此回到全平台共用正则。
  // 清单模式的分平台 UI 是隐藏的，但已填的规则仍原样保留并提交：作者只是看一眼
  // 清单说明不该丢掉配置，服务端在清单模式下也不使用它们。
  const configuredSplitPlatforms = configuredPlatformsForRules(newPlatformRules);
  const platformRulePayload: GitHubPlatformRule[] = newGitHubSplitPlatforms
    ? configuredSplitPlatforms.map((platform) => ({
        platform,
        regex: newPlatformRules[platform].regex.trim(),
        source_code: newPlatformRules[platform].sourceCode,
      }))
    : [];
  // 分平台规则本身决定目录里展示的平台集合：只有 GitHub 按需抓取时它才生效，
  // 本地源不据此收紧模组的 supported_platforms。服务端会按同一规则重新派生
  // （见 effectiveSupportedPlatforms），这里提交的是同一份事实。
  const splitPlatformsActive = newSourceType === 'github_releases' && newGitHubSplitPlatforms;
  const effectivePlatforms = supportedPlatformsForSource({
    sourceType: newSourceType,
    splitPlatforms: splitPlatformsActive,
    configuredPlatforms: configuredSplitPlatforms,
    declaredPlatforms: newPlatforms,
  });

  // 生成 Action 文件时要写进去的规则。与提交给服务端的是同一组值，否则作者
  // 复制到的文件会与服务端保存的规则不一致，通知就会认错包。
  // 源码包兜底也在这份规则里：没有任何文件名正则可写时，它就是文件里唯一能
  // 说明「这个仓库的包从哪来」的内容，缺了它文件会在源码包模式下变成空对象。
  const actionRules = {
    shared: newGitHubSplitPlatforms ? '' : newGitHubAssetRegex.trim(),
    windows: newGitHubSplitPlatforms ? newPlatformRules.windows.regex.trim() : '',
    android: newGitHubSplitPlatforms ? newPlatformRules.android.regex.trim() : '',
    shared_source_code: !newGitHubSplitPlatforms && newGitHubSourceCode,
    windows_source_code: newGitHubSplitPlatforms && newPlatformRules.windows.sourceCode,
    android_source_code: newGitHubSplitPlatforms && newPlatformRules.android.sourceCode,
  };
  // 一条规则都没有（既没正则、也没勾源码包兜底）时生成的文件毫无意义，按钮据此
  // 禁用而不是发一个空规则出去。源码包模式没有文件名可填，但通知照样成立。
  const workflowRulesReady = newGitHubSplitPlatforms
    ? configuredSplitPlatforms.length > 0
    : Boolean(actionRules.shared || actionRules.shared_source_code);
  // 第 1 步的说明按「有没有文件名正则」切换：源码包模式下没有正则可确认。
  const workflowHasPattern = Boolean(actionRules.shared || actionRules.windows || actionRules.android);
  // 第 1 步逐条展示「这条规则匹配什么」：有正则展示正则，没有正则但有源码包
  // 兜底就写源码包，两者都没有才是未填写。
  const workflowMatcherLabel = (regex: string, sourceCode: boolean) =>
    regex.trim() || (sourceCode ? t('author.sourceCodePackage') : t('author.notFilled'));


  const handleCreateDraftSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    // 本站上传的发布平台就是作者勾选的那几个：目录据此展示模组，留空等于
    // 什么都不发布，所以先拦下来而不是让服务端收到一个空集合。
    if (newSourceType === 'local' && newPlatforms.length === 0) {
      showToast('error', t('author.platformRequired'));
      return;
    }

    if (newSourceType === 'github_releases') {
      const sourceValidation = validateGitHubSourceInput({
        owner: newGitHubOwner,
        repo: newGitHubRepo,
        assetRegex: newGitHubAssetRegex,
        sourceCode: newGitHubSourceCode,
        platformMode: newGitHubSplitPlatforms,
        platformRules: newGitHubSplitPlatforms ? platformRulePayload : [],
      });
      if (!sourceValidation.valid) {
        showToast('error', sourceValidation.error || t('author.sourceInvalid'));
        return;
      }
    }

    if (tagGroups.length === 0) {
      showToast('error', t('author.tagCatalogNotReady'));
      return;
    }
    const tags = orderByCatalog(tagGroups, newTags);
    if (!isValidTagSelection(tags)) {
      showToast('error', t('tagPicker.atLeastOne'));
      return;
    }

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
        supported_platforms: effectivePlatforms,
        source_type: newSourceType,
        github_owner: newGitHubOwner.trim(),
        github_repo: newGitHubRepo.trim(),
        github_asset_regex: newGitHubAssetRegex.trim(),
        github_source_code: newGitHubSourceCode,
        github_platform_assets: platformRulePayload,
      });
      if (saved) {
        const base = apiBase();
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
          showToast('success', t('author.imagesAppended', { count: orderedFiles.length }));
        }
        else if (clearExistingDetailImages) {
          try { await clearModImages(base, editingModId); showToast('success', t('author.imagesCleared')); } catch (error) { showToast('error', t('author.imagesClearFailed', { error: error instanceof Error ? error.message : 'unknown_error' })); }
        } else if (detailImageOrderDirty) {
          try {
            const filenames = detailImageOrder.map((url) => decodeURIComponent(url.split('/').pop() || ''));
            await reorderModImages(base, editingModId, filenames);
            showToast('success', t('author.imagesOrderSaved'));
          } catch (error) { showToast('error', t('author.imagesOrderFailed', { error: error instanceof Error ? error.message : 'unknown_error' })); }
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
      supported_platforms: effectivePlatforms,
      source_type: newSourceType,
      github_owner: newGitHubOwner.trim(),
      github_repo: newGitHubRepo.trim(),
      github_asset_regex: newGitHubAssetRegex.trim(),
      github_source_code: newGitHubSourceCode,
      github_platform_assets: platformRulePayload,
    });

    if (createdId) {
      if (pendingDetailImages.length > 0) await uploadDetailImages(createdId, pendingDetailImages);
      setSelectedModId(createdId);
      setIsNewModModalOpen(false);
      setNewTitle('');
      setNewSummary({});
      setNewDescription({});
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
    setNewSummary({ ...(mod.summary ?? {}) });
    setNewAuthorDisplayName(mod.author.display_name || '');
    setNewDescription({ ...(mod.description ?? {}) });
    setNewCategory(mod.category);
    setNewMasRange(mod.mas_version_range);
    setNewPriority(mod.recommended_priority);
    setNewTags(mod.tags);
    // 发布平台只保留真的能单独出包的两个平台；早期草稿的声明集合原样回显。
    setNewPlatforms(localPlatformDeclaration(mod.supported_platforms));
    setNewSourceType(mod.source_type || 'local');
    setNewGitHubOwner(mod.github_owner || '');
    setNewGitHubRepo(mod.github_repo || '');
    setNewGitHubAssetRegex(mod.github_asset_regex || '');
    setNewGitHubSourceCode(Boolean(mod.github_source_code));
    // 已存在的分平台规则必须原样回显，否则作者一打开编辑器就会被“关闭分平台”
    // 悄悄改回全平台共用正则。
    const existingRules = mod.github_platform_assets || [];
    setNewGitHubSplitPlatforms(existingRules.length > 0);
    setNewPlatformRules({
      windows: {
        regex: existingRules.find((rule) => rule.platform === 'windows')?.regex || '',
        sourceCode: Boolean(existingRules.find((rule) => rule.platform === 'windows')?.source_code),
      },
      android: {
        regex: existingRules.find((rule) => rule.platform === 'android')?.regex || '',
        sourceCode: Boolean(existingRules.find((rule) => rule.platform === 'android')?.source_code),
      },
    });
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
    setNewSummary({});
    setNewAuthorDisplayName('');
    setNewDescription({});
    setNewCategory('submod');
    setNewMasRange('>=0.12.14');
    setNewPriority(20);
    setNewTags([]);
    setNewPlatforms(['windows', 'android']);
    setNewSourceType('local');
    setNewGitHubOwner('');
    setNewGitHubRepo('');
    setNewGitHubAssetRegex('');
    setNewGitHubSourceCode(false);
    setNewGitHubAction(true);
    setNewGitHubSplitPlatforms(false);
    setNewPlatformRules({ windows: { regex: '', sourceCode: false }, android: { regex: '', sourceCode: false } });
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
    const base = apiBase();
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

  const handleUploadArchive = async (versionId: string, file: File, platform?: AssetPlatform) => {
    setIsUploading(true);
    setSelectedVersionForUpload(versionId);
    setUploadProgress(20);
    try {
      await uploadArchiveAndScan(versionId, file, platform);
      setUploadProgress(100);
      // The report key follows the platform, so the inspector must open the one
      // that was just written instead of a same-named single-archive report.
      setInspectingReportId(platformScanReportId(versionId, platform));
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
    const versionId = activeMod.candidate_version_id || await createCandidateVersion(activeMod.id, 'current', '');
    if (versionId) await handleUploadArchive(versionId, file);
  };

  const handleGithubImport = (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubReleaseUrl.trim()) return;

    showToast('info', t('author.importingRelease'));

    setTimeout(async () => {
      // 导入草稿同样只能带目录内的标签：这里用目录首个主标签兜底，
      // 目录不可用时不创建草稿，而不是写一个自造的标签。
      const groups = tagGroups.length > 0
        ? tagGroups
        : await fetchTagCatalog(tagCatalogBase).then((catalog) => catalog.groups).catch(() => [] as TagGroup[]);
      const seedTag = groups[0]?.name;
      if (!seedTag) {
        showToast('error', t('author.importNoCatalog'));
        return;
      }
      const newModId = await createModDraft({
        title: 'GitHub Imported Submod',
        summary: { zh: t('author.importSummary', { url: githubReleaseUrl }) },
        category: 'submod',
        tags: [seedTag],
      });
      setSelectedModId(newModId);
      if (!newModId) return;
      const vId = await createCandidateVersion(newModId, '1.0.0-gh', t('author.importNotes'));
      if (vId) await uploadArchiveAndScan(vId, { name: 'github_release_asset.zip', size: 3600000 });
      setIsGithubImportOpen(false);
      setGithubReleaseUrl('');
    }, 800);
  };

  if (!isAuthor) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center space-y-4">
        <AlertCircle className="w-10 h-10 text-neutral-400 mx-auto" />
        <h2 className="text-base font-bold text-neutral-800">{t('author.notAuthorizedTitle')}</h2>
        <p className="text-xs text-neutral-500 max-w-md mx-auto">
          {t('author.notAuthorizedBody')}
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
          const platform = uploadPlatformRef.current;
          if (file && versionId === 'spritepack:new') void handleSpritepackUpload(file);
          else if (file && versionId) void handleUploadArchive(versionId, file, platform || undefined);
        }}
        />
      {/* Top Banner & Stats */}
      <div className="bg-white border border-neutral-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <span className="font-semibold text-neutral-900">{currentUser?.display_name}</span>
            <span>·</span>
            <span>{t('author.heroBadge')}</span>
          </div>
          <h1 className="text-lg font-bold text-neutral-900 tracking-tight mt-0.5">
            {t('author.heroTitle')}
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            {t('author.heroBody')}
          </p>
        </div>

        {/* View Switcher & Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-neutral-100 p-0.5 rounded text-xs font-medium mr-2">
            <button
              onClick={() => setWorkbenchView('mods')}
              aria-pressed={workbenchView === 'mods'}
              className={`${tabSegmentClass(workbenchView === 'mods')} active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600`}
            >
              {t('author.viewMods')}
            </button>
            <button
              onClick={() => setWorkbenchView('submissions')}
              aria-pressed={workbenchView === 'submissions'}
              className={`${tabSegmentClass(workbenchView === 'submissions')} active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600`}
            >
              {historyRequest.data ? t('author.viewHistoryWithTotal', { total: historyRequest.data.total }) : t('author.viewHistory')}
            </button>
          </div>

                  <button
                    onClick={openNewModEditor}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded transition-colors shadow-xs active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('author.viewNewDraft')}
          </button>
        </div>
      </div>

      {workbenchView === 'submissions' ? (
        /* Submissions & Revision History View */
        <div className="bg-white border border-neutral-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-neutral-900">{t('author.historyTitle')}</h2>
              <p className="text-xs text-neutral-500">{t('author.historySubtitle')}</p>
            </div>
            <span className="text-xs font-mono text-neutral-400">
              {t('author.historyCount', { total: historyRequest.data?.total ?? '…' })}
            </span>
          </div>

          <div className="flex flex-wrap gap-1 text-xs">{[{id:'all',label:t('author.filterAll')},{id:'ready_for_review',label:t('author.filterPending')},{id:'published',label:t('author.filterPublished')},{id:'rejected',label:t('author.filterRejected')}].map((filter) => <button key={filter.id} onClick={() => workspace.changeHistoryState(filter.id)} className={`min-h-8 rounded px-3 transition-colors ${workspace.historyState === filter.id ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'} active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600`}>{filter.label}</button>)}</div>
          {historyRequest.loading && <p role="status" className="py-8 text-center text-xs text-neutral-500">{t('author.historyLoading')}</p>}
          {historyRequest.error && <p role="alert" className="text-xs text-rose-700">{t('author.historyLoadFailed', { error: historyRequest.error })} <button onClick={historyRequest.reload} className="underline">{t('common.retry')}</button></p>}
          {historyRequest.data && (authorSubmissions.length === 0 ? (
            <div className="py-12 text-center text-xs text-neutral-400">{t('author.historyEmpty')}</div>
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
                        <span className="font-mono text-xs text-neutral-600">{sub.category === 'spritepack' ? t('author.spritepack') : formatVersionLabel(sub.version_str)}</span>
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
                            ? t('author.statePublished')
                            : isApproved
                            ? t('author.stateApproved')
                            : isRejected
                            ? t('author.stateRejected')
                            : t('author.statePending')}
                        </span>
                      </div>
                      <span className="text-[11px] text-neutral-400 font-mono">
                        {t('author.submittedAt', { time: new Date(sub.submitted_at).toLocaleString() })}
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
                            {isRejected ? t('author.rejectReasonLabel') : t('author.approveRecordLabel')}
                          </span>
                          <span className="text-[11px] text-neutral-500 font-normal">
                            {t('author.reviewer', { name: sub.reviewer_name || t('author.coreTeam') })}
                          </span>
                        </div>
                        <p>{sub.decision_reason}</p>

                        {isRejected && subVer?.state === 'rejected' && (
                          <div className="pt-2 mt-2 border-t border-rose-200/80 flex items-center justify-between">
                            <span className="text-[11px] text-rose-700">
                              {t('author.reviseHint')}
                            </span>
                            <button
                              onClick={() => {
                                setSelectedModId(subVer.mod_id);
                                setWorkbenchView('mods');
                                openVersionForm(subVer);
                              }}
                              className="px-3 py-1 text-xs font-medium text-white bg-rose-700 hover:bg-rose-800 rounded transition-colors flex items-center gap-1 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                            >
                              {t('author.editRejectedVersion')}
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
                          className="text-emerald-700 hover:underline flex items-center gap-1 font-medium active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                        >
                          <FileCheck className="w-3.5 h-3.5" />
                          {t('author.viewScanReport')}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {historyRequest.data && <Pagination label={t('author.historyPagerLabel')} total={historyRequest.data.total} page={historyRequest.data.page} pageSize={workspace.historyPageSize} onPageChange={workspace.changeHistoryPage} onPageSizeChange={workspace.changeHistoryPageSize} />}
        </div>
      ) : (
        /* Mods & Candidate Versions Management View */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: My Mods Selector */}
          <div className="bg-white border border-neutral-200 rounded-lg p-5 space-y-4 lg:col-span-1">
            <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
              <h2 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
                {t('author.modListTitle', { total: modRequest.data?.total ?? '…' })}
              </h2>
              <button
                onClick={openNewModEditor}
                className="text-xs text-emerald-700 hover:underline font-medium active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                + {t('author.newDraft')}
              </button>
            </div>

            {modRequest.loading && <p role="status" className="py-8 text-center text-xs text-neutral-500">{t('author.modsLoading')}</p>}
            {modRequest.error && <p role="alert" className="text-xs text-rose-700">{t('author.modsLoadFailed', { error: modRequest.error })} <button onClick={modRequest.reload} className="underline">{t('common.retry')}</button></p>}
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
                    <p className="text-[11px] text-neutral-500 line-clamp-1">{resolve(m.summary)}</p>
                    <div className="flex items-center justify-between pt-1 text-[10px] text-neutral-400">
                      <span>MAS {m.mas_version_range}</span>
                      <span>{m.is_published ? t('author.modPublished') : t('author.modDraft')}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            {modRequest.data && (
              <WindowPager
                label={t('author.modPagerLabel')}
                total={modRequest.data.total}
                start={modRequest.data.start}
                shown={userMods.length}
                pageSize={workspace.modPageSize}
                onPrevious={workspace.previousModWindow}
                onNext={workspace.nextModWindow}
                onPageSizeChange={workspace.changeModPageSize}
              />
            )}
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
                      <span>{t('author.priority', { value: activeMod.recommended_priority })}</span>
                      <span>·</span>
                      <span>{t('author.platforms', { list: uploadPlatforms(activeMod.supported_platforms).map(assetPlatformLabel).join(' / ') })}</span>
                    </div>
                    <h2 className="text-base font-bold text-neutral-900">{activeMod.title}</h2>
                    <p className="text-xs text-neutral-600 mt-1">{resolve(activeMod.summary)}</p>
                    {activeMod.source_type === 'github_releases' && (
                      <div className="mt-2.5 p-2.5 bg-neutral-50 border border-neutral-200 rounded text-xs space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-neutral-500 flex items-center gap-1">
                            <Github className="w-3.5 h-3.5" />
                            {t('author.githubSource')}
                          </span>
                          <a
                            href={getGitHubRepoUrl(activeMod.github_owner, activeMod.github_repo)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-700 hover:underline font-mono active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                          >
                            {activeMod.github_owner}/{activeMod.github_repo}
                          </a>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-600">
                          <span>{t('author.versionDiscovery')}<span>{t('author.versionDiscoveryValue')}</span></span>
                          <span>{t('author.lastSync', { time: formatLastSyncTime(activeMod.github_last_sync_at) })}</span>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-600">
                          <span>
                            {t('author.assetMatch')}{' '}
                            {activeMod.github_platform_assets && activeMod.github_platform_assets.length > 0 ? (
                              <span className="space-x-2">
                                {activeMod.github_platform_assets.map((rule) => (
                                  <span key={rule.platform}>
                                    {assetPlatformLabel(rule.platform)} <code className="text-neutral-800">{rule.regex || (rule.source_code ? t('author.sourceCodePackage') : t('author.notConfigured'))}</code>
                                  </span>
                                ))}
                              </span>
                            ) : (
                              <code className="text-neutral-800">{activeMod.github_asset_regex || t('author.noAssetRegex')}</code>
                            )}
                          </span>
                        </div>
                        <div className="text-[11px] text-amber-800 bg-amber-50 p-1.5 rounded border border-amber-200">
                          {t('author.syncWindowNote', { window: refreshWindowText })}
                        </div>
{activeMod.github_last_sync_error && (
                          <div className="text-[11px] text-rose-600 bg-rose-50 p-1.5 rounded border border-rose-200 mt-1">
                            {t('author.syncStatus', { detail: activeMod.github_last_sync_error })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openModEditor(activeMod)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 border border-neutral-300 hover:bg-neutral-50 rounded transition-colors active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      {t('author.editMod')}
                    </button>
                    {activeMod.is_published ? <button type="button" onClick={() => { if (window.confirm(t('author.confirmUnpublishMod'))) void unpublishMod(activeMod.id); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 border border-amber-200 hover:bg-amber-50 rounded transition-colors active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"><EyeOff className="w-3.5 h-3.5" />{t('author.unpublishMod')}</button> : canDeleteActiveModDraft && <button type="button" onClick={() => { if (window.confirm(t('author.confirmDeleteMod'))) void deleteModDraft(activeMod.id); }} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-700 border border-rose-200 hover:bg-rose-50 rounded transition-colors active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">{t('author.deleteModDraft')}</button>}
                    {activeMod.source_type === 'github_releases' ? (
                      <>
                      <button
                        type="button"
                        disabled={isCopyingWorkflow}
                        onClick={async () => {
                          setIsCopyingWorkflow(true);
                          try {
                            const snippet = await fetchModWorkflowSnippet(activeMod.id);
                            if (!snippet) return;
                            try {
                              await navigator.clipboard.writeText(snippet.content);
                              showToast('success', t('author.workflowCopied', { path: snippet.path }));
                            } catch {
                              showToast('error', t('author.clipboardFailed'));
                            }
                          } finally {
                            setIsCopyingWorkflow(false);
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 border border-neutral-300 hover:bg-neutral-50 disabled:opacity-50 rounded transition-colors active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        {isCopyingWorkflow ? t('author.fetching') : t('author.copyWorkflow')}
                      </button>
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
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded transition-colors active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isSyncingReleases ? 'animate-spin' : ''}`} />
                        {isSyncingReleases ? t('author.syncing') : t('author.syncNow')}
                      </button>
                      </>
                    ) : (
                      activeMod.category !== 'spritepack' && (
                        <button
                          onClick={() => openVersionForm()}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded transition-colors active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          {t('author.createVersion')}
                        </button>
                      )
                    )}
                  </div>
                </div>

                {activeMod.category === 'spritepack' ? (
                  <SpritepackPanel
                    hasPublishedVersion={activeMod.has_published_version === true}
                    hasPendingReview={activeMod.has_pending_review === true}
                    uploading={isUploading}
                    loading={versionRequest.loading}
                    error={versionRequest.error}
                    loaded={Boolean(versionRequest.data)}
                    versions={activeModVersions}
                    scanReports={scanReports}
                    submittingVersionId={submittingVersionId}
                    total={versionRequest.data?.total ?? 0}
                    page={versionRequest.data?.page ?? 1}
                    pageSize={workspace.versionPageSize}
                    onUpload={() => {
                      uploadVersionIdRef.current = 'spritepack:new';
                      if (archiveInputRef.current) archiveInputRef.current.value = '';
                      archiveInputRef.current?.click();
                    }}
                    onRetry={versionRequest.reload}
                    onDeleteVersion={(versionId) => { if (window.confirm(t('author.confirmDeleteDraftVersion'))) void deleteVersion(versionId); }}
                    onSubmitReview={(versionId) => {
                      setSubmittingVersionId(versionId);
                      void submitVersionForReview(versionId, true).finally(() => setSubmittingVersionId(null));
                    }}
                    onPageChange={workspace.changeVersionPage}
                    onPageSizeChange={workspace.changeVersionPageSize}
                  />
                ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-neutral-900 uppercase tracking-wider">
                      {t('author.versionListTitle', { total: versionRequest.data?.total ?? '…' })}
                    </h3>
                    <span className="text-[11px] text-neutral-400">
                      {t('author.versionListHint')}
                    </span>
                  </div>

                  {versionRequest.loading ? <p role="status" className="text-xs text-neutral-500">{t('author.versionsLoading')}</p> : versionRequest.error ? <p role="alert" className="text-xs text-rose-700">{t('author.versionsLoadFailed', { error: versionRequest.error })} <button onClick={versionRequest.reload} className="underline">{t('common.retry')}</button></p> : activeModVersions.length === 0 ? (
                    <div className="py-8 text-center border border-dashed border-neutral-200 rounded-lg space-y-2">
                      <p className="text-xs text-neutral-500">{t('author.versionsEmpty')}</p>
                      <button
                        onClick={() => openVersionForm()}
                        className="text-xs text-emerald-700 hover:underline font-medium"
                      >
                        {t('author.createFirstVersion')}
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
                        // 目录按模组声明的平台展示，分平台版本缺哪个平台的归档，
                        // 那个平台的下载就会落空，所以提交前必须补齐。
                        const missingPlatforms = versionArchiveShape(v) === 'split'
                          ? missingPlatformArchives(v, uploadPlatforms(activeMod.supported_platforms))
                          : [];

                        return (
                          <div
                            key={v.id}
                            className="p-4 rounded-lg border border-neutral-200 bg-neutral-50/50 space-y-3"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-neutral-900 font-mono">
                                  {v.version ? formatVersionLabel(v.version) : t('author.versionPending')}
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
                                  {t('author.versionState', { state: v.state })}
                                </span>
                                {v.is_immutable && (
                                  <span className="text-[10px] text-neutral-400 font-mono">
                                    {t('author.immutableArchive')}
                                  </span>
                                )}
                              </div>

                              {!isPublished && (
                                <button onClick={() => { if (window.confirm(t('author.confirmDeleteVersion'))) void deleteVersion(v.id); }} className="px-2.5 py-1.5 text-xs text-rose-700 border border-rose-200 rounded hover:bg-rose-50 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">{isDraft ? t('author.deleteDraft') : t('author.deleteOldVersion')}</button>
                              )}
                              {isPublished && (
                                <>
                                  {activeMod?.latest_version_id === v.id ? (
                                    <span className="text-[11px] text-emerald-700">{t('author.catalogLatest')}</span>
                                  ) : (
                                    <button onClick={() => void setLatestPublishedVersion(v.id)} className="px-2.5 py-1.5 text-xs text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-50 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">{t('author.setLatest')}</button>
                                  )}
                                  <button onClick={() => { const reason = window.prompt(t('author.promptUnpublishReason')); if (reason?.trim()) void unpublishVersion(v.id, reason); }} className="px-2.5 py-1.5 text-xs text-amber-700 border border-amber-200 rounded hover:bg-amber-50 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">{t('author.unpublishVersion')}</button>
                                </>
                              )}
                              {!v.deprecated && v.state !== 'draft' && (
                                <button onClick={() => { const reason = window.prompt(t('author.promptDeprecateReason')); if (reason?.trim()) void markVersionDeprecated(v.id, reason); }} className="px-2.5 py-1.5 text-xs text-orange-700 border border-orange-200 rounded hover:bg-orange-50 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">{t('author.markDeprecated')}</button>
                              )}
                              {v.deprecated && (
                                <button onClick={() => { if (window.confirm(t('author.confirmClearDeprecation'))) void clearVersionDeprecation(v.id); }} className="px-2.5 py-1.5 text-xs text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-50">{t('author.clearDeprecation')}</button>
                              )}
                              {canEditVersion(v.state) && (
                                <button onClick={() => openVersionForm(v)} className="px-2.5 py-1.5 text-xs text-sky-700 border border-sky-200 rounded hover:bg-sky-50 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">{isDraft ? t('author.editDraft') : t('author.editVersion')}</button>
                              )}

                              <span className="text-[11px] text-neutral-400 font-mono">
                                {t('author.createdAt', { time: formatVersionCreatedAt(v.created_at, t('common.notRecorded')) })}
                              </span>
                            </div>

                              {/* Release Notes */}
                            <MarkdownText value={v.release_notes || t('author.noReleaseNotes')} className="text-xs text-neutral-600 bg-white p-2.5 rounded border border-neutral-200/80" />

                            <DeprecationNotice deprecated={v.deprecated} reason={v.deprecation_reason} />

                            {v.dependencies.length > 0 && (
                              <div className="space-y-2 text-xs">
                                <div className="font-medium text-neutral-700">{t('author.dependencies')}</div>
                                <div className="text-[11px] text-neutral-500">{t('author.rangeHint')}{t('author.rangeExample')}</div>
                                {v.dependencies.map((dep, index) => (
                                  <div key={`${dep.mod_id}-${index}`} className="flex flex-wrap items-center gap-2">
                                    {isUploaded ? (
                                      <>
                                        <DependencyNamePicker
                                          label={t('author.depLinkLabel', { name: dep.mod_title || dep.mod_id })}
                                          value={dep.linked_mod_id ? (mods.find((candidate) => candidate.id === dep.linked_mod_id)?.title || dep.mod_title || dep.mod_id) : (dep.mod_title || dep.mod_id)}
                                          options={mods.filter((candidate) => candidate.is_published && candidate.id !== v.mod_id)}
                                          onCommit={(name) => void editVersion(v.id, v.version, v.release_notes, v.dependencies.map((item, position) => position === index ? mapDependencyInput(item, name, mods, v.mod_id) : item))}
                                          onSelect={(mod) => void editVersion(v.id, v.version, v.release_notes, v.dependencies.map((item, position) => position === index ? mapDependencySelection(item, mod) : item))}
                                        />
                                        <input
                                          aria-label={t('author.depRangeAria', { name: dep.mod_title || dep.mod_id })}
                                          value={dep.version_range ?? ''}
                                          onChange={(event) => void editVersion(v.id, v.version, v.release_notes, v.dependencies.map((item, position) => position === index ? mapDependencyRangeInput(item, event.target.value) : item))}
                                          placeholder={t('author.rangePlaceholder')}
                                          className="w-44 max-w-full border border-neutral-300 bg-white rounded px-2 py-1.5 font-mono"
                                        />
                                      </>
                                    ) : <span className="text-neutral-600">{dep.mod_title || dep.mod_id} · {dep.version_range || t('author.anyVersion')} · {dep.linked_mod_id ? t('author.linkedTo', { title: mods.find((candidate) => candidate.id === dep.linked_mod_id)?.title || dep.linked_mod_id }) : t('author.notLinked')}</span>}
                                  </div>
                                ))}
                              </div>
                            )}

                              {isUploaded && !v.version && (
                                <div className="flex flex-wrap items-end gap-2 text-xs">
                                  <label className="flex-1 min-w-48 text-neutral-700">
                                    <span className="block mb-1">{t('author.manualVersionHint')}</span>
                                    <input value={manualVersions[v.id] || ''} onChange={(event) => setManualVersions((prev) => ({ ...prev, [v.id]: event.target.value }))} placeholder={t('author.manualVersionPlaceholder')} className="w-full px-2.5 py-1.5 rounded border border-neutral-300 bg-white font-mono" />
                                  </label>
                                  <button disabled={!manualVersions[v.id]?.trim()} onClick={() => void editVersion(v.id, manualVersions[v.id].trim(), v.release_notes)} className="px-3 py-1.5 rounded bg-neutral-900 text-white transition-colors hover:bg-neutral-800 disabled:opacity-40 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">{t('author.saveVersionId')}</button>
                                </div>
                              )}

                            {/* Scan Summary Banner if report available */}
                            {report && (
                              <div className="p-3 bg-white rounded border border-neutral-200 space-y-2 text-xs">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 font-medium text-neutral-800">
                                    <FileCheck className="w-4 h-4 text-neutral-600" />
                                    <span>{t('author.scanReportFiles', { count: report.files.length })}</span>
                                    {report.resource_stats.binary_flag && (
                                      <span className="text-[10px] text-amber-800 font-semibold">
                                        {t('author.binaryHint')}
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    onClick={() => setInspectingReportId(report.id)}
                                    className="text-xs text-emerald-700 hover:underline font-medium"
                                  >
                                    {t('author.viewFullReport')}
                                  </button>
                                </div>

                                {report.resource_stats.binary_flag && (
                                  <p className="text-[11px] text-amber-900">{t('author.binaryNote')}</p>
                                )}

                                {report.blockers.length > 0 && (
                                  <div className="p-2 bg-rose-50 rounded border border-rose-200 text-rose-800 text-[11px] space-y-1">
                                    <div className="font-semibold flex items-center gap-1">
                                      <AlertCircle className="w-3.5 h-3.5" />
                                      {t('author.blockersFound', { count: report.blockers.length })}
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
                                {/* Upload / Re-upload ZIP Trigger. A version with no
                                    archive yet picks its shipping shape first:
                                    one shared ZIP, or one ZIP per platform. */}
                                {!isPublished && (
                                  <VersionArchiveUploader
                                    version={v}
                                    declaredPlatforms={activeMod.supported_platforms}
                                    busy={isUploading}
                                    onPick={(platform) => pickArchive(v.id, platform)}
                                  />
                                )}
                              </div>

                              {/* Submit for Review Action (Section 1 & 2 contract) */}
                              {!isPublished && !isUnderReview && isUploaded && report && (
                                <div className="flex items-center gap-2">
                                {missingPlatforms.length > 0 && (
                                  <span className="text-[11px] text-amber-700">
                                    {t('author.missingPlatforms', { list: missingPlatforms.map(assetPlatformLabel).join(t('common.listSeparator')) })}
                                  </span>
                                )}
                                <label className="flex items-center gap-1.5 text-[11px] text-neutral-600"><input type="checkbox" checked={latestOnPublish[v.id] ?? true} onChange={(event) => setLatestOnPublish((prev) => ({ ...prev, [v.id]: event.target.checked }))} />{t('author.setLatestOnPublish')}</label>
                                <button
                                  disabled={Boolean(hasBlockers) || !v.version || submittingVersionId === v.id || missingPlatforms.length > 0}
                                  onClick={async () => {
                                    setSubmittingVersionId(v.id);
                                    try { await submitVersionForReview(v.id, latestOnPublish[v.id] ?? true); } finally { setSubmittingVersionId(null); }
                                  }}
                                  className={`px-3.5 py-1.5 font-medium rounded flex items-center gap-1.5 transition-colors shadow-xs ${
                                    hasBlockers || !v.version || submittingVersionId === v.id || missingPlatforms.length > 0
                                      ? 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
                                      : 'bg-emerald-700 hover:bg-emerald-800 text-white'
                                  }`}
                                >
                                  <Send className="w-3.5 h-3.5" />
                                  {t('author.submitReview')}
                                </button>
                                </div>
                              )}

                              {isUnderReview && (
                                <span className="text-xs text-amber-700 flex items-center gap-1">
                                  <Clock className="w-3.5 h-3.5" />
                                  {t('author.inReview')}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {versionRequest.data && <Pagination label={t('author.versionPagerLabel')} total={versionRequest.data.total} page={versionRequest.data.page} pageSize={workspace.versionPageSize} onPageChange={workspace.changeVersionPage} onPageSizeChange={workspace.changeVersionPageSize} />}
                </div>
                )}
              </>
            ) : (
              <div className="py-12 text-center text-neutral-400 text-xs">
                {t('author.selectModFirst')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Uploading Progress Modal */}
      <AnimatePresence>
      {isUploading && (
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
            className="bg-white rounded-lg p-6 max-w-sm w-full space-y-4 text-center shadow-xl"
          >
            <Upload className="w-8 h-8 text-emerald-700 mx-auto animate-bounce" />
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                {t('author.uploadingScan')}
              </h3>
              <p className="text-xs text-neutral-500 mt-1">
                {t('author.uploadingScanHint')}
              </p>
            </div>
            <div className="w-full bg-neutral-100 rounded-full h-2 overflow-hidden">
              <div
                className="bg-emerald-600 h-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <div className="text-[11px] font-mono text-neutral-400">
              {t('author.idempotencyOk', { percent: uploadProgress })}
            </div>
          </m.div>
        </m.div>
      )}
      </AnimatePresence>

      {/* Full Scan Report Inspector Modal */}
      <AnimatePresence>
      {inspectingReport && (
        <m.div
          variants={overlayVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs"
        >
          <m.div
            variants={panelVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="bg-white rounded-lg border border-neutral-200 shadow-xl max-w-3xl w-full max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between shrink-0 bg-neutral-50/50">
              <div className="flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-neutral-700" />
                <div>
                  <h3 className="text-sm font-bold text-neutral-900">
                    {t('author.zipReportTitle')}
                  </h3>
                  <div className="text-[11px] text-neutral-500 font-mono">
                    {t('author.scanReportMeta', { id: inspectingReport.id, status: inspectingReport.status })}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setInspectingReportId(null)}
                className="text-neutral-400 hover:text-neutral-700 text-xs px-2 py-1 rounded active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                {t('author.close')}
              </button>
            </div>

            <div className="p-6 overflow-y-auto overscroll-y-contain space-y-5 text-xs text-neutral-700 leading-relaxed">
              {/* Blockers & Warnings */}
              {inspectingReport.blockers.length > 0 && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 space-y-1.5">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-rose-700" />
                    {t('author.reportBlockersTitle')}
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
                    {t('author.reportWarningsTitle')}
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 text-xs">
                    {inspectingReport.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {inspectingReport.resource_stats.binary_flag && (
                <p className="text-amber-900 bg-amber-50 border border-amber-200 rounded p-3">{t('author.reportBinaryNote')}</p>
              )}

              {inspectingReport.unsupported_paths.length > 0 && (
                <div className="p-3 bg-neutral-50 border border-neutral-200 rounded space-y-1">
                  <div className="font-semibold">{t('author.unmappedTitle')}</div>
                  <ul className="list-disc list-inside font-mono break-all">
                    {inspectingReport.unsupported_paths.map((path) => <li key={path}>{path}</li>)}
                  </ul>
                </div>
              )}

              {/* Submod Registration Confidence Rule (Section 2 explicit requirement) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-neutral-900 uppercase tracking-wider text-xs">
                    {t('author.registrationsTitle')}
                  </h4>
                </div>
                <div className="border border-neutral-200 rounded divide-y divide-neutral-100">
                  {inspectingReport.registrations.length === 0 ? (
                    <div className="p-3 text-neutral-500">{t('author.registrationsEmpty')}</div>
                  ) : inspectingReport.registrations.map((reg) => (
                    <div
                      key={reg.submod_id}
                      className="p-3 flex items-center justify-between bg-white text-xs"
                    >
                      <div>
                        <div className="font-semibold text-neutral-900">{reg.name}</div>
                        <div className="text-[11px] text-neutral-500 font-mono">
                          {t('author.registrationMeta', { id: reg.submod_id, version: reg.version, author: reg.author })}
                          {reg.source_path && <><br />{t('author.registrationSource', { path: reg.source_path })}</>}
                        </div>
                      </div>
                      <span
                        className={`text-[11px] font-mono px-2 py-0.5 rounded font-semibold ${
                          reg.confidence === 'known'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-rose-100 text-rose-900 border border-rose-300'
                        }`}
                      >
                        {t('author.confidence', { value: reg.confidence.toUpperCase() })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sprite Identities & Derived Gifts */}
              {inspectingReport.sprite_identities.length > 0 && (
                <details className="group rounded border border-neutral-200 bg-white overflow-hidden">
                  <summary className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 cursor-pointer select-none list-none hover:bg-neutral-50 [&::-webkit-details-marker]:hidden active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
                    <span className="text-xs font-bold text-neutral-900 uppercase tracking-wider flex items-center gap-1.5">
                      <ChevronRight className="w-3.5 h-3.5 text-neutral-500 group-open:hidden" />
                      <ChevronDown className="w-3.5 h-3.5 text-neutral-500 hidden group-open:block" />
                      {t('author.giftsTitle')}
                    </span>
                    <span className="text-[11px] text-neutral-500">{t('author.giftCount', { count: inspectingReport.sprite_identities.length })}</span>
                    <span className="ml-auto text-[11px] text-neutral-500">
                      <span className="group-open:hidden">{t('common.expand')}</span>
                      <span className="hidden group-open:inline">{t('common.collapse')}</span>
                    </span>
                  </summary>
                  <div className="border-t border-neutral-200 divide-y divide-neutral-100">
                    {inspectingReport.sprite_identities.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-3 bg-white text-xs"
                      >
                        <div className="font-semibold text-neutral-900 font-mono">
                          {item.giftname}.gift
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          {t('author.giftCategory', { category: item.category })}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Package Files Tree / Detailed Table */}
              <details className="group rounded border border-neutral-200 bg-white overflow-hidden">
                <summary className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 cursor-pointer select-none list-none hover:bg-neutral-50 [&::-webkit-details-marker]:hidden">
                  <span className="text-xs font-bold text-neutral-900 uppercase tracking-wider flex items-center gap-1.5">
                    <ChevronRight className="w-3.5 h-3.5 text-neutral-500 group-open:hidden" />
                    <ChevronDown className="w-3.5 h-3.5 text-neutral-500 hidden group-open:block" />
                    {t('author.fileTreeTitle')}
                  </span>
                  <span className="text-[11px] text-neutral-500">{t('author.fileCount', { count: inspectingReport.files.length })}</span>
                  <span className="ml-auto text-[11px] text-neutral-500">
                    <span className="group-open:hidden">{t('common.expand')}</span>
                    <span className="hidden group-open:inline">{t('common.collapse')}</span>
                  </span>
                </summary>
                <div className="border-t border-neutral-200 overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left text-xs border-collapse">
                    <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 font-medium">
                      <tr>
                        <th className="py-2 px-3">{t('author.colPath')}</th>
                        <th className="py-2 px-3">{t('author.colSize')}</th>
                        <th className="py-2 px-3">{t('author.colSha')}</th>
                        <th className="py-2 px-3">{t('author.colWarnings')}</th>
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
                              {t('author.fileKind', { kind: f.kind })}
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
                              <span className="text-neutral-500">{t('author.noFileWarnings')}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>

            <div className="px-6 py-3 border-t border-neutral-200 bg-neutral-50/50 flex justify-end">
              <button
                onClick={() => setInspectingReportId(null)}
                className="px-4 py-1.5 text-xs font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded transition-colors active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                {t('author.done')}
              </button>
            </div>
          </m.div>
        </m.div>
      )}
      </AnimatePresence>

      {/* New Mod Draft Modal */}
      <AnimatePresence>
      {isNewModModalOpen && (
        <m.div
          variants={overlayVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs"
        >
          <m.div
            variants={panelVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="bg-white rounded-lg border border-neutral-200 shadow-xl max-w-5xl w-full max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between shrink-0">
              <h3 className="text-sm font-semibold text-neutral-900">{editingModId ? t('author.editModTitle') : t('author.newModTitle')}</h3>
              <button
                onClick={() => { setIsNewModModalOpen(false); setEditingModId(null); }}
                className="text-neutral-400 hover:text-neutral-600 text-xs"
              >
                {t('common.cancel')}
              </button>
            </div>

            <form onSubmit={handleCreateDraftSubmit} className="flex min-h-0 flex-1 flex-col text-xs">
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <div className="min-w-0 space-y-4">
              <div>
                <label className="block font-medium text-neutral-700 mb-1">{t('author.sourceLabel')}</label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-neutral-100 rounded border border-neutral-200">
                  <button
                    type="button"
                    aria-pressed={newSourceType === 'local'}
                    onClick={() => setNewSourceType('local')}
                    className={valueSegmentClass(newSourceType === 'local')}
                  >
                    {t('author.sourceLocal')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={newSourceType === 'github_releases'}
                    onClick={() => setNewSourceType('github_releases')}
                    className={valueSegmentClass(newSourceType === 'github_releases')}
                  >
                    GitHub Releases
                  </button>
                </div>
              </div>

              {/* 本站上传的发布平台由作者声明：它同时决定目录展示与分平台上传的按钮。
                  GitHub 源由分平台规则派生，所以这里只对本地源出现。 */}
              {newSourceType === 'local' && (
                <div>
                  <label className="block font-medium text-neutral-700 mb-1">{t('author.platformLabel')}</label>
                  <div className="grid grid-cols-2 gap-2 p-1 bg-neutral-100 rounded border border-neutral-200">
                    {ASSET_PLATFORMS.map((platform) => {
                      const selected = newPlatforms.includes(platform);
                      return (
                        <button
                          key={platform}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setNewPlatforms((current) => toggleLocalPlatform(current, platform))}
                          className={valueSegmentClass(selected)}
                        >
                          {assetPlatformLabel(platform)}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    {t('author.platformHint')}
                  </p>
                  {newPlatforms.length === 0 && (
                    <p className="mt-1 text-[11px] text-rose-700">{t('author.platformRequiredHint')}</p>
                  )}
                </div>
              )}

              {newSourceType === 'github_releases' && (
                <div className="rounded border border-emerald-200 bg-emerald-50/40 p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-neutral-700 mb-1">{t('author.ownerLabel')}</label>
                      <input
                        type="text"
                        required={newSourceType === 'github_releases'}
                        placeholder={t('author.ownerPlaceholder')}
                        value={newGitHubOwner}
                        onChange={(e) => setNewGitHubOwner(e.target.value)}
                        className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600 bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-neutral-700 mb-1">{t('author.repoLabel')}</label>
                      <input
                        type="text"
                        required={newSourceType === 'github_releases'}
                        placeholder={t('author.repoPlaceholder')}
                        value={newGitHubRepo}
                        onChange={(e) => setNewGitHubRepo(e.target.value)}
                        className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600 bg-white font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-medium text-neutral-700 mb-1">{t('author.discoveryLabel')}</label>
                    <div className="grid grid-cols-2 gap-2 p-1 bg-white rounded border border-neutral-200">
                      <button
                        type="button"
                        aria-pressed={!newGitHubAction}
                        onClick={() => setNewGitHubAction(false)}
                        className={valueSegmentClass(!newGitHubAction)}
                      >
                        {t('author.discoveryOnDemand')}
                      </button>
                      <button
                        type="button"
                        aria-pressed={newGitHubAction}
                        onClick={() => setNewGitHubAction(true)}
                        className={valueSegmentClass(newGitHubAction)}
                      >
                        {t('author.discoveryWorkflow')}
                      </button>
                    </div>
                  </div>

                  <div
                    className={`rounded border p-2.5 text-[11px] space-y-1 ${
                      newGitHubAction ? 'border-emerald-300 bg-white' : 'border-amber-200 bg-amber-50'
                    }`}
                  >
                    {newGitHubAction ? (
                      <>
                        <p className="text-emerald-800">{t('author.workflowBenefit')}</p>
                        <p className="text-amber-800">{t('author.workflowCost')}</p>
                        <div className="mt-2 pt-2 border-t border-emerald-200 space-y-1.5">
                          <p className="text-neutral-800 font-medium">{workflowHasPattern ? t('author.step1Title') : t('author.step1TitleSource')}</p>
                          <p className="text-neutral-600">
                            {workflowHasPattern ? t('author.step1Body') : t('author.step1BodySource')}
                          </p>
                          {newGitHubSplitPlatforms ? (
                            <ul className="list-disc pl-4 text-neutral-600">
                              <li>{t('author.step1Windows')}<code className="bg-neutral-100 px-1 rounded">{workflowMatcherLabel(newPlatformRules.windows.regex, newPlatformRules.windows.sourceCode)}</code></li>
                              <li>{t('author.step1Android')}<code className="bg-neutral-100 px-1 rounded">{workflowMatcherLabel(newPlatformRules.android.regex, newPlatformRules.android.sourceCode)}</code></li>
                            </ul>
                          ) : (
                            <p className="text-neutral-600">
                              {t('author.step1Shared')}<code className="bg-neutral-100 px-1 rounded">{workflowMatcherLabel(newGitHubAssetRegex, newGitHubSourceCode)}</code>
                            </p>
                          )}
                          <p className="text-neutral-800 font-medium pt-1">{t('author.step2Title')}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={isCopyingWorkflow || !workflowRulesReady}
                              onClick={async () => {
                                setIsCopyingWorkflow(true);
                                try {
                                  const snippet = await fetchWorkflowTemplate(actionRules);
                                  if (!snippet) return;
                                  try {
                                    await navigator.clipboard.writeText(snippet.content);
                                    showToast('success', t('author.workflowCopied', { path: snippet.path }));
                                  } catch {
                                    showToast('error', t('author.clipboardFailed'));
                                  }
                                } finally {
                                  setIsCopyingWorkflow(false);
                                }
                              }}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded transition-colors active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                            >
                              <Copy className="w-3 h-3" />
                              {isCopyingWorkflow ? t('author.fetching') : t('author.copyAction')}
                            </button>
                            <span className="text-neutral-500 font-mono text-[10px]">{WORKFLOW_FILE_PATH}</span>
                          </div>
                          {!workflowRulesReady && (
                            <p className="text-amber-800">{t('author.regexFirst')}</p>
                          )}
                          <p className="text-neutral-500">
                            {t('author.workflowNote')}
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-neutral-800">{t('author.benefit')}{onDemandTradeoff.benefit}</p>
                        <p className="text-amber-800">{t('author.cost')}{onDemandTradeoff.cost}</p>
                      </>
                    )}
                  </div>

                  <div>
                    <label className="block font-medium text-neutral-700 mb-1">{t('author.distributionLabel')}</label>
                    <div className="grid grid-cols-2 gap-2 p-1 bg-white rounded border border-neutral-200">
                      <button
                        type="button"
                        aria-pressed={!newGitHubSplitPlatforms}
                        onClick={() => setNewGitHubSplitPlatforms(false)}
                        className={valueSegmentClass(!newGitHubSplitPlatforms)}
                      >
                        {t('author.distributionShared')}
                      </button>
                      <button
                        type="button"
                        aria-pressed={newGitHubSplitPlatforms}
                        onClick={() => setNewGitHubSplitPlatforms(true)}
                        className={valueSegmentClass(newGitHubSplitPlatforms)}
                      >
                        {t('author.distributionSplit')}
                      </button>
                    </div>
                  </div>

                  {newGitHubSplitPlatforms ? (
                    <>
                      <div className="rounded border border-emerald-300 bg-white p-2.5 text-[11px] space-y-1">
                        <p className="text-emerald-800">{t('author.benefit')}{splitPlatformTradeoff.benefit}</p>
                        <p className="text-amber-800">{t('author.cost')}{splitPlatformTradeoff.cost}</p>
                      </div>
                      {ASSET_PLATFORMS.map((platform) => {
                        const label = assetPlatformLabel(platform);
                        const rule = newPlatformRules[platform];
                        const configured = configuredSplitPlatforms.includes(platform);
                        const ruleCheck = validatePlatformRule(platform, rule.regex, rule.sourceCode);
                        return (
                          <div key={platform} className="rounded border border-neutral-200 bg-white p-2.5 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <label className="block font-medium text-neutral-700">
                                {t('author.ruleRegexLabel', { label })}
                              </label>
                              <span className={`text-[11px] ${
                                !configured ? 'text-neutral-500' : ruleCheck.valid ? 'text-emerald-700' : 'text-rose-700'
                              }`}>
                                {!configured ? t('author.ruleEmpty') : ruleCheck.valid ? t('author.ruleValid') : ruleCheck.error}
                              </span>
                            </div>
                            <input
                              type="text"
                              placeholder={platform === 'windows' ? t('author.ruleWindowsPlaceholder') : t('author.ruleAndroidPlaceholder')}
                              value={rule.regex}
                              onChange={(e) => setNewPlatformRules((prev) => ({ ...prev, [platform]: { ...prev[platform], regex: e.target.value } }))}
                              className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600 bg-white font-mono"
                            />
                            <div className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                id={`gh_platform_source_code_${platform}`}
                                checked={rule.sourceCode}
                                onChange={(e) => setNewPlatformRules((prev) => ({ ...prev, [platform]: { ...prev[platform], sourceCode: e.target.checked } }))}
                                className="mt-0.5 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                              />
                              <label htmlFor={`gh_platform_source_code_${platform}`} className="text-[11px] text-neutral-600 cursor-pointer">
                                {t('author.ruleSourceFallback', { label })}
                              </label>
                            </div>
                          </div>
                        );
                      })}
                      <p className={`text-[11px] ${configuredSplitPlatforms.length > 0 ? 'text-neutral-600' : 'text-rose-700'}`}>
                        {configuredSplitPlatforms.length > 0
                          ? t('author.splitSupported', { list: configuredSplitPlatforms.map((platform) => assetPlatformLabel(platform)).join(t('common.listSeparator')) })
                          : t('author.splitNeedsOne')}
                      </p>
                      <p className="text-[11px] text-neutral-500">
                        {t('author.splitExplain')}
                      </p>
                    </>
                  ) : (
                    <>
                  <div>
                    <label className="block font-medium text-neutral-700 mb-1">{t('author.assetRegexLabel')}</label>

                    <input
                      type="text"
                      placeholder={t('author.assetRegexPlaceholder')}
                      value={newGitHubAssetRegex}
                      onChange={(e) => setNewGitHubAssetRegex(e.target.value)}
                      className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600 bg-white font-mono"
                    />
                    <p className="mt-1 text-[11px] text-neutral-500">
                      {t('author.assetRegexHint')}<code className="bg-neutral-100 px-1 py-0.5 rounded">^MyMod.*\.zip$</code>
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
                      {t('author.assetSourceFallback')}
                      <span className="block text-[11px] text-neutral-500">
                        {t('author.assetSourceFallbackHint')}
                      </span>
                    </label>
                  </div>
                  <p className="text-[11px] text-neutral-500">
                    {t('author.sharedNote')}
                  </p>
                    </>
                  )}
                </div>
              )}

              <div>
                <label className="block font-medium text-neutral-700 mb-1">{t('author.titleLabel')}</label>
                <input
                  type="text"
                  required
                  placeholder={t('author.titlePlaceholder')}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="block font-medium text-neutral-700">{t('author.summaryLabel')}</label>
                  {/* 简介是多语言文本：只渲染当前语言的输入框，另一个语言的译文留在草稿里。 */}
                  <div role="group" className="flex items-center rounded bg-neutral-100 p-0.5 text-[10px] font-medium">
                    {SUPPORTED_LANGS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={summaryLang === option}
                        onClick={() => setSummaryLang(option)}
                        className={`${valueSegmentClass(summaryLang === option, 'px-1.5 py-0.5 rounded')} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600`}
                      >
                        {LANG_SHORT_LABELS[option]}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  rows={2}
                  required
                  placeholder={t('author.summaryPlaceholder')}
                  value={newSummary[summaryLang] ?? ''}
                  onChange={(e) => setNewSummary((current) => withLocalizedValue(current, summaryLang, e.target.value))}
                  className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600"
                />
                {summaryLang === 'en' ? (
                  <p className="mt-1 text-[11px] text-neutral-400">{t('author.englishOptional')}</p>
                ) : null}
              </div>

              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  {t('author.descriptionLabel', { lang: LANG_SHORT_LABELS[summaryLang] })}
                </label>
                <textarea
                  rows={6}
                  placeholder={t('author.descriptionPlaceholder')}
                  value={newDescription[summaryLang] ?? ''}
                  onChange={(e) => setNewDescription((current) => withLocalizedValue(current, summaryLang, e.target.value))}
                  className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600 font-mono"
                />
                <p className="mt-1 text-[11px] text-neutral-400">
                  {t('author.descriptionHint')}
                </p>
              </div>

              <div>
                <label className="block font-medium text-neutral-700 mb-1">{t('author.authorNameLabel')}</label>
                <input
                  type="text"
                  value={newAuthorDisplayName}
                  onChange={(e) => setNewAuthorDisplayName(e.target.value)}
                  placeholder={t('author.authorNamePlaceholder')}
                  className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600"
                />
                <p className="mt-1 text-[11px] text-neutral-400">{t('author.authorNameHint')}</p>
              </div>
                  </div>

                  <div className="min-w-0 space-y-4">

              <div className="rounded border border-neutral-200 bg-neutral-50 p-3 space-y-2">
                <label className="block font-medium text-neutral-700">{t('author.imagesLabel')}</label>
                {detailImageItems.length > 0 && !clearExistingDetailImages && <div className="grid grid-cols-4 gap-2">{detailImageItems.map((item, index) => <div key={item.key} draggable onDragStart={() => setDraggedDetailImage(index)} onDragEnd={() => setDraggedDetailImage(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (draggedDetailImage !== null) moveDetailImage(draggedDetailImage, index); setDraggedDetailImage(null); }} className={`cursor-grab rounded border bg-white p-1 active:cursor-grabbing ${draggedDetailImage === index ? 'border-emerald-500 opacity-60' : item.pending ? 'border-amber-300' : 'border-neutral-200'}`} title={t('author.imageDragTitle')}><div className="relative"><img src={item.url} alt={item.pending ? t('author.imageAltPending', { index: index + 1 }) : t('author.imageAltExisting', { index: index + 1 })} className="h-16 w-full rounded object-cover" /><button type="button" aria-label={t('author.imageRemoveAria', { index: index + 1 })} onClick={(event) => { event.stopPropagation(); removeDetailImage(item.key); }} className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-xs text-white hover:bg-rose-600">×</button></div><span className="block text-center text-[10px] text-neutral-400">#{index + 1}{item.pending ? t('author.imagePendingTag') : ''}</span></div>)}</div>}
                {detailImageItems.length > 1 && !clearExistingDetailImages && <p className="text-[11px] text-neutral-500">{t('author.imagesDragHint')}</p>}
                {editingModId && existingDetailImages.length > 0 && <button type="button" onClick={() => setClearExistingDetailImages((value) => !value)} className="text-[11px] text-rose-700 hover:underline">{clearExistingDetailImages ? t('author.keepImages') : t('author.clearImages')}</button>}
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
                <p className="text-[11px] text-neutral-500">{t('author.imagesHint')}</p>
                {pendingDetailImages.length > 0 && <p className="text-[11px] text-emerald-700">{t('author.imagesPending', { count: pendingDetailImages.length })}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-neutral-700 mb-1">{t('author.categoryLabel')}</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as ModCategory)}
                    className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600 bg-white"
                  >
                    <option value="submod">{t('author.categorySubmod')}</option>
                    <option value="spritepack">{t('author.categorySpritepack')}</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-neutral-700 mb-1">
                    {t('author.masRangeLabel')}
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
                    {t('author.priorityLabel')}
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
              </div>

              <div>
                <TagPicker
                  groups={tagGroups}
                  value={newTags}
                  onChange={setNewTags}
                  loading={tagCatalogLoading}
                  error={tagCatalogError}
                  disabled={tagCatalogLoading || tagCatalogError !== null}
                />
              </div>

                  </div>
                </div>
              </div>

              <div className="px-5 py-3 flex justify-end gap-2 border-t border-neutral-100 bg-white shrink-0">
                <button
                  type="button"
                  onClick={() => { setIsNewModModalOpen(false); setEditingModId(null); }}
                  className="px-3 py-1.5 text-neutral-600 hover:text-neutral-900"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={!isValidTagSelection(newTags)}
                  title={isValidTagSelection(newTags) ? undefined : t('tagPicker.atLeastOne')}
                  className="px-4 py-1.5 text-white bg-emerald-700 hover:bg-emerald-800 rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {editingModId ? t('author.saveChanges') : t('author.saveDraft')}
                </button>
              </div>
            </form>
          </m.div>
        </m.div>
      )}
      </AnimatePresence>

      {/* New Candidate Version Modal */}
      <AnimatePresence>
      {versionFormTarget && (
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
            className="bg-white rounded-lg border border-neutral-200 shadow-xl max-w-xl w-full max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">
                {versionFormTarget === 'new' ? t('author.createVersion') : t('author.editVersionTitle')}
              </h3>
              <button
                onClick={() => setVersionFormTarget(null)}
                className="text-neutral-400 hover:text-neutral-600 text-xs"
              >
                {t('common.cancel')}
              </button>
            </div>

            <form onSubmit={handleCreateVersionSubmit} className="p-5 space-y-4 text-xs overflow-y-auto">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-medium text-neutral-700">{t('author.depsTitle')}</span>
                  <button type="button" onClick={() => setNewDependencies((previous) => [...previous, { mod_id: '', mod_title: '', version_range: '', required: true }])} className="inline-flex items-center gap-1 text-emerald-700 hover:underline"><Plus className="h-3.5 w-3.5" />{t('author.addDependency')}</button>
                </div>
                <div className="mb-2 text-[11px] text-neutral-500">{t('author.rangeHint')}{t('author.rangeExample')}</div>
                <div className="space-y-2">
                  {newDependencies.map((dependency, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-2">
                      <DependencyNamePicker
                        label={t('author.depIndexLabel', { index: index + 1 })}
                        value={dependency.linked_mod_id ? (mods.find((mod) => mod.id === dependency.linked_mod_id)?.title || dependency.mod_title || dependency.mod_id) : (dependency.mod_title || dependency.mod_id)}
                        options={mods.filter((mod) => mod.is_published && mod.id !== activeMod?.id)}
                        onInput={(name) => setNewDependencies((previous) => previous.map((item, position) => position === index ? mapDependencyInput(item, name, mods, activeMod?.id || '') : item))}
                        onCommit={(name) => setNewDependencies((previous) => previous.map((item, position) => position === index ? mapDependencyInput(item, name, mods, activeMod?.id || '') : item))}
                        onSelect={(mod) => setNewDependencies((previous) => previous.map((item, position) => position === index ? mapDependencySelection(item, mod, false) : item))}
                      />
                      <input
                        aria-label={t('author.depIndexRangeAria', { index: index + 1 })}
                        value={dependency.version_range}
                        onChange={(event) => setNewDependencies((previous) => previous.map((item, position) => position === index ? mapDependencyRangeInput(item, event.target.value) : item))}
                        placeholder={t('author.rangePlaceholder')}
                        className="min-w-44 flex-1 rounded border border-neutral-300 bg-white px-2 py-1.5 font-mono"
                      />
                      <button type="button" title={t('author.removeDependency')} aria-label={t('author.removeDependencyIndex', { index: index + 1 })} onClick={() => setNewDependencies((previous) => previous.filter((_, position) => position !== index))} className="p-1.5 text-neutral-500 hover:text-rose-700"><X className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  {t('author.versionStringLabel')}
                </label>
                <input
                  type="text"
                  placeholder={t('author.versionStringPlaceholder')}
                  value={newVerString}
                  onChange={(e) => setNewVerString(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600 font-mono"
                />
              </div>

              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  {t('author.releaseNotesLabel')}
                </label>
                <textarea
                  rows={3}
                  placeholder={t('author.releaseNotesPlaceholder')}
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
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-white bg-neutral-900 hover:bg-neutral-800 rounded font-medium transition-colors"
                >
                  {versionFormTarget === 'new' ? t('author.confirmCreateVersion') : t('author.saveVersion')}
                </button>
              </div>
            </form>
          </m.div>
        </m.div>
      )}
      </AnimatePresence>

      {/* GitHub Releases Import Modal */}
      <AnimatePresence>
      {isGithubImportOpen && (
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
              <div className="flex items-center gap-2">
                <Github className="w-4 h-4 text-neutral-900" />
                <h3 className="text-sm font-semibold text-neutral-900">
                  {t('author.importTitle')}
                </h3>
              </div>
              <button
                onClick={() => setIsGithubImportOpen(false)}
                className="text-neutral-400 hover:text-neutral-600 text-xs"
              >
                {t('common.cancel')}
              </button>
            </div>

            <form onSubmit={handleGithubImport} className="p-5 space-y-4 text-xs">
              <p className="text-neutral-600 leading-relaxed">
                {t('author.importBody')}
              </p>

              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  {t('author.importUrlLabel')}
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
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-white bg-neutral-900 hover:bg-neutral-800 rounded font-medium transition-colors"
                >
                  {t('author.importStart')}
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
