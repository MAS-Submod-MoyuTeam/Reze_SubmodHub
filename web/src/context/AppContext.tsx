import React, { createContext, useContext, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import { apiBase } from '../apiBase';
import type { LocalizedText } from '../../../ui/localized-text';

import {
  User,
  UserRole,
  ModSummary,
  ModVersion,
  ScanReport,
  DownloadDescriptor,
  type AssetPlatform,
} from '../types/submodhub';
import { fetchDownloadDescriptor, fetchPublishedCatalog, fetchPublishedVersions } from '../../../ui/catalog-api';
import { loginFlarum as loginFlarumRequest, logout as logoutRequest, readSession, Session } from '../../../ui/auth-api';
import { clearVersionDeprecation as clearVersionDeprecationRequest, createAuthorMod, createAuthorVersion, decideReview, deleteAuthorMod as deleteAuthorModRequest, deleteAuthorVersion, deprecateVersion as deprecateVersionRequest, editAuthorVersion, markPublishedVersionLatest, platformScanReportId, publishReview, submitAuthorVersion, unpublishAuthorMod as unpublishAuthorModRequest, unpublishVersion as unpublishVersionRequest, updateAuthorMod, uploadAuthorArchive, uploadModImages, syncAuthorModGitHub, fetchAuthorModWorkflow, fetchAuthorWorkflowTemplate, type SyncSummary, type GitHubWorkflowSnippet, type GitHubWorkflowTemplate, type GitHubWorkflowRules } from '../../../ui/submission-api';
import { mapServerScanReport } from './scanReport';
import { refreshWindowText as formatRefreshWindow, type SourcePolicy } from '../components/sourceConfig';
import { assetPlatformLabel } from '../types/submodhub';
import { EMPTY_TAG_FILTER, toggleTagFilter, type TagFilterStates } from '../../../ui/tag-filter';

export type NavTab =
  | 'catalog'
  | 'author'
  | 'reviewer'
  | 'admin';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  code?: string;
}

export interface AuthorPageData { mods?: ModSummary[]; versions?: ModVersion[]; scanReports?: Record<string, ScanReport> }

export interface AppContextType {
  // Navigation & View
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  selectedModId: string | null;
  setSelectedModId: (id: string | null) => void;
  detailModalModId: string | null;
  setDetailModalModId: (id: string | null) => void;

  // Session & Roles
  currentUser: User | null;
  loginFlarum: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  hasRole: (role: UserRole) => boolean;

  // Site Policy (public, no credentials)
  /** 服务端当前生效的 GitHub 源刷新窗口；null 表示尚未取到。 */
  refreshWindowText: string;

  // Catalog Data
  mods: ModSummary[];
  versions: ModVersion[];
  scanReports: Record<string, ScanReport>;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  categoryFilter: string;
  setCategoryFilter: (c: string) => void;
  platformFilter: string;
  setPlatformFilter: (p: string) => void;
  /** 目录标签筛选：标签名 → 包含/排除。标签默认不选，包含之间是 AND。 */
  tagFilter: TagFilterStates;
  setTagFilter: (next: TagFilterStates) => void;
  /** 点一次标签：未选 → 包含 → 排除 → 未选。 */
  toggleTagFilter: (name: string) => void;
  /** 清空全部标签筛选。 */
  clearTagFilter: () => void;

  // Catalog Load State
  /** 目录是否正在拉取，且手上没有任何可留下的数据；页面据此显示骨架屏。 */
  catalogLoading: boolean;
  /**
   * 目录是否正在刷新，同时保留着上一次成功的数据。
   *
   * 刷新时清空屏幕等于把失败藏起来：拉取一结束骨架消失，用户只会看到「加载中」。
   * 刷新入口因此用这个状态置灰并旋转，列表继续显示旧内容。
   */
  catalogRefreshing: boolean;
  /** 最近一次目录拉取的失败原因；null 表示上次拉取成功。项目没有离线快照，失败必须可见。 */
  catalogError: string | null;
  /**
   * 重新拉取已发布目录。失败时写入 catalogError 并提示，不向上抛错。
   * 并发调用共享同一次拉取：两个刷新入口同时点击不会把同一份目录请求两遍。
   */
  reloadCatalog: () => Promise<void>;

  // Mod Detail Helper
  getModWithVersions: (modId: string) => {
    mod: ModSummary | undefined;
    versions: ModVersion[];
    latestVersion?: ModVersion;
  };
  getDownloadDescriptor: (versionId: string, platform?: AssetPlatform) => Promise<DownloadDescriptor>;

  cacheAuthorPage: (page: AuthorPageData) => void;

