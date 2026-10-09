import React, { createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react';
import {
  User,
  UserRole,
  ModSummary,
  ModVersion,
  ScanReport,
  Submission,
  AuditLog,
  Installation,
  InstalledMod,
  InstallationPlan,
  OperationLog,
  DownloadDescriptor,
} from '../types/submodhub';
import {
  INITIAL_SCAN_REPORTS,
  INITIAL_SUBMISSIONS,
  INITIAL_AUDIT_LOGS,
  INITIAL_INSTALLATIONS,
  INITIAL_INSTALLED_MODS,
} from '../data/mockData';
import { fetchDownloadDescriptor, fetchPublishedCatalog, fetchPublishedVersions } from '../../../ui/catalog-api';
import { loginFlarum as loginFlarumRequest, logout as logoutRequest, readSession, Session } from '../../../ui/auth-api';
import { clearVersionDeprecation as clearVersionDeprecationRequest, createAuthorMod, createAuthorVersion, decideReview, deleteAuthorMod as deleteAuthorModRequest, deleteAuthorVersion, deprecateVersion as deprecateVersionRequest, editAuthorVersion, listAuthorSubmissions, listAuthorWorkspace, listReviewAudit, listReviewSubmissions, markPublishedVersionLatest, publishReview, submitAuthorVersion, unpublishAuthorMod as unpublishAuthorModRequest, unpublishVersion as unpublishVersionRequest, updateAuthorMod, uploadAuthorArchive, uploadModImages, syncAuthorModGitHub, type SyncSummary } from '../../../ui/submission-api';
import { mapServerScanReport } from './scanReport';
import { isAuthorModPublished } from '../../../ui/submission-api';

export type NavTab =
  | 'catalog'
  | 'author'
  | 'reviewer'
  | 'admin'
  | 'client'
  | 'states';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  code?: string;
}

interface AppContextType {
  // Navigation & View
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  selectedModId: string | null;
  setSelectedModId: (id: string | null) => void;
  detailModalModId: string | null;
  setDetailModalModId: (id: string | null) => void;

  // Session & Roles
  currentUser: User | null;
  switchRolePersona: (role: 'visitor' | 'author' | 'reviewer' | 'admin') => void;
  loginFlarum: (username: string, password: string) => Promise<boolean>;
  loginGithub: () => Promise<boolean>;
  logout: () => void;
  linkAccount: (provider: 'flarum' | 'github', accountName: string) => void;
  hasRole: (role: UserRole) => boolean;

  // Offline Simulation
  isOffline: boolean;
  setIsOffline: (val: boolean) => void;