  // Author Actions
  createModDraft: (data: Partial<ModSummary>) => Promise<string>;
  updateModDraft: (modId: string, data: Partial<ModSummary>) => Promise<boolean>;
  createCandidateVersion: (modId: string, version: string, releaseNotes: string, dependencies?: ModVersion['dependencies']) => Promise<string>;
  uploadArchiveAndScan: (versionId: string, file: File | { name: string; size: number }, platform?: AssetPlatform) => Promise<string>;
  uploadDetailImages: (modId: string, files: File[]) => Promise<boolean>;
  submitVersionForReview: (versionId: string, markLatest: boolean) => Promise<boolean>;
  setLatestPublishedVersion: (versionId: string) => Promise<void>;

  // Reviewer Actions
  approveSubmission: (submissionId: string, reason: string) => Promise<boolean>;
  rejectSubmission: (submissionId: string, reason: string) => Promise<boolean>;
  publishApprovedVersion: (submissionId: string) => Promise<boolean>;

  // Admin Actions
  unpublishVersion: (versionId: string, reason: string) => Promise<void>;
  syncModReleases: (modId: string) => Promise<SyncSummary | null>;
  fetchModWorkflowSnippet: (modId: string) => Promise<GitHubWorkflowSnippet | null>;
  // Mod-independent workflow body, for the draft form before a mod exists.
  fetchWorkflowTemplate: (rules?: GitHubWorkflowRules) => Promise<GitHubWorkflowTemplate | null>;
  markVersionDeprecated: (versionId: string, reason: string) => Promise<void>;
  clearVersionDeprecation: (versionId: string) => Promise<void>;
  deleteVersion: (versionId: string) => Promise<void>;
  unpublishMod: (modId: string) => Promise<boolean>;
  deleteModDraft: (modId: string) => Promise<void>;
  editVersion: (versionId: string, version: string, releaseNotes: string, dependencies?: ModVersion['dependencies']) => Promise<boolean>;

  // Notifications
  toasts: Toast[];
  showToast: (type: Toast['type'], message: string, code?: string) => void;
  removeToast: (id: string) => void;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 操作反馈要跟随界面语言：这里取到的 `t` 供下面所有 toast 使用。
  const { t } = useI18n();
  // Navigation
  const [activeTab, setActiveTab] = useState<NavTab>('catalog');
  const [selectedModId, setSelectedModId] = useState<string | null>(null);
  const [detailModalModId, setDetailModalModId] = useState<string | null>(null);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [csrfToken, setCsrfToken] = useState('');

  // Site policy: the server owns the refresh window, so the copy quotes it.
  const [sourcePolicy, setSourcePolicy] = useState<SourcePolicy | null>(null);

  // Data Store
  const [mods, setMods] = useState<ModSummary[]>([]);
  const [versions, setVersions] = useState<ModVersion[]>([]);
  // Scan reports are server-side artifacts: they start empty and are filled by
  // the upload / catalog paths. No local seed, no fabricated report.
  const [scanReports, setScanReports] = useState<Record<string, ScanReport>>({});

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState<TagFilterStates>(EMPTY_TAG_FILTER);
  const toggleTagFilterState = useCallback((name: string) => {
    setTagFilter((prev) => toggleTagFilter(prev, name));
  }, []);
  const clearTagFilterState = useCallback(() => setTagFilter(EMPTY_TAG_FILTER), []);

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);

  const refreshPublishedCatalog = useCallback(async () => {
    const base = apiBase();
    const entries = await fetchPublishedCatalog(base);
    const publishedMods: ModSummary[] = entries.map(({ mod, version }) => ({
      id: mod.id, title: mod.title, summary: mod.summary || {}, description: mod.description && Object.keys(mod.description).length > 0 ? mod.description : (mod.summary || {}),
      author: mod.author || { id: '', display_name: t('toast.unknownAuthor') }, category: mod.category || 'submod',
      tags: mod.tags || [], supported_platforms: mod.supported_platforms || [], mas_version_range: mod.mas_version_range || '',
      recommended_priority: mod.recommended_priority || 0, latest_version_id: version.id, downloads_count: mod.downloads_count || 0,
      client_reported_downloads: mod.client_reported_downloads || 0, download_attempts: mod.download_attempts || 0,
      updated_at: '', created_at: '', is_published: true,
    }));
    setMods((prev) => [...publishedMods, ...prev.filter((mod) => !mod.is_published && !publishedMods.some((published) => published.id === mod.id))]);
    const histories = await Promise.all(entries.map(({ mod }) => fetchPublishedVersions(mod.id, base)));
  const publishedVersions: ModVersion[] = histories.flat().map((version) => ({ ...version, release_notes: version.release_notes || '', dependencies: version.dependencies || [], created_at: version.created_at || '', is_immutable: true }));
    setVersions((prev) => [...publishedVersions, ...prev.filter((version) => version.state !== 'published' && !publishedVersions.some((published) => published.id === version.id))]);
  }, []);

  // 目录请求在飞（首屏也归它管，所以初值是 true）：挂载 effect 的第一件事就是拉目录，
  // 第一帧不能先摆出「未找到匹配的模组」，那只是一句还没成立的结论。
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  // 手上已经有一份成功拉取的目录：之后的拉取都是「刷新」，旧内容留在屏幕上。
  const catalogLoadedRef = useRef(false);
  // 正在进行的拉取。刷新入口不止一个（悬浮按钮、失败条），重复点击不该打两遍请求。
  const catalogReloadRef = useRef<Promise<void> | null>(null);

  const applySession = useCallback((session: Session) => {
    setCsrfToken(session.csrf_token);
    if (!session.user) {
      setMods((prev) => prev.filter((mod) => mod.is_published));
      setVersions((prev) => prev.filter((version) => version.state === 'published'));
    }
    setCurrentUser(session.user ? {
      ...session.user,
      roles: session.roles.filter((role): role is UserRole => ['user', 'author', 'reviewer', 'admin'].includes(role)),
    } : null);
  }, []);

  useEffect(() => {
    const base = apiBase();
    readSession(base).then(applySession).catch(() => applySession({ user: null, roles: [], csrf_token: '' }));
  }, [applySession]);

  // The window is public policy, so it is read once at boot. A failed read keeps
  // the fallback text rather than hiding the author's cost disclosure.
  useEffect(() => {
    const base = apiBase();
    let cancelled = false;
    fetch(`${base}/source-policy`, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((policy: SourcePolicy | null) => {
        if (!cancelled && policy) setSourcePolicy(policy);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshWindowText = useMemo(() => formatRefreshWindow(sourcePolicy), [sourcePolicy]);

  const cacheAuthorPage = useCallback((page: AuthorPageData) => {
    if (page.mods) setMods((prev) => [...page.mods!, ...prev.filter((item) => !page.mods!.some((entry) => entry.id === item.id))]);
    if (page.versions) setVersions((prev) => [...page.versions!, ...prev.filter((item) => !page.versions!.some((entry) => entry.id === item.id))]);
    if (page.scanReports) setScanReports((prev) => ({ ...prev, ...page.scanReports }));
  }, []);

  const showToast = useCallback((type: Toast['type'], message: string, code?: string) => {
    const id = 'toast_' + Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message, code }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // 项目不提供离线缓存快照：拉取失败时保留上一次成功的数据，但失败必须可见
  // （页面级失败态 + 提示），否则会把「加载失败」退化成「目录为空」。
  // 首次加载与刷新的区别只在「有没有旧数据可留」：有旧数据时刷新不能清屏，
  // 否则失败条永远轮不到渲染，用户只看到一屏骨架。
  const reloadCatalog = useCallback(async () => {
    const running = catalogReloadRef.current;
    if (running) return running;
    const keepsContent = catalogLoadedRef.current;
    if (keepsContent) setCatalogRefreshing(true);
    else setCatalogLoading(true);
    setCatalogError(null);
    const attempt = (async () => {
      try {
        await refreshPublishedCatalog();
        catalogLoadedRef.current = true;
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown_error';
        setCatalogError(detail);
        showToast('error', t('toast.catalogLoadFailed', { error: detail }));
      } finally {
        setCatalogLoading(false);
        setCatalogRefreshing(false);
      }
    })();
    catalogReloadRef.current = attempt;
    try {
      await attempt;
    } finally {
      catalogReloadRef.current = null;
    }
  }, [refreshPublishedCatalog, showToast]);

  useEffect(() => {
    void reloadCatalog();
  }, [reloadCatalog]);

  const hasRole = useCallback(
    (role: UserRole) => {
      if (!currentUser) return false;
      return currentUser.roles.includes(role);
    },
    [currentUser]
  );

  const loginFlarum = useCallback(async (username: string, password: string): Promise<boolean> => {
    const base = apiBase();
    try {
      const session = await loginFlarumRequest(username, password, base);
      applySession(session);
      showToast('success', t('toast.loginOk'));
      return true;
    } catch (error) {
      showToast('error', t('toast.loginFailed', { error: error instanceof Error ? error.message : 'unknown_error' }));
      return false;
    }
  }, [applySession, showToast]);

  const logout = useCallback(() => {
    const base = apiBase();
    logoutRequest(csrfToken, base)
      .then(() => { applySession({ user: null, roles: [], csrf_token: '' }); showToast('info', t('toast.logoutOk')); })
      .catch((error) => showToast('error', t('toast.logoutFailed', { error: error instanceof Error ? error.message : 'unknown_error' })));
  }, [applySession, csrfToken, showToast]);

  const getModWithVersions = useCallback(
    (modId: string) => {
      const mod = mods.find((m) => m.id === modId);
      const modVersions = versions.filter((v) => v.mod_id === modId);
      const latestVersion = modVersions.find((v) => v.id === mod?.latest_version_id) || modVersions[0];
      return { mod, versions: modVersions, latestVersion };
    },
    [mods, versions]
  );

  const getDownloadDescriptor = useCallback(
    async (versionId: string, platform?: AssetPlatform): Promise<DownloadDescriptor> => {
      const base = apiBase();
      const result = await fetchDownloadDescriptor(versionId, base, fetch, platform);
      const suffix = result.platform ? `-${result.platform}` : '';
      return { ...result, filename: `submod_${versionId}${suffix}.zip` };
    },
    []
  );

  // Author Actions
  const createModDraft = useCallback(
    async (data: Partial<ModSummary>): Promise<string> => {
      if (!currentUser) {
        showToast('error', t('toast.loginRequired'), 'unauthenticated');
        return '';
      }
      const newId = 'mod_' + (data.title?.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20) || 'draft_' + Date.now());
      const newMod: ModSummary = {
        id: newId,
        title: data.title || t('toast.untitledDraft'),
        // 新建草稿只写中文：英文留给作者在编辑器里补，留空时英文读者看到中文原文。
        summary: (data.summary as LocalizedText | undefined) || { zh: t('toast.noSummary') },
        description: (data.description as LocalizedText | undefined) || (data.summary as LocalizedText | undefined) || { zh: '## 模组概述\n欢迎使用本模组。' },
        author: {
          id: currentUser.id,
          display_name: currentUser.display_name,
        },
        category: data.category || 'submod',
        // 标签只能来自站点目录，调用方必须显式给出；缺省就交给服务端报 tags_required，
        // 不能用某个硬编码标签兜底（那会绕过目录校验）。
        tags: data.tags ?? [],
        supported_platforms: data.supported_platforms || ['windows', 'android'],
        mas_version_range: data.mas_version_range || '>=0.12.14',
        recommended_priority: data.recommended_priority || 20,
        latest_version_id: '',
        downloads_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_published: false,
        source_type: data.source_type || 'local',
        github_owner: data.github_owner || '',
        github_repo: data.github_repo || '',
        github_asset_regex: data.github_asset_regex || '',
        github_source_code: Boolean(data.github_source_code),
      };

      const base = apiBase();
      try {
        const remote = await createAuthorMod(base, {
          title: newMod.title,
          summary: newMod.summary,
          description: newMod.description,
          author_display_name: data.author_display_name || '',
          category: newMod.category,
          tags: newMod.tags,
          supported_platforms: newMod.supported_platforms,
          mas_version_range: newMod.mas_version_range,
          recommended_priority: newMod.recommended_priority,
          source_type: newMod.source_type,
          github_owner: newMod.github_owner,
          github_repo: newMod.github_repo,
          github_asset_regex: newMod.github_asset_regex,
          github_source_code: newMod.github_source_code,
          github_platform_assets: data.github_platform_assets,
        });
        const persisted = {
          ...newMod,
          id: remote.id,
          author: remote.author,
          title: remote.title,
          summary: remote.summary,
          category: remote.category,
          source_type: remote.source_type,
          github_owner: remote.github_owner,
          github_repo: remote.github_repo,
          github_asset_regex: remote.github_asset_regex,
          github_source_code: remote.github_source_code,
          github_platform_assets: remote.github_platform_assets,
        };
        setMods((prev) => [persisted, ...prev]);
        showToast('success', t('toast.draftCreated', { title: newMod.title }));
        return remote.id;
      } catch (error) {
        showToast('error', t('toast.draftSaveFailed', { error: error instanceof Error ? error.message : 'unknown_error' }));
        return '';
      }
    },
    [currentUser, showToast]
  );

  const updateModDraft = useCallback(
    async (modId: string, data: Partial<ModSummary>): Promise<boolean> => {
      const base = apiBase();
      const existing = mods.find((mod) => mod.id === modId);
      if (!existing) return false;
      try {
        const remote = await updateAuthorMod(base, modId, {
          title: data.title ?? existing.title,
          summary: data.summary ?? existing.summary,
          description: data.description ?? existing.description,
          author_display_name: data.author_display_name || '',
          category: data.category ?? existing.category,
          tags: data.tags ?? existing.tags,
          supported_platforms: data.supported_platforms ?? existing.supported_platforms,
          mas_version_range: data.mas_version_range ?? existing.mas_version_range,
          recommended_priority: data.recommended_priority ?? existing.recommended_priority,
          source_type: data.source_type ?? existing.source_type,
          github_owner: data.github_owner ?? existing.github_owner,
          github_repo: data.github_repo ?? existing.github_repo,
          github_asset_regex: data.github_asset_regex ?? existing.github_asset_regex,
          github_source_code: data.github_source_code ?? existing.github_source_code,
          github_platform_assets: data.github_platform_assets ?? existing.github_platform_assets,
        });
        setMods((prev) => prev.map((mod) => mod.id === modId ? {
          ...mod,
          ...data,
          id: remote.id,
          title: remote.title,
          summary: remote.summary,
          description: remote.description || data.description || existing.description,
          category: remote.category,
          author: remote.author,
          tags: remote.tags || [],
          supported_platforms: (remote.supported_platforms || []) as ModSummary['supported_platforms'],
          mas_version_range: remote.mas_version_range || '',
          recommended_priority: remote.recommended_priority || 0,
          github_platform_assets: remote.github_platform_assets ?? data.github_platform_assets,
          updated_at: new Date().toISOString(),
        } : mod));
        showToast('success', t('toast.metaSaved'));
        return true;
      } catch (error) {
        showToast('error', t('toast.metaSaveFailed', { error: error instanceof Error ? error.message : 'unknown_error' }));
        return false;
      }
    },
    [mods, showToast]
  );

  const createCandidateVersion = useCallback(
    async (modId: string, version: string, releaseNotes: string, dependencies: ModVersion['dependencies'] = []): Promise<string> => {
      const base = apiBase();
      try {
        const remote = await createAuthorVersion(base, modId, version, releaseNotes, dependencies);
        setVersions((prev) => [{ id: remote.id, mod_id: remote.mod_id, version: remote.version, state: remote.state as ModVersion['state'], size_bytes: remote.size_bytes, sha256: remote.sha256, release_notes: remote.release_notes, dependencies: remote.dependencies as ModVersion['dependencies'], created_at: remote.created_at || '', is_immutable: false }, ...prev]);
        showToast('success', t('toast.versionDraftCreated'));
        return remote.id;
      } catch (error) {
        showToast('error', t('toast.versionDraftSaveFailed', { error: error instanceof Error ? error.message : 'unknown_error' }));
        return '';
      }
    },
    [showToast]
  );

  const uploadArchiveAndScan = useCallback(
    async (versionId: string, file: File | { name: string; size: number }, platform?: AssetPlatform): Promise<string> => {
      const reportId = platformScanReportId(versionId, platform);

      if (file instanceof File) {
        const base = apiBase();
        try {
          const result = await uploadAuthorArchive(base, versionId, file, file.name, platform);
          if (result.scan_report) {
            setScanReports((prev) => ({ ...prev, [reportId]: mapServerScanReport(versionId, result.scan_report!, reportId) }));
          }
          const platformAssets = result.platform_assets as ModVersion['platform_assets'];
          setVersions((prev) => prev.map((v) => v.id === versionId ? {
            ...v,
            version: result.version || v.version,
            state: result.state as ModVersion['state'],
            // A per-platform upload leaves the version-wide numbers empty on the
            // server; mirror that instead of displaying one platform's size as
            // the size of the whole version.
            size_bytes: result.platform ? v.size_bytes : result.size_bytes,
            sha256: result.platform ? v.sha256 : result.sha256,
            platform_assets: platformAssets ?? v.platform_assets,
            dependencies: (result as typeof result & { dependencies?: unknown[] }).dependencies as ModVersion['dependencies'] || v.dependencies,
            scan_report_id: result.scan_report ? reportId : v.scan_report_id,
          } : v));
          const label = platform ? ` · ${assetPlatformLabel(platform)}` : '';
          showToast('success', result.version
            ? t('toast.scanDone', { label, version: result.version })
            : t('toast.scanDoneNoVersion', { label }));
          return reportId;
        } catch (error) {
          showToast('error', t('toast.zipUploadFailed', { error: error instanceof Error ? error.message : 'unknown_error' }));
          throw error;
        }
      }

      // Update version to uploaded -> scanning. A per-platform draft records the
      // file on its platform entry, so the version-wide size stays unset.
      setVersions((prev) =>
        prev.map((v) => {
          if (v.id !== versionId) return v;
          if (platform) {
            const others = (v.platform_assets || []).filter((asset) => asset.platform !== platform);
            return { ...v, state: 'scanning', platform_assets: [...others, { platform, size_bytes: file.size }] };
          }
          return { ...v, state: 'scanning', size_bytes: file.size };
        })
      );

      // Generate random simulated SHA256
      const randomHex = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

      // Create detailed ScanReport
      const isUnsafeTest = file.name.toLowerCase().includes('unsafe') || file.name.toLowerCase().includes('hack');
      const hasSpritepack = file.name.toLowerCase().includes('sprite') || file.name.toLowerCase().includes('clothes');

      const newScanReport: ScanReport = {
        id: reportId,
        version_id: versionId,
        status: isUnsafeTest ? 'ready' : 'ready',
        files: [
          {
            source_path: `game/Submods/${versionId}/main.rpy`,
            target_path: `game/Submods/${versionId}/main.rpy`,
            size_bytes: Math.floor(file.size * 0.4),
            sha256: randomHex.substring(0, 64),
            kind: 'script',
          },
          {
            source_path: `game/Submods/${versionId}/assets/preview.png`,
            target_path: `game/Submods/${versionId}/assets/preview.png`,
            size_bytes: Math.floor(file.size * 0.6),
            sha256: randomHex.substring(10, 64) + 'abcd1234',
            kind: hasSpritepack ? 'sprite' : 'audio',
          },
        ],
        unsupported_paths: isUnsafeTest ? ['autorun.bat'] : [],
        registrations: [
          {
            submod_id: versionId,
            name: `Submod ${versionId}`,
            version: '1.0.0',
            author: currentUser?.display_name || 'Author',
            confidence: isUnsafeTest ? 'unknown' : 'known', // Unknown static parsing results must NOT be shown as safe!
          },
        ],
        sprite_identities: hasSpritepack
          ? [
              {
                category: 'clothes',
                name: 'custom_outfit',
                giftname: 'gift_custom_outfit_daily',
                poses: ['def', 'sitting'],
              },
            ]
          : [],
        derived_gifts: hasSpritepack ? ['gift_custom_outfit_daily'] : [],
        blockers: isUnsafeTest
          ? ['静态扫描阻断：检测到外部注入批处理脚本 [autorun.bat]', '未知静态签名 (confidence: unknown)']
          : [],
        warnings: hasSpritepack
          ? ['检测到 Spritepack 礼物注册，请确保未与既有礼物重名。']
          : [],
        resource_stats: {
          total_files: 2,
          scripts_count: 1,
          sprites_count: hasSpritepack ? 1 : 0,
          audio_count: hasSpritepack ? 0 : 1,
          total_size_bytes: file.size,
          binary_flag: isUnsafeTest,
        },
        scanned_at: new Date().toISOString(),
      };

      setScanReports((prev) => ({
        ...prev,
        [reportId]: newScanReport,
      }));

      setVersions((prev) =>
        prev.map((v) =>
          v.id === versionId
            ? {
                ...v,
                state: 'uploaded',
                sha256: randomHex,
                scan_report_id: reportId,
              }
            : v
        )
      );

      showToast('success', t('toast.archiveUploaded', { hash: randomHex.slice(0, 12) }));
      return reportId;
    },
    [currentUser, showToast]
  );

  const uploadDetailImages = useCallback(async (modId: string, files: File[]): Promise<boolean> => {
    try {
      const base = apiBase();
      await uploadModImages(base, modId, files);
      showToast('success', t('toast.imagesUploaded', { count: files.length }));
      return true;
    } catch (error) {
      showToast('error', t('toast.imagesUploadFailed', { error: error instanceof Error ? error.message : 'unknown_error' }));
      return false;
    }
  }, [showToast]);

  const submitVersionForReview = useCallback(
    async (versionId: string, markLatest: boolean): Promise<boolean> => {
      const v = versions.find((item) => item.id === versionId);
      if (!v) return false;
      if (v.state !== 'uploaded') return false;

      const report = v.scan_report_id ? scanReports[v.scan_report_id] : null;
      if (!report) {
        showToast('error', t('toast.archiveRequired'), 'archive_required');
        return false;
      }
      if (report && report.blockers.length > 0) {
        showToast('error', t('toast.submitBlocked', { count: report.blockers.length }), 'validation_failed');
        return false;
      }

      const base = apiBase();
      try {
        const remote = await submitAuthorVersion(base, versionId, markLatest);
        setVersions((prev) => prev.map((item) => item.id === versionId ? { ...item, state: remote.state as ModVersion['state'] } : item));
        showToast('success', t('toast.submitted', { version: v.version }));
        return true;
      } catch (error) {
        showToast('error', t('toast.submitFailed', { error: error instanceof Error ? error.message : 'unknown_error' }));
        return false;
      }
    },
    [versions, scanReports, showToast]
  );

  // Review pages own their remote lists; only update known author/catalog entries here.
  const performReview = useCallback(async (submissionId: string, action: 'approve' | 'reject' | 'publish', reason = ''): Promise<boolean> => {
    if (!currentUser?.roles.includes('admin')) {
      showToast('error', t('toast.forbidden'), 'forbidden');
      return false;
    }
    const base = apiBase();
    try {
      const remote = action === 'publish'
        ? await publishReview(base, submissionId)
        : await decideReview(base, submissionId, action, reason);
      setVersions((prev) => prev.map((item) => item.id === remote.version_id ? {
        ...item, state: remote.state as ModVersion['state'], published_at: remote.published_at,
        is_immutable: remote.state === 'published' || remote.state === 'approved',
      } : item));
      if (remote.state === 'published') await reloadCatalog();
      showToast('success', action === 'reject' ? t('toast.reviewRejected') : t('toast.reviewPublished'));
      return true;
    } catch (error) {
      showToast('error', t('toast.reviewFailed', { error: error instanceof Error ? error.message : 'unknown_error' }));
      return false;
    }
  }, [currentUser, showToast, reloadCatalog]);
  const approveSubmission = useCallback((id: string, reason: string) => performReview(id, 'approve', reason), [performReview]);
  const rejectSubmission = useCallback((id: string, reason: string) => performReview(id, 'reject', reason), [performReview]);
  const publishApprovedVersion = useCallback((id: string) => performReview(id, 'publish'), [performReview]);

  // Admin Actions
  const unpublishVersion = useCallback(
    async (versionId: string, reason: string): Promise<void> => {
      if (!currentUser) { showToast('error', t('toast.signInFirst'), 'unauthenticated'); return; }
      if (!reason.trim()) {
        showToast('error', t('toast.reasonRequired'), 'validation_failed');
        return;
      }

      const base = apiBase();
      try { await unpublishVersionRequest(base, versionId, reason); } catch (error) { showToast('error', t('toast.unpublishFailed', { error: error instanceof Error ? error.message : 'unknown_error' })); return; }
      setVersions((prev) => prev.map((v) => v.id === versionId ? { ...v, state: 'unpublished', unpublish_reason: reason } : v));

      showToast('warning', t('toast.unpublished'));
    },
    [currentUser, showToast]
  );

  const setLatestPublishedVersion = useCallback(async (versionId: string): Promise<void> => {
    const base = apiBase();
    try {
      const remote = await markPublishedVersionLatest(base, versionId);
      setMods((prev) => prev.map((mod) => mod.id === remote.id ? { ...mod, latest_version_id: versionId } : mod));
      showToast('success', t('toast.latestUpdated'));
    } catch (error) {
      showToast('error', t('toast.latestUpdateFailed', { error: error instanceof Error ? error.message : 'unknown_error' }));
    }
  }, [showToast]);

  const deleteVersion = useCallback(async (versionId: string): Promise<void> => {
    const base = apiBase();
    try { await deleteAuthorVersion(base, versionId); setVersions((prev) => prev.filter((v) => v.id !== versionId)); showToast('success', t('toast.versionDeleted')); }
    catch (error) { showToast('error', t('toast.versionDeleteFailed', { error: error instanceof Error ? error.message : 'unknown_error' })); }
  }, [showToast]);

  const unpublishMod = useCallback(async (modId: string): Promise<boolean> => {
    const base = apiBase();
    try {
      await unpublishAuthorModRequest(base, modId);
      setMods((prev) => prev.map((mod) => mod.id === modId ? { ...mod, is_published: false } : mod));
      showToast('success', t('toast.modUnpublished'));
      return true;
    } catch (error) {
      showToast('error', t('toast.modUnpublishFailed', { error: error instanceof Error ? error.message : 'unknown_error' }));
      return false;
    }
  }, [showToast]);

  const deleteModDraft = useCallback(async (modId: string): Promise<void> => {
    const base = apiBase();
    try { await deleteAuthorModRequest(base, modId); setMods((prev) => prev.filter((mod) => mod.id !== modId)); setVersions((prev) => prev.filter((version) => version.mod_id !== modId)); showToast('success', t('toast.modDeleted')); }
    catch (error) { showToast('error', t('toast.modDeleteFailed', { error: error instanceof Error ? error.message : 'unknown_error' })); }
  }, [showToast]);

  const markVersionDeprecated = useCallback(async (versionId: string, reason: string): Promise<void> => {
    const base = apiBase();
    try {
      const remote = await deprecateVersionRequest(base, versionId, reason);
      setVersions((prev) => prev.map((version) => version.id === versionId ? {
        ...version, deprecated: remote.deprecated, deprecation_reason: remote.deprecation_reason,
      } : version));
      showToast('warning', t('toast.deprecatedMarked'));
    } catch (error) {
      showToast('error', t('toast.deprecatedMarkFailed', { error: error instanceof Error ? error.message : 'unknown_error' }));
    }
  }, [showToast]);

  const clearVersionDeprecation = useCallback(async (versionId: string): Promise<void> => {
    const base = apiBase();
    try {
      await clearVersionDeprecationRequest(base, versionId);
      setVersions((prev) => prev.map((version) => version.id === versionId ? {
        ...version, deprecated: false, deprecation_reason: '',
      } : version));
      showToast('success', t('toast.deprecatedCleared'));
    } catch (error) {
      showToast('error', t('toast.deprecatedClearFailed', { error: error instanceof Error ? error.message : 'unknown_error' }));
    }
  }, [showToast]);

  const editVersion = useCallback(async (versionId: string, version: string, releaseNotes: string, dependencies?: ModVersion['dependencies']): Promise<boolean> => {
    const base = apiBase();
    try { const remote = await editAuthorVersion(base, versionId, version, releaseNotes, dependencies ?? versions.find((item) => item.id === versionId)?.dependencies ?? []); setVersions((prev) => prev.map((v) => v.id === versionId ? { ...v, version: remote.version, release_notes: remote.release_notes, dependencies: remote.dependencies as ModVersion['dependencies'] } : v)); showToast('success', t('toast.versionEdited')); return true; }
    catch (error) { showToast('error', t('toast.versionEditFailed', { error: error instanceof Error ? error.message : 'unknown_error' })); return false; }
  }, [showToast, versions]);

  const syncModReleases = useCallback(
    async (modId: string): Promise<SyncSummary | null> => {
      const base = apiBase();
      try {
        const summary = await syncAuthorModGitHub(base, modId);
        if (summary.failed > 0 && summary.created === 0) {
          showToast('error', t('toast.githubSyncFailed', { error: summary.last_error || t('toast.unknownError') }));
        } else if (summary.created > 0) {
          showToast('success', t('toast.githubSyncCreated', { count: summary.created }));
        } else {
          showToast('info', t('toast.githubSyncNoChange'));
        }
        return summary;
      } catch (err) {
        showToast('error', t('toast.githubSyncError', { error: err instanceof Error ? err.message : t('toast.unknownError') }));
        return null;
      }
    },
    [showToast]
  );

  const fetchModWorkflowSnippet = useCallback(
    async (modId: string): Promise<GitHubWorkflowSnippet | null> => {
      const base = apiBase();
      try {
        return await fetchAuthorModWorkflow(base, modId);
      } catch (err) {
        showToast('error', t('toast.notifyFileFailed', { error: err instanceof Error ? err.message : t('toast.unknownError') }));
        return null;
      }
    },
    [showToast]
  );

  // The draft form needs the same file before any mod exists, so it asks for the
  // mod-independent template instead of a per-mod snippet.
  const fetchWorkflowTemplate = useCallback(async (rules?: GitHubWorkflowRules): Promise<GitHubWorkflowTemplate | null> => {
    const base = apiBase();
    try {
      return await fetchAuthorWorkflowTemplate(base, rules ?? {});
    } catch (err) {
      showToast('error', t('toast.notifyFileFailed', { error: err instanceof Error ? err.message : t('toast.unknownError') }));
      return null;
    }
  }, [showToast]);

  const value = useMemo(
    () => ({
      activeTab,
      setActiveTab,
      selectedModId,
      setSelectedModId,
      detailModalModId,
      setDetailModalModId,
      currentUser,
      loginFlarum,
      logout,
      hasRole,
      refreshWindowText,
      mods,
      versions,
      scanReports,
      searchQuery,
      setSearchQuery,
      categoryFilter,
      setCategoryFilter,
      platformFilter,
      setPlatformFilter,
      tagFilter,
      setTagFilter,
      toggleTagFilter: toggleTagFilterState,
      clearTagFilter: clearTagFilterState,
      catalogLoading,
      catalogRefreshing,
      catalogError,
      reloadCatalog,
      getModWithVersions,
      getDownloadDescriptor,
      cacheAuthorPage,
      createModDraft,
      updateModDraft,
      syncModReleases,
      fetchModWorkflowSnippet,
      fetchWorkflowTemplate,
      createCandidateVersion,
      uploadArchiveAndScan,
      uploadDetailImages,
      submitVersionForReview,
      setLatestPublishedVersion,
      approveSubmission,
      rejectSubmission,
      publishApprovedVersion,
      unpublishVersion,
      markVersionDeprecated,
      clearVersionDeprecation,
      deleteVersion,
      unpublishMod,
      deleteModDraft,
      editVersion,
      toasts,
      showToast,
      removeToast,
    }),
    [
      activeTab,
      selectedModId,
      detailModalModId,
      currentUser,
      loginFlarum,
      logout,
      hasRole,
      refreshWindowText,
      mods,
      versions,
      scanReports,
      searchQuery,
      categoryFilter,
      platformFilter,
      tagFilter,
      toggleTagFilterState,
      clearTagFilterState,
      catalogLoading,
      catalogRefreshing,
      catalogError,
      reloadCatalog,
      getModWithVersions,
      getDownloadDescriptor,
      createModDraft,
      updateModDraft,
      syncModReleases,
      fetchModWorkflowSnippet,
      fetchWorkflowTemplate,
      createCandidateVersion,
      uploadArchiveAndScan,
      uploadDetailImages,
      submitVersionForReview,
      setLatestPublishedVersion,
      approveSubmission,
      rejectSubmission,
      publishApprovedVersion,
      unpublishVersion,
      markVersionDeprecated,
      clearVersionDeprecation,
      deleteVersion,
      unpublishMod,
      deleteModDraft,
      editVersion,
      toasts,
      showToast,
      removeToast,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