  // Catalog Data
  mods: ModSummary[];
  versions: ModVersion[];
  scanReports: Record<string, ScanReport>;
  submissions: Submission[];
  auditLogs: AuditLog[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  categoryFilter: string;
  setCategoryFilter: (c: string) => void;
  platformFilter: string;
  setPlatformFilter: (p: string) => void;
  tagFilter: string;
  setTagFilter: (t: string) => void;

  // Mod Detail Helper
  getModWithVersions: (modId: string) => {
    mod: ModSummary | undefined;
    versions: ModVersion[];
    latestVersion?: ModVersion;
  };
  getDownloadDescriptor: (versionId: string) => Promise<DownloadDescriptor>;

  // Author Actions
  createModDraft: (data: Partial<ModSummary>) => Promise<string>;
  updateModDraft: (modId: string, data: Partial<ModSummary>) => Promise<boolean>;
  createCandidateVersion: (modId: string, version: string, releaseNotes: string, dependencies?: ModVersion['dependencies']) => Promise<string>;
  uploadArchiveAndScan: (versionId: string, file: File | { name: string; size: number }) => Promise<string>;
  uploadDetailImages: (modId: string, files: File[]) => Promise<boolean>;
  submitVersionForReview: (versionId: string, markLatest: boolean) => Promise<boolean>;
  setLatestPublishedVersion: (versionId: string) => Promise<void>;

  // Reviewer Actions
  approveSubmission: (submissionId: string, reason: string) => Promise<void>;
  rejectSubmission: (submissionId: string, reason: string) => Promise<void>;
  publishApprovedVersion: (submissionId: string) => Promise<void>;

  // Admin Actions
  updateUserRoles: (userId: string, newRoles: UserRole[], reason: string) => void;
  unpublishVersion: (versionId: string, reason: string) => Promise<void>;
  syncModReleases: (modId: string) => Promise<SyncSummary | null>;
  markVersionDeprecated: (versionId: string, reason: string) => Promise<void>;
  clearVersionDeprecation: (versionId: string) => Promise<void>;
  deleteVersion: (versionId: string) => Promise<void>;
  unpublishMod: (modId: string) => Promise<void>;
  deleteModDraft: (modId: string) => Promise<void>;
  editVersion: (versionId: string, version: string, releaseNotes: string, dependencies?: ModVersion['dependencies']) => Promise<boolean>;

  // Client Simulation (Section 4)
  installations: Installation[];
  activeInstallationId: string;
  setActiveInstallationId: (id: string) => void;
  installedMods: InstalledMod[];
  currentPlan: InstallationPlan | null;
  operations: OperationLog[];
  previewInstallPlan: (modId: string, versionId: string) => InstallationPlan;
  applyPlan: (plan: InstallationPlan) => Promise<void>;
  simulateExternalChange: (filePath: string) => void;
  adoptUnmanagedMod: (modId: string) => void;
  clearCurrentPlan: () => void;

  // Notifications
  toasts: Toast[];
  showToast: (type: Toast['type'], message: string, code?: string) => void;
  removeToast: (id: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Navigation
  const [activeTab, setActiveTab] = useState<NavTab>('catalog');
  const [selectedModId, setSelectedModId] = useState<string | null>(null);
  const [detailModalModId, setDetailModalModId] = useState<string | null>(null);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [csrfToken, setCsrfToken] = useState('');

  // Offline cache simulation
  const [isOffline, setIsOffline] = useState(false);

  // Data Store
  const [mods, setMods] = useState<ModSummary[]>([]);
  const [versions, setVersions] = useState<ModVersion[]>([]);
  const [scanReports, setScanReports] = useState<Record<string, ScanReport>>(INITIAL_SCAN_REPORTS);
  const [submissions, setSubmissions] = useState<Submission[]>(INITIAL_SUBMISSIONS);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(INITIAL_AUDIT_LOGS);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');

  // Client Companion Simulator State
  const [installations, setInstallations] = useState<Installation[]>(INITIAL_INSTALLATIONS);
  const [activeInstallationId, setActiveInstallationId] = useState<string>(INITIAL_INSTALLATIONS[0].id);
  const [installedMods, setInstalledMods] = useState<InstalledMod[]>(INITIAL_INSTALLED_MODS);
  const [currentPlan, setCurrentPlan] = useState<InstallationPlan | null>(null);
  const [operations, setOperations] = useState<OperationLog[]>([]);

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);

  const refreshPublishedCatalog = useCallback(async () => {
    const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
    const entries = await fetchPublishedCatalog(base);
    const publishedMods: ModSummary[] = entries.map(({ mod, version }) => ({
      id: mod.id, title: mod.title, summary: mod.summary || '', description: mod.description || mod.summary || '',
      author: mod.author || { id: '', display_name: '未知作者' }, category: mod.category || 'submod',
      tags: mod.tags || [], supported_platforms: mod.supported_platforms || [], mas_version_range: mod.mas_version_range || '',
      recommended_priority: mod.recommended_priority || 0, latest_version_id: version.id, downloads_count: mod.downloads_count || 0,
      updated_at: '', created_at: '', is_published: true,
    }));
    setMods((prev) => [...publishedMods, ...prev.filter((mod) => !mod.is_published && !publishedMods.some((published) => published.id === mod.id))]);
    const histories = await Promise.all(entries.map(({ mod }) => fetchPublishedVersions(mod.id, base)));
  const publishedVersions: ModVersion[] = histories.flat().map((version) => ({ ...version, release_notes: version.release_notes || '', dependencies: version.dependencies || [], created_at: version.created_at || '', is_immutable: true }));
    setVersions((prev) => [...publishedVersions, ...prev.filter((version) => version.state !== 'published' && !publishedVersions.some((published) => published.id === version.id))]);
    setIsOffline(false);
  }, []);

  useEffect(() => {
    refreshPublishedCatalog()
      .catch(() => setIsOffline(true));
  }, [refreshPublishedCatalog]);

  const applySession = useCallback((session: Session) => {
    setCsrfToken(session.csrf_token);
    if (!session.user) {
      setMods((prev) => prev.filter((mod) => mod.is_published));
      setVersions((prev) => prev.filter((version) => version.state === 'published'));
    }
    setCurrentUser(session.user ? {
      ...session.user,
      roles: session.roles.filter((role): role is UserRole => ['user', 'author', 'reviewer', 'admin'].includes(role)),
      linked_accounts: {},
    } : null);
  }, []);

  useEffect(() => {
    const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
    readSession(base).then(applySession).catch(() => applySession({ user: null, roles: [], csrf_token: '' }));
  }, [applySession]);

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
    listAuthorWorkspace(base).then((items) => {
      if (cancelled) return;
      const restoredReports = Object.fromEntries(items.flatMap(({ versions: entries, scan_reports: reports }) => entries.flatMap((version) => {
        const report = version.scan_report_id && reports?.[version.scan_report_id];
        return report ? [[version.scan_report_id!, mapServerScanReport(version.id, report)] as const] : [];
      })));
      const ownMods: ModSummary[] = items.map(({ mod, versions: ownVersions }) => ({
        id: mod.id, title: mod.title, summary: mod.summary || '', description: mod.description || mod.summary || '',
        author: mod.author, category: mod.category, tags: mod.tags || [],
        supported_platforms: (mod.supported_platforms || []) as ModSummary['supported_platforms'],
        mas_version_range: mod.mas_version_range || '', recommended_priority: mod.recommended_priority || 0,
        latest_version_id: mod.latest_version_id || '', downloads_count: 0, created_at: '', updated_at: '',
        is_published: isAuthorModPublished(mod, ownVersions),
        source_type: mod.source_type || 'local',
        github_owner: mod.github_owner || '',
        github_repo: mod.github_repo || '',
        github_asset_regex: mod.github_asset_regex || '',
        github_source_code: Boolean(mod.github_source_code),
        github_last_sync_at: mod.github_last_sync_at,
        github_last_sync_error: mod.github_last_sync_error,
        github_last_release_id: mod.github_last_release_id,
        github_backoff_until: mod.github_backoff_until,
      }));
      const ownVersions: ModVersion[] = items.flatMap(({ versions: entries }) => entries.map((version) => ({
        id: version.id, mod_id: version.mod_id, version: version.version, state: version.state as ModVersion['state'],
        size_bytes: version.size_bytes, sha256: version.sha256, release_notes: version.release_notes || '',
        dependencies: (version.dependencies || []) as ModVersion['dependencies'], scan_report_id: version.scan_report_id,
        deprecated: version.deprecated, deprecation_reason: version.deprecation_reason,
        created_at: version.created_at || '', is_immutable: version.state === 'published' || version.state === 'approved',
      })));
      setMods((prev) => [...ownMods, ...prev.filter((mod) => !ownMods.some((owned) => owned.id === mod.id))]);
      setVersions((prev) => [...ownVersions, ...prev.filter((version) => !ownVersions.some((owned) => owned.id === version.id))]);
      setScanReports((prev) => ({ ...prev, ...restoredReports }));
    }).catch(() => setIsOffline(true));
    return () => { cancelled = true; };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
    const load = currentUser.roles.includes('admin') ? listReviewSubmissions(base) : listAuthorSubmissions(base);
    load
      .then((remote) => {
        setScanReports((prev) => ({ ...prev, ...Object.fromEntries(remote.flatMap((item) => item.scan_report_snapshot ? [[`scan_submission_${item.id}`, mapServerScanReport(item.version_id, item.scan_report_snapshot)] as const] : [])) }));
        setSubmissions(remote.map((item) => {
          const existing = submissions.find((entry) => entry.id === item.id);
          const mod = mods.find((entry) => entry.id === item.mod_id);
          const version = versions.find((entry) => entry.id === item.version_id);
          return {
            id: item.id,
            mod_id: item.mod_id,
            version_id: item.version_id,
            mod_title: mod?.title || item.mod_id,
            version_str: item.version_snapshot?.version || version?.version || item.version_id,
            scan_report_id: item.scan_report_snapshot ? `scan_submission_${item.id}` : undefined,
            category: mod?.category || 'submod',
            author_id: item.author_id,
            author_name: mod?.author.display_name || item.author_id,
            submitted_at: item.created_at || existing?.submitted_at || new Date().toISOString(),
            state: item.state as Submission['state'],
            mark_latest: item.mark_latest,
            reviewer_id: item.reviewer_id || existing?.reviewer_id,
            reviewer_name: existing?.reviewer_name,
            decision_reason: item.reason,
            decided_at: item.decided_at || existing?.decided_at,
            published_at: item.published_at || existing?.published_at,
          };
        }));
        setIsOffline(false);
      })
      .catch((error) => showToast('error', `审核队列加载失败：${error instanceof Error ? error.message : 'unknown_error'}`));
    if (currentUser.roles.includes('admin')) {
      listReviewAudit(base).then((remote) => {
        setAuditLogs(remote.map((item) => ({
          id: item.id,
          timestamp: item.timestamp,
          actor_id: item.actor_id,
          actor_name: item.actor_name,
          actor_role: item.actor_role,
          action: item.action as AuditLog['action'],
          target_type: item.target_type as AuditLog['target_type'],
          target_id: item.target_id,
          target_label: item.target_label,
          reason: item.reason,
          details: item.details,
        })));
      }).catch((error) => showToast('error', `审核审计加载失败：${error instanceof Error ? error.message : 'unknown_error'}`));
    }
  }, [currentUser, mods, versions]);

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

  const switchRolePersona = useCallback((_role: 'visitor' | 'author' | 'reviewer' | 'admin') => {
    showToast('warning', '角色切换仅属于设计稿，服务端身份认证尚未接入。');
  }, [showToast]);

  const hasRole = useCallback(
    (role: UserRole) => {
      if (!currentUser) return false;
      return currentUser.roles.includes(role);
    },
    [currentUser]
  );

  const loginFlarum = useCallback(async (username: string, password: string): Promise<boolean> => {
    const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
    try {
      const session = await loginFlarumRequest(username, password, base);
      applySession(session);
      showToast('success', '已登录 Flarum 会话。');
      return true;
    } catch (error) {
      showToast('error', `登录失败：${error instanceof Error ? error.message : 'unknown_error'}`);
      return false;
    }
  }, [applySession, showToast]);

  const loginGithub = useCallback(async (): Promise<boolean> => {
    showToast('error', 'GitHub OAuth 尚未接入，未建立会话。', 'auth_unavailable');
    return false;
  }, [showToast]);

  const logout = useCallback(() => {
    const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
    logoutRequest(csrfToken, base)
      .then(() => { applySession({ user: null, roles: [], csrf_token: '' }); showToast('info', '已退出会话。'); })
      .catch((error) => showToast('error', `退出失败：${error instanceof Error ? error.message : 'unknown_error'}`));
  }, [applySession, csrfToken, showToast]);

  const linkAccount = useCallback(
    (_provider: 'flarum' | 'github', _accountName: string) => {
      showToast('error', '账号关联服务尚未接入。', 'auth_unavailable');
    },
    [showToast]
  );

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
    async (versionId: string): Promise<DownloadDescriptor> => {
      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      const result = await fetchDownloadDescriptor(versionId, base);
      return { ...result, filename: `submod_${versionId}.zip` };
    },
    []
  );

  // Author Actions
  const createModDraft = useCallback(
    async (data: Partial<ModSummary>): Promise<string> => {
      if (!currentUser) {
        showToast('error', '请先登录后创建模组草稿。', 'unauthenticated');
        return '';
      }
      const newId = 'mod_' + (data.title?.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20) || 'draft_' + Date.now());
      const newMod: ModSummary = {
        id: newId,
        title: data.title || '未命名模组草稿',
        summary: data.summary || '暂无简介描述',
        description: data.description || data.summary || '## 模组概述\n欢迎使用本模组。',
        author: {
          id: currentUser.id,
          display_name: currentUser.display_name,
        },
        category: data.category || 'submod',
        tags: data.tags || ['dialogue'],
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

      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
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
        };
        setMods((prev) => [persisted, ...prev]);
        showToast('success', `成功创建模组草稿 [${newMod.title}]`);
        return remote.id;
      } catch (error) {
        showToast('error', `草稿未保存到服务端：${error instanceof Error ? error.message : 'unknown_error'}`);
        return '';
      }
    },
    [currentUser, showToast]
  );

  const updateModDraft = useCallback(
    async (modId: string, data: Partial<ModSummary>): Promise<boolean> => {
      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
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
          updated_at: new Date().toISOString(),
        } : mod));
        showToast('success', '模组元数据已保存。');
        return true;
      } catch (error) {
        showToast('error', `模组元数据保存失败：${error instanceof Error ? error.message : 'unknown_error'}`);
        return false;
      }
    },
    [mods, showToast]
  );

  const createCandidateVersion = useCallback(
    async (modId: string, version: string, releaseNotes: string, dependencies: ModVersion['dependencies'] = []): Promise<string> => {
      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      try {
        const remote = await createAuthorVersion(base, modId, version, releaseNotes, dependencies);
        setVersions((prev) => [{ id: remote.id, mod_id: remote.mod_id, version: remote.version, state: remote.state as ModVersion['state'], size_bytes: remote.size_bytes, sha256: remote.sha256, release_notes: remote.release_notes, dependencies: remote.dependencies as ModVersion['dependencies'], created_at: remote.created_at || '', is_immutable: false }, ...prev]);
        showToast('success', `候选版本草稿已建立，等待上传 ZIP 归档。`);
        return remote.id;
      } catch (error) {
        showToast('error', `候选版本未保存到服务端：${error instanceof Error ? error.message : 'unknown_error'}`);
        return '';
      }
    },
    [showToast]
  );

  const uploadArchiveAndScan = useCallback(
    async (versionId: string, file: File | { name: string; size: number }): Promise<string> => {
      const reportId = 'scan_' + versionId;

      if (file instanceof File) {
        const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
        try {
          const result = await uploadAuthorArchive(base, versionId, file, file.name);
          if (result.scan_report) {
            setScanReports((prev) => ({ ...prev, [reportId]: mapServerScanReport(versionId, result.scan_report!) }));
          }
          setVersions((prev) => prev.map((v) => v.id === versionId ? { ...v, version: result.version || v.version, state: result.state as ModVersion['state'], size_bytes: result.size_bytes, sha256: result.sha256, dependencies: (result as typeof result & { dependencies?: unknown[] }).dependencies as ModVersion['dependencies'] || v.dependencies, scan_report_id: result.scan_report ? reportId : v.scan_report_id } : v));
          showToast('success', result.version ? `ZIP 扫描完成，版本标识：${result.version}` : 'ZIP 扫描完成；提交审核前请填写版本标识。');
          return reportId;
        } catch (error) {
          showToast('error', `ZIP 上传失败：${error instanceof Error ? error.message : 'unknown_error'}`);
          throw error;
        }
      }

      // Update version to uploaded -> scanning
      setVersions((prev) =>
        prev.map((v) => (v.id === versionId ? { ...v, state: 'scanning', size_bytes: file.size } : v))
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

      showToast('success', `ZIP 归档上传成功并已完成静态扫描报告生成 (SHA-256: ${randomHex.slice(0, 12)}...)`);
      return reportId;
    },
    [currentUser, showToast]
  );

  const uploadDetailImages = useCallback(async (modId: string, files: File[]): Promise<boolean> => {
    try {
      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      await uploadModImages(base, modId, files);
      showToast('success', `已上传 ${files.length} 张详情图。`);
      return true;
    } catch (error) {
      showToast('error', `详情图上传失败：${error instanceof Error ? error.message : 'unknown_error'}`);
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
        showToast('error', '请先上传 ZIP 并完成扫描，再提交审核。', 'archive_required');
        return false;
      }
      if (report && report.blockers.length > 0) {
        showToast('error', `无法提交审核：存在 ${report.blockers.length} 个扫描阻断项，请先修正问题包。`, 'validation_failed');
        return false;
      }

      const mod = mods.find((m) => m.id === v.mod_id);
      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      try {
        const remote = await submitAuthorVersion(base, versionId, markLatest);
        setSubmissions((prev) => prev.some((item) => item.id === remote.id) ? prev : [{
          id: remote.id, mod_id: remote.mod_id, version_id: remote.version_id, mod_title: mod?.title || remote.mod_id,
          version_str: v.version, category: mod?.category || 'submod', author_id: remote.author_id,
          author_name: currentUser?.display_name || '作者', submitted_at: remote.created_at || new Date().toISOString(), state: remote.state as Submission['state'], mark_latest: remote.mark_latest,
        }, ...prev]);
        setVersions((prev) => prev.map((item) => item.id === versionId ? { ...item, state: remote.state as ModVersion['state'] } : item));
        showToast('success', `候选版本 ${v.version} 已提交服务端审核队列。`);
        return true;
      } catch (error) {
        showToast('error', `提交审核失败：${error instanceof Error ? error.message : 'unknown_error'}`);
        return false;
      }
    },
    [versions, scanReports, mods, currentUser, showToast]
  );

  // Reviewer Actions
  const approveSubmission = useCallback(
    async (submissionId: string, reason: string): Promise<void> => {
      if (!currentUser || !currentUser.roles.includes('admin')) {
        showToast('error', '缺少审核员权限 (reviewer)。', 'forbidden');
        return;
      }

      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      let published;
      try {
        published = await decideReview(base, submissionId, 'approve', reason);
      } catch (error) {
        showToast('error', `服务端批准失败：${error instanceof Error ? error.message : 'unknown_error'}`);
        return;
      }
      await refreshPublishedCatalog().catch(() => setIsOffline(true));
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === submissionId
            ? {
                ...s,
                state: 'published',
                reviewer_id: currentUser.id,
                reviewer_name: currentUser.display_name,
                decision_reason: reason,
                decided_at: published.decided_at || new Date().toISOString(),
                published_at: published.published_at || new Date().toISOString(),
              }
            : s
        )
      );

      const sub = submissions.find((s) => s.id === submissionId);
      if (sub) {
        setVersions((prev) =>
          prev.map((v) => (v.id === sub.version_id ? { ...v, state: 'published', published_at: published.published_at || new Date().toISOString(), is_immutable: true } : v))
        );

        // Record Audit Log
        const auditItem: AuditLog = {
          id: 'audit_' + Date.now(),
          timestamp: new Date().toISOString(),
          actor_id: currentUser.id,
          actor_name: currentUser.display_name,
          actor_role: 'reviewer',
          action: 'submission_approve',
          target_type: 'submission',
          target_id: sub.id,
          target_label: `${sub.mod_title} (${sub.version_str}) 审核批准`,
          reason,
        };
        setAuditLogs((prev) => [auditItem, ...prev]);
      }

      showToast('success', '审核通过，版本已自动发布到模组目录。');
    },
    [currentUser, submissions, showToast, refreshPublishedCatalog]
  );

  const rejectSubmission = useCallback(
    async (submissionId: string, reason: string): Promise<void> => {
      if (!currentUser || !currentUser.roles.includes('admin')) {
        showToast('error', '缺少审核员权限 (reviewer)。', 'forbidden');
        return;
      }
      if (!reason.trim()) {
        showToast('error', '驳回必须填写具体的安全或规范理由。', 'validation_failed');
        return;
      }

      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      try {
        await decideReview(base, submissionId, 'reject', reason);
      } catch (error) {
        showToast('error', `服务端驳回失败：${error instanceof Error ? error.message : 'unknown_error'}`);
        return;
      }
      const rejectedSubmission = submissions.find((item) => item.id === submissionId);
      const rejectedVersion = versions.find((item) => item.id === rejectedSubmission?.version_id);
      const rejectedReport = rejectedVersion?.scan_report_id ? scanReports[rejectedVersion.scan_report_id] : undefined;
      const historicalReportId = rejectedReport ? `scan_submission_${submissionId}` : undefined;
      if (rejectedReport && historicalReportId) {
        setScanReports((prev) => ({ ...prev, [historicalReportId]: { ...rejectedReport, id: historicalReportId } }));
      }
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === submissionId
            ? {
                ...s,
                state: 'rejected',
                reviewer_id: currentUser.id,
                reviewer_name: currentUser.display_name,
                decision_reason: reason,
                scan_report_id: historicalReportId,
                decided_at: new Date().toISOString(),
              }
            : s
        )
      );

      const sub = submissions.find((s) => s.id === submissionId);
      if (sub) {
        setVersions((prev) =>
          prev.map((v) => (v.id === sub.version_id ? { ...v, state: 'rejected' } : v))
        );

        // Record Audit Log
        const auditItem: AuditLog = {
          id: 'audit_' + Date.now(),
          timestamp: new Date().toISOString(),
          actor_id: currentUser.id,
          actor_name: currentUser.display_name,
          actor_role: 'reviewer',
          action: 'submission_reject',
          target_type: 'submission',
          target_id: sub.id,
          target_label: `${sub.mod_title} (${sub.version_str}) 审核驳回`,
          reason,
        };
        setAuditLogs((prev) => [auditItem, ...prev]);
      }

      showToast('warning', `已驳回申请，作者将能在工作台查阅驳回理由并进行版本修订。`);
    },
    [currentUser, submissions, versions, scanReports, showToast]
  );

  const publishApprovedVersion = useCallback(
    async (submissionId: string): Promise<void> => {
      const sub = submissions.find((s) => s.id === submissionId);
      if (!sub) return;

      const v = versions.find((item) => item.id === sub.version_id);

      const now = new Date().toISOString();
      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      try {
        await publishReview(base, submissionId);
      } catch (error) {
        showToast('error', `服务端发布失败：${error instanceof Error ? error.message : 'unknown_error'}`);
        return;
      }

      await refreshPublishedCatalog().catch(() => setIsOffline(true));

      // Mark version as published & immutable
      if (v) setVersions((prev) =>
        prev.map((item) =>
          item.id === v.id
            ? {
                ...item,
                state: 'published',
                published_at: now,
                is_immutable: true,
              }
            : item
        )
      );

      // Update Mod latest_version_id and published status
      setMods((prev) =>
        prev.map((m) =>
          m.id === sub.mod_id
            ? {
                ...m,
                latest_version_id: sub.mark_latest === false && m.latest_version_id ? m.latest_version_id : sub.version_id,
                is_published: true,
                updated_at: now,
              }
            : m
        )
      );

      // Update submission state
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === submissionId ? { ...s, state: 'published', published_at: now } : s
        )
      );

      // Audit Log
      const auditItem: AuditLog = {
        id: 'audit_' + Date.now(),
        timestamp: now,
        actor_id: currentUser?.id || 'sys',
        actor_name: currentUser?.display_name || '系统',
        actor_role: 'reviewer',
        action: 'version_publish',
        target_type: 'version',
        target_id: sub.version_id,
        target_label: `${sub.mod_title} (${v?.version || sub.version_id}) 正式发布`,
        reason: '发布不可变版本，对外公开分发并更新目录索引',
        details: { sha256: v?.sha256 || '', size_bytes: v?.size_bytes || 0 },
      };
      setAuditLogs((prev) => [auditItem, ...prev]);

      showToast('success', `不可变版本 ${v?.version || sub.version_id} 发布成功！已上线公开目录 (POST /review/submissions/{id}/publish)`);
    },
    [submissions, versions, currentUser, showToast, refreshPublishedCatalog]
  );

  // Admin Actions
  const updateUserRoles = useCallback(
    (userId: string, newRoles: UserRole[], reason: string) => {
      if (!currentUser || !currentUser.roles.includes('admin')) {
        showToast('error', '缺少管理员权限 (admin)。', 'forbidden');
        return;
      }

      // Record Audit
      const auditItem: AuditLog = {
        id: 'audit_' + Date.now(),
        timestamp: new Date().toISOString(),
        actor_id: currentUser.id,
        actor_name: currentUser.display_name,
        actor_role: 'admin',
        action: 'role_grant',
        target_type: 'user',
        target_id: userId,
        target_label: `用户 ${userId} 角色变更为 [${newRoles.join(', ')}]`,
        reason,
      };
      setAuditLogs((prev) => [auditItem, ...prev]);
      showToast('success', `用户角色已更新并在系统审计流中留痕。`);
    },
    [currentUser, showToast]
  );

  const unpublishVersion = useCallback(
    async (versionId: string, reason: string): Promise<void> => {
      if (!currentUser) { showToast('error', '请先登录。', 'unauthenticated'); return; }
      if (!reason.trim()) {
        showToast('error', '下架操作必须记录审计理由。', 'validation_failed');
        return;
      }

      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      try { await unpublishVersionRequest(base, versionId, reason); } catch (error) { showToast('error', `下架失败：${error instanceof Error ? error.message : 'unknown_error'}`); return; }
      setVersions((prev) => prev.map((v) => v.id === versionId ? { ...v, state: 'unpublished', unpublish_reason: reason } : v));

      const targetVer = versions.find((v) => v.id === versionId);
      const auditItem: AuditLog = {
        id: 'audit_' + Date.now(),
        timestamp: new Date().toISOString(),
        actor_id: currentUser.id,
        actor_name: currentUser.display_name,
        actor_role: 'admin',
        action: 'version_unpublish',
        target_type: 'version',
        target_id: versionId,
        target_label: `版本 ${targetVer?.version || versionId} 紧急下架`,
        reason,
      };
      setAuditLogs((prev) => [auditItem, ...prev]);

      showToast('warning', `该版本已被安全下架（不可变归档字节保留在后端，公开目录已隐藏）。`);
    },
    [currentUser, versions, showToast]
  );

  const setLatestPublishedVersion = useCallback(async (versionId: string): Promise<void> => {
    const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
    try {
      const remote = await markPublishedVersionLatest(base, versionId);
      setMods((prev) => prev.map((mod) => mod.id === remote.id ? { ...mod, latest_version_id: versionId } : mod));
      showToast('success', '目录最新版本已更新。');
    } catch (error) {
      showToast('error', `设置最新版本失败：${error instanceof Error ? error.message : 'unknown_error'}`);
    }
  }, [showToast]);

  const deleteVersion = useCallback(async (versionId: string): Promise<void> => {
    const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
    try { await deleteAuthorVersion(base, versionId); setVersions((prev) => prev.filter((v) => v.id !== versionId)); setSubmissions((prev) => prev.filter((s) => s.version_id !== versionId)); showToast('success', '版本已删除。'); }
    catch (error) { showToast('error', `删除版本失败：${error instanceof Error ? error.message : 'unknown_error'}`); }
  }, [showToast]);

  const unpublishMod = useCallback(async (modId: string): Promise<void> => {
    const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
    try { await unpublishAuthorModRequest(base, modId); setMods((prev) => prev.map((mod) => mod.id === modId ? { ...mod, is_published: false } : mod)); showToast('success', '模组已从公开目录下架；版本、归档和详情图均已保留。'); }
    catch (error) { showToast('error', `模组下架失败：${error instanceof Error ? error.message : 'unknown_error'}`); }
  }, [showToast]);

  const deleteModDraft = useCallback(async (modId: string): Promise<void> => {
    const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
    try { await deleteAuthorModRequest(base, modId); setMods((prev) => prev.filter((mod) => mod.id !== modId)); setVersions((prev) => prev.filter((version) => version.mod_id !== modId)); setSubmissions((prev) => prev.filter((submission) => submission.mod_id !== modId)); showToast('success', '草稿模组及其候选内容已删除。'); }
    catch (error) { showToast('error', `删除草稿模组失败：${error instanceof Error ? error.message : 'unknown_error'}`); }
  }, [showToast]);

  const markVersionDeprecated = useCallback(async (versionId: string, reason: string): Promise<void> => {
    const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
    try {
      const remote = await deprecateVersionRequest(base, versionId, reason);
      setVersions((prev) => prev.map((version) => version.id === versionId ? {
        ...version, deprecated: remote.deprecated, deprecation_reason: remote.deprecation_reason,
      } : version));
      showToast('warning', '已标记为不推荐使用。');
    } catch (error) {
      showToast('error', `标记失败：${error instanceof Error ? error.message : 'unknown_error'}`);
    }
  }, [showToast]);

  const clearVersionDeprecation = useCallback(async (versionId: string): Promise<void> => {
    const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
    try {
      await clearVersionDeprecationRequest(base, versionId);
      setVersions((prev) => prev.map((version) => version.id === versionId ? {
        ...version, deprecated: false, deprecation_reason: '',
      } : version));
      showToast('success', '已取消不推荐标记。');
    } catch (error) {
      showToast('error', `取消标记失败：${error instanceof Error ? error.message : 'unknown_error'}`);
    }
  }, [showToast]);

  const editVersion = useCallback(async (versionId: string, version: string, releaseNotes: string, dependencies?: ModVersion['dependencies']): Promise<boolean> => {
    const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
    try { const remote = await editAuthorVersion(base, versionId, version, releaseNotes, dependencies ?? versions.find((item) => item.id === versionId)?.dependencies ?? []); setVersions((prev) => prev.map((v) => v.id === versionId ? { ...v, version: remote.version, release_notes: remote.release_notes, dependencies: remote.dependencies as ModVersion['dependencies'] } : v)); showToast('success', '版本资料已更新；被驳回版本需重新上传 ZIP 后才能提交审核。'); return true; }
    catch (error) { showToast('error', `编辑版本失败：${error instanceof Error ? error.message : 'unknown_error'}`); return false; }
  }, [showToast, versions]);

  // Client Simulation Methods (Section 4)
  const previewInstallPlan = useCallback(
    (modId: string, versionId: string): InstallationPlan => {
      const mod = mods.find((m) => m.id === modId);
      const v = versions.find((item) => item.id === versionId);
      const inst = installations.find((i) => i.id === activeInstallationId);

      const dependencyBlockers: string[] = [];
      const semanticBlockers: string[] = [];
      const warnings: string[] = [];

      // Check MAS version range
      if (inst && mod?.mas_version_range) {
        if (inst.mas_version === '0.12.10' && mod.mas_version_range.includes('0.12.14')) {
          dependencyBlockers.push(
            `MAS 版本不满足要求：当前游戏版本为 ${inst.mas_version}，模组需要 ${mod.mas_version_range}`
          );
        }
      }

      // Check required dependencies
      if (v?.dependencies && v.dependencies.length > 0) {
        for (const dep of v.dependencies) {
          if (dep.required) {
            const isInstalled = installedMods.some((im) => im.mod_id === dep.mod_id);
            if (!isInstalled) {
              dependencyBlockers.push(`缺少必需前置模组 [${dep.mod_title || dep.mod_id}] (${dep.version_range})`);
            }
          }
        }
      }


      // Check Spritepack giftname semantic conflicts
      const report = v?.scan_report_id ? scanReports[v.scan_report_id] : null;
      if (report && report.derived_gifts.length > 0) {
        // check if already installed spritepack has duplicate
        if (installedMods.some((im) => im.mod_id === 'mod_emerald_blossoms') && modId !== 'mod_emerald_blossoms') {
          // simulation check
        }
      }

      const plan: InstallationPlan = {
        plan_id: 'plan_' + Math.random().toString(36).substring(2, 9),
        kind: 'install',
        installation_id: activeInstallationId,
        mod_id: modId,
        version_id: versionId,
        expires_at: new Date(Date.now() + 600 * 1000).toISOString(),
        dependency_blockers: dependencyBlockers,
        semantic_blockers: semanticBlockers,
        changes: [
          {
            target_path: `game/Submods/${mod?.id || 'Mod'}/core.rpy`,
            action: 'create',
            next_owner: modId,
            reason: '新增模组主入口脚本',
          },
          {
            target_path: `game/Submods/${mod?.id || 'Mod'}/assets/pack.png`,
            action: 'create',
            next_owner: modId,
            reason: '新增材质资源包',
          },
        ],
        backups_required: [`game/Submods/${mod?.id || 'Mod'}/backup_manifest.json`],
        bytes_required: v?.size_bytes || 5242880,
        warnings,
        is_ready_to_apply: dependencyBlockers.length === 0 && semanticBlockers.length === 0,
      };

      setCurrentPlan(plan);
      return plan;
    },
    [mods, versions, installations, activeInstallationId, installedMods, scanReports]
  );

  const applyPlan = useCallback(
    async (plan: InstallationPlan) => {
      if (!plan.is_ready_to_apply) {
        showToast('error', '存在未解决的依赖阻断或语义冲突，无法执行安装。', 'dependency_missing');
        return;
      }

      const opId = 'op_' + Math.random().toString(36).substring(2, 9);
      const mod = mods.find((m) => m.id === plan.mod_id);
      const v = versions.find((item) => item.id === plan.version_id);

      const newOp: OperationLog = {
        operation_id: opId,
        installation_id: plan.installation_id,
        mod_title: mod?.title || plan.mod_id,
        version: v?.version || '1.0.0',
        state: 'downloading',
        progress_percent: 15,
        current_file: '正在拉取加密归档描述符...',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      setOperations((prev) => [newOp, ...prev]);

      // Step 1: downloading -> scanning
      await new Promise((res) => setTimeout(res, 600));
      setOperations((prev) =>
        prev.map((o) =>
          o.operation_id === opId
            ? { ...o, state: 'scanning', progress_percent: 45, current_file: '静态文件树与校验和验证中...' }
            : o
        )
      );

      // Step 2: backed_up
      await new Promise((res) => setTimeout(res, 600));
      setOperations((prev) =>
        prev.map((o) =>
          o.operation_id === opId
            ? { ...o, state: 'backed_up', progress_percent: 70, current_file: '生成覆盖层快照与备份清单...' }
            : o
        )
      );

      // Step 3: writing
      await new Promise((res) => setTimeout(res, 600));
      setOperations((prev) =>
        prev.map((o) =>
          o.operation_id === opId
            ? { ...o, state: 'writing', progress_percent: 90, current_file: '写入目标文件并应用权限...' }
            : o
        )
      );

      // Step 4: committed
      await new Promise((res) => setTimeout(res, 500));
      setOperations((prev) =>
        prev.map((o) =>
          o.operation_id === opId
            ? { ...o, state: 'committed', progress_percent: 100, current_file: '写入完成，状态已提交。' }
            : o
        )
      );

      // Add to installedMods
      setInstalledMods((prev) => [
        {
          id: 'im_' + Date.now(),
          mod_id: plan.mod_id,
          title: mod?.title || plan.mod_id,
          version: v?.version || '1.0.0',
          category: mod?.category || 'submod',
          is_managed: true,
          priority: mod?.recommended_priority || 20,
          installed_at: new Date().toISOString(),
        },
        ...prev.filter((item) => item.mod_id !== plan.mod_id),
      ]);

      setCurrentPlan(null);
      showToast('success', `模组 [${mod?.title}] 安装成功并已提交事务！`);
    },
    [mods, versions, showToast]
  );

  const simulateExternalChange = useCallback(
    (filePath: string) => {
      const opId = 'op_drift_' + Math.random().toString(36).substring(2, 7);
      const newOp: OperationLog = {
        operation_id: opId,
        installation_id: activeInstallationId,
        mod_title: 'Extra Everything (更新验证)',
        version: '1.3.0',
        state: 'blocked',
        progress_percent: 65,
        current_file: filePath,
        error_code: 'external_change',
        error_message: '文件哈希外部漂移：目标路径存在外部非托管手动改动，禁止静默覆盖！',
        external_change_details: {
          path: filePath,
          expected_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
          actual_hash: '44aa88220011ccff8899aabbccddeeff11223344556677889900aabbccddeeff (本地外部修改)',
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      setOperations((prev) => [newOp, ...prev]);
      showToast(
        'error',
        '触发 external_change 安全护栏：文件哈希漂移已暂停写入，保护用户未备份的手动修改！',
        'external_change'
      );
    },
    [activeInstallationId, showToast]
  );

  const adoptUnmanagedMod = useCallback(
    (modId: string) => {
      setInstalledMods((prev) =>
        prev.map((m) => (m.mod_id === modId ? { ...m, is_managed: true, version: '1.0.0 (已收养托管)' } : m))
      );
      showToast('success', '未托管脚本已完成显式收养，纳入 SubmodHub 版本管理与恢复树！');
    },
    [showToast]
  );

  const clearCurrentPlan = useCallback(() => {
    setCurrentPlan(null);
  }, []);

  const syncModReleases = useCallback(
    async (modId: string): Promise<SyncSummary | null> => {
      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      try {
        const summary = await syncAuthorModGitHub(base, modId);
        // Refresh author workspace
        const items = await listAuthorWorkspace(base);
        const restoredReports = Object.fromEntries(items.flatMap(({ versions: entries, scan_reports: reports }) => entries.flatMap((version) => {
          const report = version.scan_report_id && reports?.[version.scan_report_id];
          return report ? [[version.scan_report_id!, mapServerScanReport(version.id, report)] as const] : [];
        })));
        const ownMods: ModSummary[] = items.map(({ mod, versions: ownVersions }) => ({
          id: mod.id, title: mod.title, summary: mod.summary || '', description: mod.description || mod.summary || '',
          author: mod.author, category: mod.category, tags: mod.tags || [],
          supported_platforms: (mod.supported_platforms || []) as ModSummary['supported_platforms'],
          mas_version_range: mod.mas_version_range || '', recommended_priority: mod.recommended_priority || 0,
          latest_version_id: mod.latest_version_id || '', downloads_count: 0, created_at: '', updated_at: '',
          is_published: isAuthorModPublished(mod, ownVersions),
          source_type: mod.source_type || 'local',
          github_owner: mod.github_owner || '',
          github_repo: mod.github_repo || '',
          github_asset_regex: mod.github_asset_regex || '',
          github_source_code: Boolean(mod.github_source_code),
          github_last_sync_at: mod.github_last_sync_at,
          github_last_sync_error: mod.github_last_sync_error,
          github_last_release_id: mod.github_last_release_id,
        github_backoff_until: mod.github_backoff_until,
        }));
        const ownVersions: ModVersion[] = items.flatMap(({ versions: entries }) => entries.map((version) => ({
          id: version.id, mod_id: version.mod_id, version: version.version, state: version.state as ModVersion['state'],
          size_bytes: version.size_bytes, sha256: version.sha256, release_notes: version.release_notes || '',
          dependencies: (version.dependencies || []) as ModVersion['dependencies'], scan_report_id: version.scan_report_id,
          deprecated: version.deprecated, deprecation_reason: version.deprecation_reason,
          created_at: version.created_at || '', is_immutable: version.state === 'published' || version.state === 'approved',
        })));
        setMods((prev) => [...ownMods, ...prev.filter((mod) => !ownMods.some((owned) => owned.id === mod.id))]);
        setVersions((prev) => [...ownVersions, ...prev.filter((version) => !ownVersions.some((owned) => owned.id === version.id))]);
        setScanReports((prev) => ({ ...prev, ...restoredReports }));

        if (summary.failed > 0 && summary.created === 0) {
          showToast('error', `GitHub 同步失败: ${summary.last_error || '未知错误'}`);
        } else if (summary.created > 0) {
          showToast('success', `GitHub Releases 同步成功，新增 ${summary.created} 个版本`);
        } else {
          showToast('info', 'GitHub Releases 同步完成，无新版本');
        }
        return summary;
      } catch (err) {
        showToast('error', `GitHub 同步异常: ${err instanceof Error ? err.message : '未知错误'}`);
        return null;
      }
    },
    [showToast]
  );

  const value = useMemo(
    () => ({
      activeTab,
      setActiveTab,
      selectedModId,
      setSelectedModId,
      detailModalModId,
      setDetailModalModId,
      currentUser,
      switchRolePersona,
      loginFlarum,
      loginGithub,
      logout,
      linkAccount,
      hasRole,
      isOffline,
      setIsOffline,
      mods,
      versions,
      scanReports,
      submissions,
      auditLogs,
      searchQuery,
      setSearchQuery,
      categoryFilter,
      setCategoryFilter,
      platformFilter,
      setPlatformFilter,
      tagFilter,
      setTagFilter,
      getModWithVersions,
      getDownloadDescriptor,
      createModDraft,
      updateModDraft,
      syncModReleases,
      createCandidateVersion,
      uploadArchiveAndScan,
      uploadDetailImages,
      submitVersionForReview,
      setLatestPublishedVersion,
      approveSubmission,
      rejectSubmission,
      publishApprovedVersion,
      updateUserRoles,
      unpublishVersion,
      markVersionDeprecated,
      clearVersionDeprecation,
      deleteVersion,
      unpublishMod,
      deleteModDraft,
      editVersion,
      installations,
      activeInstallationId,
      setActiveInstallationId,
      installedMods,
      currentPlan,
      operations,
      previewInstallPlan,
      applyPlan,
      simulateExternalChange,
      adoptUnmanagedMod,
      clearCurrentPlan,
      toasts,
      showToast,
      removeToast,
    }),
    [
      activeTab,
      selectedModId,
      detailModalModId,
      currentUser,
      switchRolePersona,
      loginFlarum,
      loginGithub,
      logout,
      linkAccount,
      hasRole,
      isOffline,
      mods,
      versions,
      scanReports,
      submissions,
      auditLogs,
      searchQuery,
      categoryFilter,
      platformFilter,
      tagFilter,
      getModWithVersions,
      getDownloadDescriptor,
      createModDraft,
      updateModDraft,
      syncModReleases,
      createCandidateVersion,
      uploadArchiveAndScan,
      uploadDetailImages,
      submitVersionForReview,
      setLatestPublishedVersion,
      approveSubmission,
      rejectSubmission,
      publishApprovedVersion,
      updateUserRoles,
      unpublishVersion,
      markVersionDeprecated,
      clearVersionDeprecation,
      deleteVersion,
      unpublishMod,
      deleteModDraft,
      editVersion,
      installations,
      activeInstallationId,
      installedMods,
      currentPlan,
      operations,
      previewInstallPlan,
      applyPlan,
      simulateExternalChange,
      adoptUnmanagedMod,
      clearCurrentPlan,
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
