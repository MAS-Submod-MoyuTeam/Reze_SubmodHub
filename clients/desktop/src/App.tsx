import React, { useEffect, useRef, useState } from 'react';
import { mapPlanPreview } from './planPreview';
import { loadInstalledFiles } from './installedFiles';
import { resolveHasUpdate, summarizeIntegrity } from './modHealth';
import type { IntegrityTotals } from './modHealth';
import { PreviewRepair, fetchRegistrationMatches } from './wails';
import { isAllowedNavTab } from './priorityLayers';
import { TitleBar } from './components/TitleBar';
import { Sidebar, ActiveTab } from './components/Sidebar';
import { CatalogView } from './components/CatalogView';
import { ModDetailModal } from './components/ModDetailModal';
import { PlanPreviewModal } from './components/PlanPreviewModal';
import { InstalledView } from './components/InstalledView';
import { PriorityLayersView } from './components/PriorityLayersView';
import { OperationsView } from './components/OperationsView';
import { InstancesView } from './components/InstancesView';
import { AdoptModal } from './components/AdoptModal';
import { FileInspectModal } from './components/FileInspectModal';
import { AppUpdateModal } from './components/AppUpdateModal';
import { ExecutionProgressBar } from './components/ExecutionProgressBar';
import { ExecutionCoordinator } from './executionCoordinator';
import { StorageAccessBanner } from './components/StorageAccessBanner';
import { MobileNavBar } from './components/MobileNavBar';
import {
  isInstanceAuthorized,
  reconcileInstanceState,
  subscribeStorageStateChanged,
  type InstanceSyncReason,
} from './storagePermissionSync';
import { fetchPublishedCatalog, fetchVerifiedArchive, type DownloadProgress } from '../../../ui/catalog-api';
import { AddMASInstance, StageArchive, GetStageProgress, CancelStage, ReleaseArchive, PreviewArchive, PreviewAdopt, PreviewUninstall, ExecutePlan, BrowseMASDirectory, ListMASInstances, ListInstalledArchives, ListInstalledModFiles, RemoveMASInstance, LaunchMASInstance, ScanLocalSubmods, ScanInstalledSpritepacks, CreateSpriteGift, DeleteSpritepack, SelectMASInstance, SetMASRoot, ListOperations, GetOperation, RollbackOperation, normalizeSpriteSetIDs, LocalSubmod, MASInstancesState, Spritepack, InstalledArchive, GetAndroidStorageAccess, RequestAndroidStorageAccess, ConfirmAppUpdateStartup, CheckForAppUpdate, DownloadAppUpdate, CancelAppUpdate, GetAppUpdateStatus, InstallAppUpdate, OpenAppUpdateSettings, isAndroid } from './wails';
import { createInstalledLoadCoordinator, LoadingStatus } from './installedLoading';
import { getPlanActionText, resolveModInstallationId, describeExecutionError } from './planExecution';
import {
  Installation,
  ModSummary,
  InstalledItem,
  Operation,
  Plan,
  PlanChange,
  ExecutionSession,
  SpriteSelectionPlanContext,
  AppUpdateState,
} from './types/client';

const UNVERIFIED_INSTALLATION: Installation = {
  id: 'unverified',
  label: '尚未连接 MAS',
  platform: 'windows',
  path_hint: '',
  permission_state: 'pending',
  mas_version: '',
  is_valid: false,
  is_running: false,
  disk_available_bytes: null,
  disk_total_bytes: null,
  last_validated_at: '',
};

/**
 * 真实 MAS 进程检测尚未接入。安装/应用计划依赖这个值做写操作锁，
 * 具名保留而不是内联 `false`，这样守卫在源码里始终是「活」的，
 * 检测落地时只需换成原生层推送的状态，调用点无需改动。
 */
const MAS_GAME_PROCESS_DETECTED = false;

/** 提示分的只有两种语气：普通结果与需要用户注意的坏消息。 */
type ToastTone = 'info' | 'warn';

export default function App() {
  // Installations
  const [installations, setInstallations] = useState<Installation[]>([UNVERIFIED_INSTALLATION]);
  const [activeInstallationId, setActiveInstallationId] = useState<string>('unverified');
  const activeInstallationIdRef = useRef(activeInstallationId);
  activeInstallationIdRef.current = activeInstallationId;

  // Navigation
  const [activeTab, setActiveTab] = useState<ActiveTab>('catalog');

  // Catalog and Installed Data
  const [catalogMods, setCatalogMods] = useState<ModSummary[]>([]);
  const catalogModsRef = useRef<ModSummary[]>([]);
  const [installedMods, setInstalledMods] = useState<InstalledItem[]>([]);
  const [spritepacks, setSpritepacks] = useState<Spritepack[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);

  // Execution session coordinator
  const [executionSession, setExecutionSession] = useState<ExecutionSession | null>(null);
  const executionCoordinatorRef = useRef<ExecutionCoordinator | null>(null);
  if (!executionCoordinatorRef.current) {
    executionCoordinatorRef.current = new ExecutionCoordinator({
      activeInstanceId: () => activeInstallationIdRef.current,
      onSessionChange: (session) => setExecutionSession(session),
      onOperationsChange: (updater) => setOperations(updater),
      getOperation: (opId) => GetOperation(opId),
    });
  }

  useEffect(() => {
    return () => {
      executionCoordinatorRef.current?.stopPolling();
    };
  }, []);

  // Installed scan loading state
  const loadCoordinatorRef = useRef(createInstalledLoadCoordinator());
  const operationsRequestIdRef = useRef(0);
  // 事务列表读取失败要可见，但轮询/切换实例会重复触发，只提示一次直到下一次成功。
  const operationsErrorShownRef = useRef(false);
  const [modsLoadingStatus, setModsLoadingStatus] = useState<LoadingStatus>('idle');
  const [modsError, setModsError] = useState<string | null>(null);
  const [isModsInitialLoading, setIsModsInitialLoading] = useState(false);
  const [isModsRefreshing, setIsModsRefreshing] = useState(false);

  const [spritepacksLoadingStatus, setSpritepacksLoadingStatus] = useState<LoadingStatus>('idle');
  const [spritepacksError, setSpritepacksError] = useState<string | null>(null);
  const [isSpritepacksInitialLoading, setIsSpritepacksInitialLoading] = useState(false);
  const [isSpritepacksRefreshing, setIsSpritepacksRefreshing] = useState(false);

  const updateCoordinatorUIState = () => {
    const coordinator = loadCoordinatorRef.current;
    setModsLoadingStatus(coordinator.getModsStatus());
    setModsError(coordinator.getModsError());
    setIsModsInitialLoading(coordinator.isModsInitialLoading());
    setIsModsRefreshing(coordinator.isModsRefreshing());

    setSpritepacksLoadingStatus(coordinator.getSpritepacksStatus());
    setSpritepacksError(coordinator.getSpritepacksError());
    setIsSpritepacksInitialLoading(coordinator.isSpritepacksInitialLoading());
    setIsSpritepacksRefreshing(coordinator.isSpritepacksRefreshing());
  };

  // App auto-update state
  const [isAppUpdateOpen, setIsAppUpdateOpen] = useState(false);
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateState>({
    status: 'idle',
    current_version: __APP_VERSION__,
    download_progress: 0,
    downloaded_bytes: 0,
    total_bytes: 0,
    can_install: false,
    requires_user_action: false,
    requires_install_permission: false,
  });
  const appUpdateRequestRef = useRef(0);
  const appUpdatePollRef = useRef(false);
  const appUpdateStartupRef = useRef(false);
  const appUpdateInstallRef = useRef(false);

  const pollAppUpdate = async () => {
    if (appUpdatePollRef.current || appUpdateInstallRef.current) return;
    appUpdatePollRef.current = true;
    const request = appUpdateRequestRef.current;
    try {
      const state = await GetAppUpdateStatus();
      if (state && request === appUpdateRequestRef.current) {
        setAppUpdateState((prev) => ({ ...prev, error: undefined, ...state }));
      }
    } catch {
      // Keep the last known state; the next poll or foreground event retries.
    } finally {
      appUpdatePollRef.current = false;
    }
  };

  useEffect(() => {
    if (!['downloading', 'verifying', 'awaiting_user'].includes(appUpdateState.status)) return;
    const timer = setInterval(pollAppUpdate, 500);
    return () => clearInterval(timer);
  }, [appUpdateState.status]);

  useEffect(() => {
    const onFocus = () => { void pollAppUpdate(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void pollAppUpdate();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (isAppUpdateOpen) void pollAppUpdate();
  }, [isAppUpdateOpen]);

  const handleCheckAppUpdate = async () => {
    const request = ++appUpdateRequestRef.current;
    setAppUpdateState((prev) => ({ ...prev, status: 'checking', error: undefined }));
    try {
      const state = await CheckForAppUpdate();
      if (request !== appUpdateRequestRef.current) return;
      ++appUpdateRequestRef.current;
      setAppUpdateState((prev) => ({ ...prev, error: undefined, ...state }));
    } catch (err: any) {
      if (request !== appUpdateRequestRef.current) return;
      ++appUpdateRequestRef.current;
      setAppUpdateState((prev) => ({
        ...prev,
        status: 'failed',
        error: err?.message || '检查更新失败',
      }));
    }
  };

  const handleDownloadAppUpdate = async () => {
    const request = ++appUpdateRequestRef.current;
    // Immediately show downloading state to prevent UI freeze/race
    setAppUpdateState((prev) => ({ ...prev, status: 'downloading', error: undefined }));
    try {
      const state = await DownloadAppUpdate();
      if (request !== appUpdateRequestRef.current) return;
      ++appUpdateRequestRef.current;
      setAppUpdateState((prev) => ({ ...prev, error: undefined, ...state }));
      // Ensure immediate status poll
      void pollAppUpdate();
    } catch (err: any) {
      if (request !== appUpdateRequestRef.current) return;
      ++appUpdateRequestRef.current;
      setAppUpdateState((prev) => ({
        ...prev,
        status: 'failed',
        error: err?.message || '启动下载失败',
      }));
    }
  };

  const handleCancelAppUpdate = async () => {
    const request = ++appUpdateRequestRef.current;
    try {
      const state = await CancelAppUpdate();
      if (request !== appUpdateRequestRef.current) return;
      ++appUpdateRequestRef.current;
      setAppUpdateState((prev) => ({ ...prev, error: undefined, ...state }));
    } catch {
      if (request !== appUpdateRequestRef.current) return;
      ++appUpdateRequestRef.current;
      // Reconcile with the backend if the cancellation response was lost.
      void pollAppUpdate();
    }
  };

  const handleInstallAppUpdate = async () => {
    if (appUpdateInstallRef.current || appUpdateState.status !== 'ready') return;
    appUpdateInstallRef.current = true;
    ++appUpdateRequestRef.current;
    setAppUpdateState((prev) => ({ ...prev, status: 'installing', error: undefined }));
    try {
      const state = await InstallAppUpdate();
      setAppUpdateState((prev) => ({ ...prev, error: undefined, ...state }));
    } catch (err: any) {
      // The backend releases its claim on failure and remains authoritative.
      try {
        const state = await GetAppUpdateStatus();
        setAppUpdateState((prev) => ({ ...prev, ...state, error: err?.message || '安装更新失败' }));
      } catch {
        setAppUpdateState((prev) => ({ ...prev, status: 'ready', error: err?.message || '安装更新失败，请重试' }));
      }
    } finally {
      appUpdateInstallRef.current = false;
    }
  };

  const handleOpenAppUpdateSettings = async () => {
    try {
      await OpenAppUpdateSettings();
    } catch {
      // Ignore
    }
  };

  // States & Scenario Simulation
  const isAndroidDevice = isAndroid();
  const [storageState, setStorageState] = useState<'granted' | 'denied' | 'unsupported' | 'error' | string>('pending');
  const [isStorageRefreshing, setIsStorageRefreshing] = useState(false);

  const checkStoragePermission = async () => {
    if (!isAndroidDevice) return;
    setIsStorageRefreshing(true);
    try {
      const res = await GetAndroidStorageAccess();
      setStorageState(res.state);
      const state = await ListMASInstances();
      refreshInstanceState(state as MASInstancesState);
    } catch {
      setStorageState('error');
      try {
        const state = await ListMASInstances();
        refreshInstanceState(state as MASInstancesState);
      } catch {
        // ignore
      }
    } finally {
      setIsStorageRefreshing(false);
    }
  };

  const handleRequestStorageAccess = async () => {
    try {
      const res = await RequestAndroidStorageAccess();
      if (!res.opened) {
        showToast('打开系统设置页失败，请手动在应用管理中授予文件权限');
      }
    } catch (e) {
      showToast(`打开设置页失败：${String(e)}`);
    }
  };

  useEffect(() => {
    if (isAndroidDevice) {
      void checkStoragePermission();
      const onFocus = () => { void checkStoragePermission(); };
      window.addEventListener('focus', onFocus);
      const unsubscribeStorage = subscribeStorageStateChanged(() => {
        void checkStoragePermission();
      });
      return () => {
        window.removeEventListener('focus', onFocus);
        unsubscribeStorage();
      };
    }
  }, [isAndroidDevice]);

  // MAS 进程检测尚未接入，这里恒为 false；显式标注 boolean，避免守卫被当成字面量死代码。
  const isGameRunning: boolean = MAS_GAME_PROCESS_DETECTED;
  // 这个标志唯一的含义是「目录请求在飞」，首屏也归它管：挂载 effect 的第一件事就是发请求，
  // 所以初值必须是 true，否则第一帧会在真实目录到达前先摆出「未找到符合条件的模组」这句结论。
  const [isRefreshing, setIsRefreshing] = useState<boolean>(true);
  // 目录失败必须可见：没有离线快照，失败要显示页面级失败态，不能退化成「空目录」。
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [isDownloadingArchive, setIsDownloadingArchive] = useState(false);
  const [archiveProgress, setArchiveProgress] = useState<DownloadProgress | null>(null);
  const [transferTitle, setTransferTitle] = useState<string | null>(null);
  const [installStage, setInstallStage] = useState<'preparing' | 'installing' | null>(null);
  const installingRef = useRef(false);
  const [installingModId, setInstallingModId] = useState<string | null>(null);
  const [isLaunchingGame, setIsLaunchingGame] = useState(false);

  // Modals
  const [selectedModDetail, setSelectedModDetail] = useState<ModSummary | null>(null);
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [adoptTarget, setAdoptTarget] = useState<InstalledItem | null>(null);
  const [inspectTarget, setInspectTarget] = useState<InstalledItem | null>(null);

  // Toast / System notice
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = (message: string, tone: ToastTone = 'info') => {
    setToast({ message, tone });
    // 新提示必须完整显示，不能被上一条的计时器提前清掉。
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3500);
  };

  /**
   * 拉取公开目录。返回本次真实拿到的目录（失败返回 null），
   * 并在拿到结果的同一刻同步 `catalogModsRef`——否则后续「刷新后立即比对」会用到旧目录，
   * 因为 ref 原本只在下一次渲染的 effect 里才更新。
   */
  const loadCatalog = async (): Promise<ModSummary[] | null> => {
    setIsRefreshing(true);
    setCatalogError(null);
    try {
      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      const entries = await fetchPublishedCatalog(base);
      const mapped: ModSummary[] = entries.map(({ mod, version }) => ({
        id: mod.id, title: mod.title, summary: mod.summary || '', description: mod.description || mod.summary || '',
        author: mod.author || { id: '', display_name: '未知作者' },
        category: mod.category || 'submod', tags: mod.tags || [],
        supported_platforms: mod.supported_platforms || [], mas_version_range: mod.mas_version_range || '',
        recommended_priority: mod.recommended_priority || 0, latest_version_id: version.id,
        latest_version: version.version, size_bytes: version.size_bytes, sha256: version.sha256,
        updated_at: '', downloads_count: mod.downloads_count || 0,
      }));
      catalogModsRef.current = mapped;
      setCatalogMods(mapped);
      return mapped;
    } catch (error) {
      // 保留上一次成功的数据，同时把失败暴露出来（页面级失败态 + 提示）。
      const detail = error instanceof Error ? error.message : 'unknown_error';
      setCatalogError(detail);
      showToast(`目录加载失败：${detail}`, 'warn');
      return null;
    } finally {
      setIsRefreshing(false);
    }
  };

  const scanLocalSubmods = async (targetInstanceId?: string, options?: { forced?: boolean }): Promise<InstalledItem[] | null> => {
    const instId = targetInstanceId || activeInstallationIdRef.current;
    if (!instId || instId === 'unverified') return null;
    if (instId !== activeInstallationIdRef.current) return null;
    const token = await loadCoordinatorRef.current.waitForModsScan(instId, options);
    if (!token) return null;
    updateCoordinatorUIState();

    try {
      const [local, receipts] = await Promise.all([ScanLocalSubmods(), ListInstalledArchives()]) as [LocalSubmod[], InstalledArchive[]];
      if (activeInstallationIdRef.current !== instId) return null;
      const managedDirs = new Set(receipts.flatMap((receipt) => receipt.submod_dirs || []).map((dir) => dir.toLowerCase()));
      const catalog = catalogModsRef.current.length > 0 ? catalogModsRef.current : catalogMods;
      const catalogMap = new Map(catalog.map((item) => [item.id, item]));
      const managed: InstalledItem[] = receipts.map((receipt) => {
        const catMod = catalogMap.get(receipt.mod_id);
        const authorName = receipt.author || catMod?.author?.display_name || '未知作者';
        return {
          mod_id: receipt.mod_id, installation_id: receipt.operation_id || receipt.mod_id, title: receipt.title, summary: '已通过 RezeHub 安装',
          author_name: authorName, category: (receipt.category as any) || catMod?.category || 'submod', installed_version: receipt.version,
          installed_version_id: receipt.version_id, latest_version: catMod?.latest_version || receipt.version,
          latest_version_id: catMod?.latest_version_id || receipt.version_id,
          // 更新标记只能来自「本地已装版本 vs 目录最新版本」的真实比较，不能写死也不能臆断。
          has_update: resolveHasUpdate({
            installedVersionId: receipt.version_id,
            installedVersion: receipt.version,
            latestVersionId: catMod?.latest_version_id,
            latestVersion: catMod?.latest_version,
          }),
          priority: receipt.priority ?? 0,
          is_managed: true, files_count: receipt.files, size_bytes: receipt.size_bytes,
          installed_at: receipt.installed_at ? new Date(receipt.installed_at).toISOString() : new Date().toISOString(), sha256: receipt.sha256,
          integrity_status: 'unknown', managed_operation_id: receipt.operation_id,
          sprite_set_ids: receipt.sprite_set_ids,
          sprite_selection_hash: receipt.sprite_selection_hash,
          selected_sprite_set_count: receipt.selected_sprite_set_count,
        };
      });
      // Do not filter out unmanaged items by directory name; the backend already excludes managed files individually.
      const unmanaged: InstalledItem[] = local.map((item) => ({
        mod_id: `local:${item.directory || item.id || 'scattered'}`,
        title: item.name || item.directory || '散落脚本项',
        summary: '检测到 MAS 本地子模组，尚未与 RezeHub 安装记录关联。',
        author_name: item.author || '未知作者 (本地检测)', category: 'submod',
        installed_version: item.version || '未声明', installed_version_id: '',
        latest_version: '未托管', latest_version_id: '', has_update: false,
        priority: 0, is_managed: false, files_count: (item.files || []).length,
        size_bytes: (item.files || []).reduce((sum, file) => sum + file.size, 0),
        installed_at: new Date().toISOString(), sha256: item.files?.[0]?.sha256 || '',
        unmanaged_paths: (item.files || []).map((file) => file.path),
        submod_dir_name: item.directory,
        scan_item_id: item.id || item.directory,
        registrations: item.registrations || [],
        warnings: item.warnings,
        incomplete: item.incomplete,
        integrity_status: 'unknown',
      }));

      // Try matching unmanaged registrations with store
      const distinctNames = Array.from(new Set(
        unmanaged.flatMap(u => (u.registrations || []).filter(r => !r.unknown && r.name).map(r => r.name))
      ));
      if (distinctNames.length > 0) {
        try {
          const apiBase = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
          const resp = await fetchRegistrationMatches(distinctNames, apiBase);
          if (resp.ok) {
            const data = await resp.json();
            const matchMap = new Map<string, { status: 'matched' | 'ambiguous' | 'no_match'; candidates: any[] }>();
            for (const res of data.results || []) {
              matchMap.set(res.name, res);
            }
            for (const u of unmanaged) {
              const allRegs = u.registrations || [];
              const validRegs = allRegs.filter(r => !r.unknown && r.name);
              const hasUnknownReg = allRegs.some(r => r.unknown);
              const distinctRegNames = Array.from(new Set(validRegs.map(r => r.name)));

              // If scan was incomplete or there are unknown registrations or multiple distinct registration names in the item,
              // it cannot be automatically treated as a single clear match.
              if (u.incomplete || hasUnknownReg || distinctRegNames.length !== 1) {
                // Collect candidates across all registrations for user advisory review, but mark as ambiguous or no_match
                const combinedCandidates: any[] = [];
                const seenCandidateIds = new Set<string>();
                for (const reg of validRegs) {
                  const match = matchMap.get(reg.name);
                  if (match && match.candidates) {
                    for (const cand of match.candidates) {
                      if (!seenCandidateIds.has(cand.mod_id)) {
                        seenCandidateIds.add(cand.mod_id);
                        combinedCandidates.push(cand);
                      }
                    }
                  }
                }
                if (combinedCandidates.length > 0) {
                  u.match_status = 'ambiguous';
                  u.match_candidates = combinedCandidates;
                } else {
                  u.match_status = 'no_match';
                  u.match_candidates = [];
                }
              } else {
                // Exactly 1 distinct known registration name without unknowns/incomplete
                const match = matchMap.get(distinctRegNames[0]);
                if (match) {
                  u.match_status = match.status;
                  u.match_candidates = match.candidates;
                }
              }
            }
          }
        } catch {
          // Store match is advisory and non-blocking
        }
      }

      const combined = [...managed, ...unmanaged];
      if (!loadCoordinatorRef.current.completeModsScan(token, combined)) return null;
      setInstalledMods(combined);
      return combined;
    } catch (error) {
      if (activeInstallationIdRef.current !== instId) return null;
      const msg = error instanceof Error ? error.message : String(error);
      if (loadCoordinatorRef.current.failModsScan(token, msg)) {
        showToast(`本地子模组扫描失败：${msg}`, 'warn');
      }
      return null;
    } finally {
      updateCoordinatorUIState();
    }
  };

  const refreshSpritepacks = async (targetInstanceId?: string, options?: { forced?: boolean }) => {
    const instId = targetInstanceId || activeInstallationIdRef.current;
    if (!instId || instId === 'unverified') return;
    if (instId !== activeInstallationIdRef.current) return;
    const token = await loadCoordinatorRef.current.waitForSpritepacksScan(instId, options);
    if (!token) return;
    updateCoordinatorUIState();

    try {
      const items = (await ScanInstalledSpritepacks()) as Spritepack[];
      if (activeInstallationIdRef.current !== instId) return;
      if (loadCoordinatorRef.current.completeSpritepacksScan(token, items)) {
        setSpritepacks(items || []);
      }
    } catch (error) {
      if (activeInstallationIdRef.current !== instId) return;
      const msg = error instanceof Error ? error.message : String(error);
      if (loadCoordinatorRef.current.failSpritepacksScan(token, msg)) {
        showToast(`精灵包扫描失败：${msg}`);
      }
    } finally {
      updateCoordinatorUIState();
    }
  };

  const activeInstanceAuthorizedRef = useRef<boolean>(false);

  const refreshOperations = async (expectedInstId?: string) => {
    const targetInstId = expectedInstId ?? activeInstallationIdRef.current;
    // 事务属于具体实例：和本地模组/精灵包扫描同一个前置条件。没有已验证的活动实例时，
    // 后端只能拒绝读取（invalid_mas_root / permission_lost），那不是事务读取失败，
    // 而是实例尚未就绪；这种情况由实例视图的诊断负责说明。
    if (!targetInstId || targetInstId === 'unverified' || !activeInstanceAuthorizedRef.current) return;
    const reqId = ++operationsRequestIdRef.current;
    try {
      const ops = await ListOperations();
      if (reqId !== operationsRequestIdRef.current || (targetInstId && activeInstallationIdRef.current !== targetInstId)) {
        return;
      }
      // 空列表就是空列表：浏览器模式也不注入编造的事务历史。
      setOperations(Array.isArray(ops) ? ops : []);
      operationsErrorShownRef.current = false;
    } catch (error) {
      // 保留上一次已知状态，但必须让用户知道屏幕上是旧数据。
      if (reqId !== operationsRequestIdRef.current || (targetInstId && activeInstallationIdRef.current !== targetInstId)) {
        return;
      }
      if (!operationsErrorShownRef.current) {
        operationsErrorShownRef.current = true;
        const detail = error instanceof Error ? error.message : String(error);
        showToast(`事务列表读取失败：${detail}。当前显示的是上一次已知状态。`, 'warn');
      }
    }
  };

  const syncInstances = (
    state: MASInstancesState,
    options?: { reason?: InstanceSyncReason; forceReset?: boolean }
  ) => {
    const prevActiveId = activeInstallationIdRef.current;
    const prevAuthorized = activeInstanceAuthorizedRef.current;
    const nextActiveId = state.active_id || 'unverified';
    const activeItem = state.instances.find((item) => item.id === nextActiveId);
    const nextAuthorized = isInstanceAuthorized(activeItem);

    const reconciliation = reconcileInstanceState({
      currentActiveId: prevActiveId,
      currentAuthorized: prevAuthorized,
      nextActiveId,
      nextAuthorized,
      reason: options?.reason,
      forceReset: options?.forceReset,
    });

    const items: Installation[] = state.instances.map((item) => ({
      id: item.id,
      label: item.label,
      platform: item.id === 'android-mas' || isAndroidDevice ? 'android' : 'windows',
      path_hint: item.root,
      permission_state: item.status.valid && item.status.game_exists ? 'authorized' : 'revoked',
      // 版本来自 game/masrun（MAS 启动时写入）；缺失通常表示还没运行过 MAS，
      // 读取失败时同样留空，两种情况都只能显示「未检测」。
      mas_version: item.status.mas_version || '未检测',
      is_valid: item.status.valid && item.status.game_exists,
      is_running: false,
      disk_available_bytes: item.status.available_bytes !== undefined ? item.status.available_bytes : null,
      disk_total_bytes: item.status.total_bytes !== undefined ? item.status.total_bytes : null,
      last_validated_at: new Date().toISOString(),
      diagnostic: item.status.diagnostic,
      diagnostic_detail: item.status.diagnostic_detail,
    }));
    setInstallations(items.length ? items : [UNVERIFIED_INSTALLATION]);
    activeInstallationIdRef.current = nextActiveId;
    setActiveInstallationId(nextActiveId);
    activeInstanceAuthorizedRef.current = nextAuthorized;

    if (reconciliation.shouldResetOperations) {
      executionCoordinatorRef.current?.stopPolling();
      loadCoordinatorRef.current.resetForInstance(nextActiveId);
      updateCoordinatorUIState();
      setInstalledMods([]);
      setSpritepacks([]);
      setAdoptTarget(null);
      setCurrentPlan(null);
    }

    const modsIdle = loadCoordinatorRef.current.getModsStatus() === 'idle';
    if (reconciliation.shouldTriggerScan || (nextAuthorized && modsIdle && !installingRef.current)) {
      void scanLocalSubmods(nextActiveId);
      void refreshSpritepacks(nextActiveId);
      void refreshOperations(nextActiveId);
    } else if (reconciliation.shouldResetOperations && nextActiveId !== 'unverified') {
      void refreshOperations(nextActiveId);
    } else if (!installingRef.current && nextActiveId !== 'unverified') {
      void refreshOperations(nextActiveId);
    }
  };

  const refreshInstanceState = (state: MASInstancesState) => {
    syncInstances(state, { reason: 'permission_refresh' });
  };

  const switchInstance = (state: MASInstancesState) => {
    syncInstances(state, { reason: 'switch' });
  };

  // MAS 版本只在 ListMASInstances 时从 game/masrun 读取，而 LaunchMASInstance 启动即返回，
  // 所以首次运行 MAS 后标题栏会一直停在「未检测」。用户从 MAS 切回来时窗口重新获得焦点，
  // 正是重扫实例的时机，顺带刷新磁盘占用与目录诊断。
  // Android 已在 storage_state 事件和焦点回调里重查实例，这里不重复。
  useEffect(() => {
    if (isAndroidDevice) return;
    const onFocus = () => {
      void ListMASInstances().then((state) => refreshInstanceState(state as MASInstancesState)).catch(() => {
        // 后台重扫失败不打扰用户：手动「重新检查」会报出具体错误。
      });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [isAndroidDevice]);

  useEffect(() => {
    void loadCatalog();
    void ListMASInstances().then((state) => {
      syncInstances(state as MASInstancesState, { reason: 'init' });
      // This effect runs after React has committed the normal application UI.
      // Remote catalog availability is deliberately not a startup prerequisite.
      return ConfirmAppUpdateStartup();
    }).then(async () => {
      if (appUpdateStartupRef.current) return;
      appUpdateStartupRef.current = true;
      if (appUpdateRequestRef.current !== 0) return;
      const request = appUpdateRequestRef.current;
      try {
        const state = await GetAppUpdateStatus();
        if (request !== appUpdateRequestRef.current) return;
        setAppUpdateState((prev) => ({ ...prev, error: undefined, ...state }));
        // Preserve staged updates and all work already owned by the updater.
        if (state.status === 'idle') await handleCheckAppUpdate();
      } catch {
        // Startup update discovery is optional; manual checks remain available.
      }
    }).catch((error) => showToast(`启动初始化失败：${String(error)}`));
  }, []);

  useEffect(() => {
    catalogModsRef.current = catalogMods;
    if (catalogMods.length === 0) return;
    setInstalledMods((prev) => {
      let changed = false;
      const catMap = new Map(catalogMods.map((m) => [m.id, m]));
      const next = prev.map((item) => {
        const catMod = catMap.get(item.mod_id);
        if (!catMod) return item;
        const author = catMod.author?.display_name;
        if (author && (item.author_name === '未知作者' || item.author_name === '已签约作者' || item.author_name === '本地安装记录' || !item.author_name)) {
          changed = true;
          return { ...item, author_name: author };
        }
        return item;
      });
      return changed ? next : prev;
    });
  }, [catalogMods]);

  const activeInstallation = installations.find((i) => i.id === activeInstallationId) || {
    ...UNVERIFIED_INSTALLATION,
    label: '尚未选择 MAS',
  };

  const unmanagedCount = installedMods.filter((m) => !m.is_managed).length;
  const recoverableOpsCount = operations.filter((o) => o.state === 'recoverable').length;
  const transferPercent = archiveProgress && archiveProgress.total > 0 ? Math.min(100, Math.round(archiveProgress.received / archiveProgress.total * 100)) : 0;
  const formatTransferBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  // Handler: Refresh Catalog
  // 返回本次拉取到的真实目录，供「刷新后立刻比对」这类调用方接力使用。
  const handleRefreshCatalog = () => loadCatalog();

  const handleDownloadArchive = async (mod: ModSummary, versionId = mod.latest_version_id) => {
    if (isDownloadingArchive || installingRef.current) return;
    setIsDownloadingArchive(true);
    setTransferTitle(mod.title);
    setArchiveProgress(null);
    try {
      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      const archive = await fetchVerifiedArchive(versionId, base, fetch, setArchiveProgress);
      const url = URL.createObjectURL(archive.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `submod_${versionId}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      showToast(`${mod.title} 的 ZIP 已校验并交给浏览器保存。`);
    } catch (error) {
      showToast(`下载未完成：${error instanceof Error ? error.message : 'unknown_error'}`);
    } finally {
      setIsDownloadingArchive(false);
      setArchiveProgress(null);
      setTransferTitle(null);
    }
  };

  // Handler: Verify Integrity
  // 真实校验：逐个模组取后端文件清单 / 本地扫描结果，按账本哈希比对后报数。
  // 之前这里用 setTimeout 假装校验完成并写死“109 个文件”，是纯假成功。
  const handleVerifyIntegrity = async () => {
    if (isVerifying) return;
    setIsVerifying(true);
    const targetInstId = activeInstallationIdRef.current;
    const totals: IntegrityTotals = {
      modCount: installedMods.length,
      checkedFiles: 0,
      driftedFiles: 0,
      overriddenFiles: 0,
      unmanagedFiles: 0,
      unreadableMods: [],
    };
    try {
      if (!activeInstallation.is_valid || !targetInstId || targetInstId === 'unverified') {
        showToast('请先验证 MAS 目录后再校验文件完整性。', 'warn');
        return;
      }
      if (installedMods.length === 0) {
        showToast(summarizeIntegrity(totals).text, 'warn');
        return;
      }
      // 未托管项的清单来自本地扫描：整轮校验只扫一次，所有散落项共用，避免 N 次全盘扫描。
      let scanOnce: ReturnType<typeof ScanLocalSubmods> | null = null;
      const scan = () => (scanOnce ??= ScanLocalSubmods());

      for (const item of installedMods) {
        try {
          const files = await loadInstalledFiles(item, { list: ListInstalledModFiles, scan });
          if (item.is_managed) {
            // 只有托管文件有账本可比对；非活动文件是被覆盖，不是漂移。
            totals.checkedFiles += files.filter((file) => file.status === 'intact' || file.status === 'modified').length;
            totals.driftedFiles += files.filter((file) => file.status === 'modified').length;
            totals.overriddenFiles += files.filter((file) => file.status === 'overridden').length;
          } else {
            totals.unmanagedFiles += files.length;
          }
        } catch {
          totals.unreadableMods.push(item.title || item.mod_id);
        }
      }
      if (activeInstallationIdRef.current !== targetInstId) return;
      const summary = summarizeIntegrity(totals);
      showToast(summary.text, summary.tone);
    } finally {
      setIsVerifying(false);
    }
  };

  // Handler: Download, verify, and install the selected published archive.
  // Handler: Download, verify, and install the selected published archive using Go streaming stage.
  const handleStartInstallPlan = async (
    mod: ModSummary,
    selectedVersion?: { id: string; version: string; size_bytes: number; sha256: string },
    selectedSpriteSetIDs?: string[],
  ) => {
    if (mod.category === 'spritepack' && (!selectedSpriteSetIDs || selectedSpriteSetIDs.length === 0)) {
      setSelectedModDetail(mod);
      return;
    }
    const targetInstId = activeInstallationIdRef.current;
    if (!activeInstallation.is_valid || targetInstId === 'unverified') { showToast('请先验证 MAS 目录。'); return; }
    if (installingRef.current || isDownloadingArchive) return;
    if (isGameRunning) { showToast('请先退出 MAS 游戏再安装。'); return; }
    installingRef.current = true;
    setInstallingModId(mod.id);
    setTransferTitle(mod.title);
    setInstallStage('preparing');
    const version = selectedVersion || { id: mod.latest_version_id, version: mod.latest_version, size_bytes: mod.size_bytes, sha256: mod.sha256 };
    const operationId = `op_install_${mod.id}_${Date.now()}`;
    const normalizedSets = mod.category === 'spritepack' && selectedSpriteSetIDs ? normalizeSpriteSetIDs(selectedSpriteSetIDs) : undefined;
    let pollTimer: number | null = null;
    try {
      // If VITE_API_BASE_URL is configured, pass it; otherwise pass empty string to let Go use configured backend API URL
      const configuredBase = import.meta.env.VITE_API_BASE_URL;
      const apiBase = configuredBase ? `${configuredBase.replace(/\/$/, '')}/api/v1` : '';
      setArchiveProgress(null);

      pollTimer = window.setInterval(async () => {
        try {
          const prog = await GetStageProgress(operationId);
          if (prog && prog.stage !== 'completed') {
            setArchiveProgress({
              received: prog.received,
              total: prog.total,
              stage: prog.stage === 'connecting' ? 'connecting' : prog.stage === 'verifying' ? 'verifying' : 'downloading',
            });
          }
        } catch {
          // ignore transient poll error
        }
      }, 100);

      const staged = await StageArchive({
        api_base: apiBase,
        version_id: version.id,
        operation_id: operationId,
        mod_id: mod.id,
        category: mod.category,
        sprite_set_ids: normalizedSets,
      });

      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      setArchiveProgress(null);

      await SetMASRoot(activeInstallation.path_hint);
      const existing = installedMods.find((item) => item.mod_id === mod.id);
      const targetPriority = existing?.priority ? existing.priority : (mod.recommended_priority || 0);
      const preview = await PreviewArchive({
        operation_id: operationId,
        archive_id: staged.archive_id,
        expected_sha256: staged.sha256,
        mod_id: mod.id,
        version_id: version.id,
        version: version.version,
        title: mod.title,
        author: mod.author?.display_name || "",
        category: mod.category,
        priority: targetPriority,
        sprite_set_ids: staged.sprite_set_ids || normalizedSets,
        sprite_selection_hash: staged.sprite_selection_hash,
      });
      if (activeInstallationIdRef.current !== targetInstId) return;

      const finalSpriteSets = staged.sprite_set_ids || normalizedSets || [];
      const spriteSelectionContext = mod.category === 'spritepack' ? {
        baseline_ids: existing?.sprite_set_ids || [],
        final_ids: finalSpriteSets,
        removed_ids: existing?.sprite_set_ids && existing?.sprite_selection_hash
          ? normalizeSpriteSetIDs(existing.sprite_set_ids).filter((id) => !finalSpriteSets.includes(id))
          : [],
        unavailable_installed_ids: [],
        unknown_legacy_selection: Boolean(existing?.is_managed && (!existing?.sprite_set_ids || !existing?.sprite_selection_hash)),
      } : undefined;

      setCurrentPlan(mapPlanPreview(preview, {
        backend_operation_id: operationId,
        archive_sha256: staged.sha256,
        plan_id: `install_${mod.id}_${Date.now()}`,
        kind: existing ? 'update' : 'install',
        installation_id: targetInstId,
        mod_id: mod.id,
        mod_title: mod.title,
        author_name: mod.author?.display_name || "未知作者",
        category: mod.category,
        version_id: version.id,
        version_str: version.version,
        priority: targetPriority,
        sprite_set_ids: staged.sprite_set_ids || normalizedSets,
        sprite_selection_hash: staged.sprite_selection_hash,
        selected_sprite_set_count: staged.selected_sprite_set_count ?? normalizedSets?.length,
        sprite_selection_context: spriteSelectionContext,
        expires_at: new Date(Date.now() + 300000).toISOString(),
        dependency_blockers: [],
        semantic_blockers: [],
        changes: [],
        backups_required: 0,
        bytes_required: staged.size_bytes || version.size_bytes,
        warnings: [],
      }));
    } catch (error) {
      if (activeInstallationIdRef.current === targetInstId) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('sprite_version_changed')) {
          showToast('精灵包版本已更新，已刷新模组目录，请重新选择套装。');
          void loadCatalog();
        } else {
          showToast(`安装失败：${errorMsg}`);
        }
      }
    } finally {
      if (pollTimer !== null) clearInterval(pollTimer);
      setArchiveProgress(null);
      installingRef.current = false;
      setInstallingModId(null);
      setTransferTitle(null);
      setInstallStage(null);
    }
  };

  // 「规划更新」来自已安装列表，只有 mod_id 与标题；真实 ModSummary 从目录里取。
  // 目录里找不到就直说，不再临时拼一个字段造假的 ModSummary 塞给安装链路。
  const handleStartUpdatePlanFromInstalled = (modId: string, title: string) => {
    const target = catalogMods.find((mod) => mod.id === modId);
    if (!target) {
      // 区分「目录没加载」和「模组已下架」：前者是网络问题，不该说成业务结论。
      showToast(
        catalogError
          ? `目录未加载（${catalogError}），暂时无法规划「${title}」的更新。`
          : `「${title}」已不在当前目录中（可能已下架），无法规划更新。`,
        'warn'
      );
      return;
    }
    void handleStartInstallPlan(target);
  };
  const handleStartUninstallPlan = async (item: InstalledItem) => {
    const targetInstId = activeInstallationIdRef.current;
    if (!activeInstallation.is_valid || !item.managed_operation_id || targetInstId === 'unverified') {
      showToast('该模组没有可追溯的真实安装记录，或 MAS 目录尚未验证。');
      return;
    }
    if (installingRef.current) return;
    installingRef.current = true;
    try {
      await SetMASRoot(activeInstallation.path_hint);
      const preview = await PreviewUninstall(item.managed_operation_id);
      if (activeInstallationIdRef.current !== targetInstId) return;

      const isSpritepack = item.category === 'spritepack';
      const installedSetIds = normalizeSpriteSetIDs(item.sprite_set_ids);
      const hasValidSelection = Boolean(item.sprite_set_ids && item.sprite_selection_hash);
      const unknownLegacy = Boolean(isSpritepack && (!item.sprite_set_ids || !item.sprite_selection_hash));

      const spriteSelectionContext: SpriteSelectionPlanContext | undefined = isSpritepack
        ? {
            baseline_ids: installedSetIds,
            final_ids: [],
            removed_ids: hasValidSelection && installedSetIds.length > 0 ? installedSetIds : [],
            unavailable_installed_ids: [],
            unknown_legacy_selection: unknownLegacy || !hasValidSelection || installedSetIds.length === 0,
          }
        : undefined;

      const uninstallPlan: Plan = {
        plan_id: preview.plan_id,
        kind: 'uninstall',
        installation_id: targetInstId,
        mod_id: item.mod_id,
        mod_title: item.title,
        author_name: item.author_name || '未知作者',
        category: item.category,
        version_id: item.installed_version_id,
        version_str: item.installed_version,
        sprite_set_ids: [],
        selected_sprite_set_count: 0,
        sprite_selection_context: spriteSelectionContext,
        expires_at: new Date(Date.now() + 300000).toISOString(),
        dependency_blockers: [],
        semantic_blockers: [],
        changes: [],
        backups_required: 0,
        bytes_required: 0,
        warnings: [],
      };

      setCurrentPlan(mapPlanPreview(preview, { ...uninstallPlan, warnings: [], backend_operation_id: (preview as any).operation_id || preview.plan_id }));
    } catch (error) {
      if (activeInstallationIdRef.current === targetInstId) {
        showToast(`卸载预览失败：${String(error)}`);
      }
    } finally {
      installingRef.current = false;
    }
  };

  // Handler: Start Repair Plan
  const handleStartRepairPlan = async (item: InstalledItem) => {
    const targetInstId = activeInstallationIdRef.current;
    if (!activeInstallation.is_valid || targetInstId === 'unverified') {
      showToast('请先验证 MAS 目录。');
      return;
    }
    const targetInstallationId = resolveModInstallationId(item);
    if (!item.is_managed || !targetInstallationId) {
      showToast('缺少托管安装记录，无法自动修复。请重新扫描或人工处理。');
      return;
    }
    if (installingRef.current) return;
    installingRef.current = true;
    setCurrentPlan(null);
    try {
      const pending = (await ListOperations()).find((operation) => operation.state === 'needs_manual_recovery' || operation.state === 'recoverable');
      if (activeInstallationIdRef.current !== targetInstId) return;
      if (pending) {
        await refreshOperations(targetInstId);
        setActiveTab('operations');
        showToast('存在未完成事务，请先检查诊断并重新校验、安全回滚，再重新预览修复。');
        return;
      }
      await SetMASRoot(activeInstallation.path_hint);
      const preview = await PreviewRepair(targetInstallationId);
      if (activeInstallationIdRef.current !== targetInstId) return;
      setCurrentPlan(mapPlanPreview(preview, {
        plan_id: preview.plan_id,
        backend_operation_id: preview.operation_id,
        kind: 'repair',
        installation_id: targetInstId,
        target_installation_id: preview.target_id || targetInstallationId,
        mod_id: item.mod_id,
        mod_title: item.title,
        author_name: item.author_name || '未知作者',
        category: item.category,
        version_id: item.installed_version_id,
        version_str: item.installed_version,
        expires_at: new Date(Date.now() + 300000).toISOString(),
        dependency_blockers: [],
        semantic_blockers: [],
        changes: [],
        backups_required: 0,
        bytes_required: 0,
        warnings: [],
      }));
    } catch (error) {
      if (activeInstallationIdRef.current !== targetInstId) return;
      showToast(`修复预览失败：${error instanceof Error ? error.message : String(error)}`);
      await refreshOperations(targetInstId);
      setActiveTab('operations');
    } finally {
      installingRef.current = false;
    }
  };

  // Handler: Apply Plan (Atomic write transaction)
  const handleApplyPlan = async (plan: Plan) => {
    if (installingRef.current) return;
    const coordinator = executionCoordinatorRef.current!;
    const targetInstId = plan.installation_id;
    if (targetInstId !== activeInstallationIdRef.current) {
      showToast('实例已切换，请在当前实例上重新预览。');
      return;
    }
    if (isGameRunning) {
      showToast('MAS 游戏正在运行，写操作已锁定，请退出游戏后重试。');
      return;
    }
    setCurrentPlan(null);

    const actionText = getPlanActionText(plan.kind);

    if (plan.kind === 'uninstall') {
      const installed = installedMods.find((item) => item.mod_id === plan.mod_id);
      if (!installed?.managed_operation_id) {
        showToast('该模组没有可追溯的真实安装记录，无法执行自动卸载。');
        return;
      }
      const uninstallOperationId = plan.backend_operation_id || plan.plan_id;
      installingRef.current = true;
      coordinator.startSession(plan, targetInstId);
      try {
        const result = await ExecutePlan({ plan_id: plan.plan_id, confirmed: true });
        if (result.state !== 'committed') {
          throw new Error(`${actionText}事务执行未正常提交，状态为: ${result.state || 'uncommitted'}`);
        }
        if (activeInstallationIdRef.current !== targetInstId) {
          coordinator.stopPolling();
          return;
        }
        await coordinator.finishSession(uninstallOperationId, targetInstId, null, {
          confirmedState: result.state,
          files: result.files,
        });
        await refreshOperations(targetInstId);
        setInstalledMods((prev) => prev.filter((item) => item.mod_id !== plan.mod_id));
        void scanLocalSubmods(targetInstId, { forced: true });
        showToast(`${plan.mod_title} 已卸载，恢复原文件 ${plan.summary?.restores_original || 0} 个，下层文件 ${plan.summary?.restores_layer || 0} 个。`);
      } catch (error) {
        const errObj = error instanceof Error ? error : new Error(String(error));
        try {
          await coordinator.finishSession(uninstallOperationId, targetInstId, errObj);
          await refreshOperations(targetInstId);
        } catch {
          // ignore cleanup errors to ensure error toast is displayed
        }
        if (activeInstallationIdRef.current === targetInstId) {
          const finalSession = coordinator.getCurrentSession();
          if (finalSession?.operation.state === 'committed') {
            setInstalledMods((prev) => prev.filter((item) => item.mod_id !== plan.mod_id));
            void scanLocalSubmods(targetInstId, { forced: true });
            showToast(`${plan.mod_title} 后端事务已提交，但通信响应异常：${errObj.message}`);
          } else if (finalSession?.operation.state === 'query_failed') {
            showToast(`真实${actionText}状态未知（后端状态查询失败）：${errObj.message}`);
          } else if (finalSession?.operation.state === 'needs_manual_recovery') {
            showToast(`真实${actionText}需要手动恢复：${describeExecutionError(errObj)}`);
          } else {
            showToast(`真实${actionText}失败：${describeExecutionError(errObj)}`);
          }
        }
      } finally {
        installingRef.current = false;
      }
      return;
    }

    if (plan.backend_operation_id || plan.plan_id) {
      const operationId = plan.backend_operation_id || plan.plan_id;
      installingRef.current = true;
      coordinator.startSession(plan, targetInstId);
      try {
        const result = await ExecutePlan({ plan_id: plan.plan_id, confirmed: true });
        if (result.state !== 'committed') {
          throw new Error(`${actionText}事务执行未正常提交，状态为: ${result.state || 'uncommitted'}`);
        }
        if (activeInstallationIdRef.current !== targetInstId) {
          coordinator.stopPolling();
          return;
        }
        await coordinator.finishSession(operationId, targetInstId, null, {
          confirmedState: result.state,
          files: result.files,
        });
        await refreshOperations(targetInstId);
        void scanLocalSubmods(targetInstId, { forced: true });
        if (plan.kind === 'repair') {
          showToast(`${plan.mod_title} 真实修复事务已提交，正在重新扫描。旧预览已废弃。`);
          return;
        }
        if (plan.kind === 'adopt') {
          // For adoption, immediately read back from persisted ledger state rather than optimistic assumption.
          // Version is kept unverified if no store evidence, and integrity is unknown.
          void scanLocalSubmods(targetInstId, { forced: true });
          showToast(`已成功收养 ${result.files} 个文件并纳入 Ledger。`);
          return;
        }
        setInstalledMods((prev) => {
          const exists = prev.find((item) => item.mod_id === plan.mod_id);
          const authorName = plan.author_name
            || catalogMods.find((item) => item.id === plan.mod_id)?.author?.display_name
            || exists?.author_name
            || '未知作者';
          const nextPriority = plan.priority ?? (exists?.priority ?? 0);
          if (exists) return prev.map((item) => item.mod_id === plan.mod_id ? {
            ...item, installed_version: plan.version_str, installed_version_id: plan.version_id,
            latest_version: plan.version_str, latest_version_id: plan.version_id,
            author_name: authorName,
            has_update: false, integrity_status: 'intact', is_managed: true,
            managed_operation_id: operationId, files_count: result.files,
            priority: nextPriority,
            sprite_set_ids: plan.sprite_set_ids,
            sprite_selection_hash: plan.sprite_selection_hash,
            selected_sprite_set_count: plan.selected_sprite_set_count,
          } : item);
          return [...prev, {
            mod_id: plan.mod_id, title: plan.mod_title, summary: '已通过 RezeHub 验证安装',
            author_name: authorName, category: plan.category || 'submod', installed_version: plan.version_str,
            installed_version_id: plan.version_id, latest_version: plan.version_str,
            latest_version_id: plan.version_id, has_update: false, priority: nextPriority, is_managed: true,
            files_count: result.files, size_bytes: plan.bytes_required, installed_at: new Date().toISOString(),
            sha256: plan.archive_sha256 || '', integrity_status: 'intact', managed_operation_id: operationId,
            sprite_set_ids: plan.sprite_set_ids,
            sprite_selection_hash: plan.sprite_selection_hash,
            selected_sprite_set_count: plan.selected_sprite_set_count,
          }];
        });
        showToast(`已通过 Wails Go 安装核心写入 ${result.files} 个文件。`);
        return;
      } catch (error) {
        const errObj = error instanceof Error ? error : new Error(String(error));
        try {
          await coordinator.finishSession(operationId, targetInstId, errObj);
          await refreshOperations(targetInstId);
        } catch {
          // ignore cleanup errors to ensure error toast is displayed
        }
        if (activeInstallationIdRef.current === targetInstId) {
          const finalSession = coordinator.getCurrentSession();
          if (finalSession?.operation.state === 'committed') {
            void scanLocalSubmods(targetInstId, { forced: true });
            showToast(`${plan.mod_title} 后端事务已提交，但通信响应异常：${errObj.message}`);
          } else if (finalSession?.operation.state === 'query_failed') {
            showToast(`真实${actionText}状态未知（后端状态查询失败）：${errObj.message}`);
          } else if (finalSession?.operation.state === 'needs_manual_recovery') {
            showToast(`真实${actionText}需要手动恢复：${describeExecutionError(errObj)}`);
          } else {
            showToast(`真实${actionText}失败：${describeExecutionError(errObj)}`);
          }
        }
        return;
      } finally {
        installingRef.current = false;
      }
    }

    showToast('执行计划缺少真实后端预览，请重新预览。');
  };

  // Handler: Recover / Safe Rollback Operation
  const handleRecoverOperation = async (opId: string) => {
    showToast(`正在安全回滚操作 [${opId}]...`);
    try {
      await RollbackOperation(opId);
      showToast(`操作 [${opId}] 已安全回滚`);
      await refreshOperations(activeInstallationIdRef.current);
      setCurrentPlan(null);
      void scanLocalSubmods(activeInstallationIdRef.current, { forced: true });
    } catch (err: any) {
      showToast(`回滚失败：${err.message || String(err)}`);
      await refreshOperations(activeInstallationIdRef.current);
    }
  };

  // Handler: Adopt Unmanaged Mod
  const handleConfirmAdopt = async (adopted: InstalledItem, chosenFiles?: string[]) => {
    const currentInstId = activeInstallationIdRef.current;
    if (!currentInstId || currentInstId === 'unverified') return;
    setAdoptTarget(null);
    try {
      showToast(`正在生成收养计划: "${adopted.title}"...`);
      const filesToAdopt = chosenFiles && chosenFiles.length > 0 ? chosenFiles : (adopted.unmanaged_paths || []);
      const scanItemId = adopted.scan_item_id || adopted.submod_dir_name || (adopted.mod_id.startsWith('local:') ? adopted.mod_id.replace(/^local:/, '') : adopted.mod_id);
      const preview = await PreviewAdopt({
        instance_id: currentInstId,
        scan_item_id: scanItemId,
        mod_id: adopted.mod_id,
        candidate_id: adopted.selected_candidate_id || '',
        candidate_registrations: adopted.selected_candidate_registrations || [],
        version_id: adopted.installed_version_id || '',
        version: adopted.installed_version || '1.0.0',
        title: adopted.title,
        priority: adopted.priority || 0,
        files: filesToAdopt,
      });

      if (preview.blockers && preview.blockers.length > 0) {
        showToast(`收养受阻：${preview.blockers.join('; ')}`);
        return;
      }

      // Map backend preview and display in PlanPreviewModal for explicit user review & secondary confirmation
      const mappedPlan = mapPlanPreview(preview, {
        plan_id: preview.plan_id,
        backend_operation_id: preview.operation_id,
        kind: 'adopt',
        installation_id: currentInstId,
        target_installation_id: preview.target_id || adopted.mod_id,
        mod_id: preview.target_id || adopted.mod_id,
        mod_title: preview.mod_title || adopted.title,
        author_name: adopted.author_name || '本地导入',
        category: adopted.category || 'submod',
        version_id: adopted.installed_version_id || '',
        version_str: preview.version || adopted.installed_version || '1.0.0',
        expires_at: new Date(Date.now() + 300000).toISOString(),
        dependency_blockers: [],
        semantic_blockers: [],
        changes: (preview.actions || []).map((a) => ({
          target_path: a.path,
          action: (a.action as any) || 'METADATA_ONLY',
          previous_owner: a.current_source || 'unmanaged',
          next_owner: a.target_source || preview.target_id || adopted.mod_id,
          previous_hash: a.current_hash,
          next_hash: a.current_hash,
          reason: '将现有本地文件收养并纳入 RezeHub Ledger 持久化管理',
          backup_required: false,
        })),
        backups_required: 0,
        bytes_required: 0,
        warnings: [],
      });

      setCurrentPlan(mappedPlan);
    } catch (err: any) {
      showToast(`收养计划生成失败：${err.message || String(err)}`);
    }
  };

  // Handler: Check all updates
  // 真实比对：先拿到刷新后的目录，再用它重扫本地并按目录版本算 has_update；不再写死“发现 1 个更新”。
  const handleCheckAllUpdates = async () => {
    const targetInstId = activeInstallationIdRef.current;
    if (!activeInstallation.is_valid || !targetInstId || targetInstId === 'unverified') {
      showToast('请先验证 MAS 目录后再比对更新。', 'warn');
      return;
    }
    // 顺序必须成立：目录没刷新成功就比对，结论会基于旧版本。
    const catalog = await handleRefreshCatalog();
    if (activeInstallationIdRef.current !== targetInstId) return;
    if (!catalog) {
      showToast('目录刷新失败，更新比对未执行。', 'warn');
      return;
    }
    if (catalog.length === 0) {
      showToast('目录为空，没有可用来比对更新的版本。', 'warn');
      return;
    }
    const scanned = await scanLocalSubmods(targetInstId, { forced: true });
    if (activeInstallationIdRef.current !== targetInstId) return;
    if (!scanned) {
      showToast('本地模组扫描未完成，更新比对已中止。', 'warn');
      return;
    }
    const updateCount = scanned.filter((item) => item.has_update).length;
    showToast(
      updateCount > 0
        ? `已比对 ${scanned.length} 个本地模组：${updateCount} 个有比当前版本更新的发布版本，可在列表里直接规划更新。`
        : `已比对 ${scanned.length} 个本地模组：没有比当前安装版本更新的发布版本。`
    );
  };

  // Handler: Add Custom Instance
  const handleAddCustomInstance = async (label: string, path: string) => {
    const state = await AddMASInstance(label, path);
    switchInstance(state as MASInstancesState);
    showToast('MAS 实例已添加并设为活动实例。');
  };

  const handleSelectInstance = async (id: string) => {
    try { switchInstance(await SelectMASInstance(id) as MASInstancesState); }
    catch (error) { showToast(`切换实例失败：${String(error)}`); }
  };

  const handleRemoveInstance = async (id: string) => {
    try { switchInstance(await RemoveMASInstance(id) as MASInstancesState); }
    catch (error) { showToast(`移除实例失败：${String(error)}`); }
  };

  const handleLaunchInstance = async (id: string) => {
    if (isLaunchingGame) return;
    setIsLaunchingGame(true);
    try {
      await LaunchMASInstance(id);
      showToast('游戏已启动。');
    } catch (error) {
      showToast(`启动失败：${String(error)}`);
    } finally {
      setIsLaunchingGame(false);
    }
  };

  const handleRefreshInstances = async () => {
    try { refreshInstanceState(await ListMASInstances() as MASInstancesState); }
    catch (error) { showToast(`重新检查失败：${String(error)}`); }
  };

  return (
    <div className="flex flex-col h-screen h-[100dvh] w-screen bg-neutral-950 text-neutral-100 overflow-hidden font-sans">
      {/* 1. PC / Android Native Title Bar */}
      <TitleBar
        installations={installations}
        activeInstallationId={activeInstallationId}
        onSelectInstallation={(id) => { void handleSelectInstance(id); }}
        isGameRunning={isGameRunning}
        onOpenInstancesView={() => setActiveTab('instances')}
        onLaunchGame={() => handleLaunchInstance(activeInstallationId)}
        isLaunchingGame={isLaunchingGame}
        isAndroid={isAndroidDevice}
        onOpenAppUpdate={() => setIsAppUpdateOpen(true)}
        hasAppUpdate={appUpdateState.status === 'available' || appUpdateState.status === 'ready'}
      />

      {executionSession && executionSession.installation_id === activeInstallationId && (
        <ExecutionProgressBar
          session={executionSession}
          onDismiss={() => {
            setExecutionSession(null);
            executionCoordinatorRef.current?.clearSession();
          }}
          onViewInOperations={() => setActiveTab('operations')}
          onRecover={(opId) => void handleRecoverOperation(opId)}
        />
      )}

      {(isDownloadingArchive || installingModId !== null) && (
        <div role="status" aria-label="下载进度" className="shrink-0 border-b border-neutral-800 bg-neutral-900 px-4 py-2 text-xs text-neutral-200">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="min-w-0 truncate">{archiveProgress?.stage === 'connecting' ? `正在连接 ${transferTitle}` : archiveProgress?.stage === 'downloading' ? `正在下载 ${transferTitle}` : archiveProgress?.stage === 'verifying' ? `正在校验 ${transferTitle}` : installStage === 'installing' ? `正在安装 ${transferTitle}` : `正在准备 ${transferTitle}`}</span>
            <span className="shrink-0 font-mono tabular-nums text-neutral-300">{archiveProgress ? (archiveProgress.total > 0 ? `${transferPercent}% · ${formatTransferBytes(archiveProgress.received)} / ${formatTransferBytes(archiveProgress.total)}` : formatTransferBytes(archiveProgress.received)) : installStage === 'installing' ? '下载完成' : '等待响应'}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded bg-neutral-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={archiveProgress && archiveProgress.total > 0 ? transferPercent : undefined}>
            <div className={`h-full bg-emerald-500 transition-[width] duration-150 ${archiveProgress && archiveProgress.total > 0 ? '' : 'animate-pulse'}`} style={{ width: archiveProgress && archiveProgress.total > 0 ? `${transferPercent}%` : installStage === 'installing' ? '100%' : '30%' }} />
          </div>
        </div>
      )}

      {/* 2. Main Desktop Workspace (Sidebar + Dynamic Viewport) */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar Navigation */}
        <Sidebar
          activeTab={activeTab}
          onSelectTab={(tab) => {
            if (isAllowedNavTab(tab)) {
              setActiveTab(tab);
            } else {
              showToast('本地恢复历史服务尚未接入。');
            }
          }}
          activeInstallation={activeInstallation}
          installedCount={installedMods.filter((m) => m.is_managed).length}
          unmanagedCount={unmanagedCount}
          recoverableOpsCount={recoverableOpsCount}
        />

        {/* Center Main Viewport */}
        <main className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden relative">
          <StorageAccessBanner
            isAndroid={isAndroidDevice}
            storageState={storageState}
            onRequestAccess={handleRequestStorageAccess}
            onRefreshStatus={() => { void checkStoragePermission(); }}
            isRefreshing={isStorageRefreshing}
          />
          {activeTab === 'catalog' && (
            <CatalogView
              mods={catalogMods}
              installedMods={installedMods}
              activeInstallation={activeInstallation}
              defaultPlatform={isAndroidDevice ? 'android' : 'windows'}
              catalogError={catalogError}
              isCatalogRefreshing={isRefreshing}
              onReloadCatalog={handleRefreshCatalog}
              onOpenDetail={(mod) => setSelectedModDetail(mod)}
              onStartInstallPlan={handleStartInstallPlan}
              onStartUpdatePlan={handleStartInstallPlan}
              installingModId={installingModId}
              installProgress={installingModId ? archiveProgress : null}
            />
          )}

          {activeTab === 'installed' && (
            <InstalledView
              installedMods={installedMods}
              spritepacks={spritepacks}
              hasValidInstance={activeInstallation.is_valid && activeInstallationId !== 'unverified'}
              modsStatus={modsLoadingStatus}
              modsError={modsError}
              isModsInitialLoading={isModsInitialLoading}
              isModsRefreshing={isModsRefreshing}
              spritepacksStatus={spritepacksLoadingStatus}
              spritepacksError={spritepacksError}
              isSpritepacksInitialLoading={isSpritepacksInitialLoading}
              isSpritepacksRefreshing={isSpritepacksRefreshing}
              onRefreshInstalled={() => { void scanLocalSubmods(); }}
              onRefreshSpritepacks={() => { void refreshSpritepacks(); }}
              onCreateSpriteGift={async (file) => {
                const targetInstId = activeInstallationIdRef.current;
                try {
                  const path = await CreateSpriteGift(file);
                  if (activeInstallationIdRef.current !== targetInstId) return '';
                  return `礼物已创建：${path}`;
                } catch (error) {
                  if (activeInstallationIdRef.current !== targetInstId) return '';
                  const message = String(error);
                  if (message.includes('sprite_gift_already_exists')) return '礼物已存在，无需重复创建。';
                  if (message.includes('spritepack_incomplete')) return '精灵包文件不完整，暂时无法创建礼物。';
                  if (message.includes('spritepack_has_no_valid_giftname')) return '该精灵包没有可用的礼物名称。';
                  return '礼物创建失败，请检查游戏目录权限后重试。';
                }
              }}
              onDeleteSpritepack={async (file) => {
                const targetInstId = activeInstallationIdRef.current;
                try {
                  const result = await DeleteSpritepack(file);
                  if (activeInstallationIdRef.current !== targetInstId) {
                    return;
                  }
                  void refreshSpritepacks(targetInstId, { forced: true });
                  showToast(`已移出 ${result.files} 项，备份位于 ${result.backup}`);
                } catch (error) {
                  if (activeInstallationIdRef.current === targetInstId) {
                    showToast(`删除精灵包失败：${String(error)}`);
                  }
                }
              }}
              onStartUpdatePlan={handleStartUpdatePlanFromInstalled}
              onStartUninstallPlan={handleStartUninstallPlan}
              onStartRepairPlan={handleStartRepairPlan}
              onOpenAdoptModal={(item) => setAdoptTarget(item)}
              onInspectFiles={(item) => setInspectTarget(item)}
              onCheckAllUpdates={handleCheckAllUpdates}
              onVerifyIntegrity={handleVerifyIntegrity}
              isVerifying={isVerifying}
            />
          )}

          {activeTab === 'priority' && (
            <PriorityLayersView
              installedMods={installedMods}
              currentInstanceId={activeInstallationId}
              onRefreshInstalled={async (options) => {
                await scanLocalSubmods(undefined, options);
              }}
              showToast={showToast}
            />
          )}

          {activeTab === 'operations' && (
            <OperationsView
              operations={operations}
              onRecoverOperation={handleRecoverOperation}
            />
          )}

          {activeTab === 'instances' && (
            <InstancesView
              installations={installations}
              activeInstallationId={activeInstallationId}
              onSelectActive={handleSelectInstance}
              onAddCustomInstance={handleAddCustomInstance}
              onRemoveInstance={handleRemoveInstance}
              onRefreshInstances={handleRefreshInstances}
              onBrowseDirectory={BrowseMASDirectory}
              isAndroid={isAndroidDevice}
              onOpenAppUpdate={() => setIsAppUpdateOpen(true)}
              hasAppUpdate={appUpdateState.status === 'available' || appUpdateState.status === 'ready'}
            />
          )}

          {/* Toast Notification */}
          {toast && (
            <div
              role="status"
              className={`absolute bottom-4 right-4 max-w-[calc(100vw-2rem)] z-50 px-4 py-2.5 rounded-lg bg-neutral-900 border shadow-xl text-xs flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150 break-words pointer-events-auto ${
                toast.tone === 'warn' ? 'border-amber-500/60 text-amber-100' : 'border-neutral-700 text-neutral-200'
              }`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${toast.tone === 'warn' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
              <span className="min-w-0">{toast.message}</span>
            </div>
          )}
        </main>
      </div>

      {/* Mobile Navigation Bar */}
      <MobileNavBar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        updatesCount={installedMods.filter((m) => m.has_update).length}
        activeOperationsCount={
          // 未完成事务只有这两态：planned（计划已确认）与 recoverable（prepared/
          // applying/committing）。needs_manual_recovery 已终止，不进入“进行中”角标。
          operations.filter((o) => o.state === 'planned' || o.state === 'recoverable').length
        }
      />

      {/* 4. Mod Detail Modal */}
      {selectedModDetail && (
        <ModDetailModal
          mod={selectedModDetail}
          catalogMods={catalogMods}
          onSelectMod={setSelectedModDetail}
          onClose={() => setSelectedModDetail(null)}
          onDownloadArchive={(mod, versionId) => void handleDownloadArchive(mod, versionId)}
          isDownloadingArchive={isDownloadingArchive}
          archiveProgress={archiveProgress}
          onStartInstallPlan={(mod, version, spriteSetIDs) => {
            setSelectedModDetail(null);
            void handleStartInstallPlan(mod, version, spriteSetIDs);
          }}
          onStartUninstallPlan={(mod) => {
            setSelectedModDetail(null);
            const installed = installedMods.find((i) => i.mod_id === mod.id);
            if (installed) {
              void handleStartUninstallPlan(installed);
            }
          }}
          isInstalling={installingModId === selectedModDetail.id}
          isInstalled={installedMods.some((i) => i.mod_id === selectedModDetail.id)}
          installedVersion={
            installedMods.find((i) => i.mod_id === selectedModDetail.id)?.installed_version
          }
          hasUpdate={
            installedMods.find((i) => i.mod_id === selectedModDetail.id)?.has_update
          }
          instanceId={activeInstallationId}
          installationSnapshot={(() => {
            const installed = installedMods.find((i) => i.mod_id === selectedModDetail.id && i.is_managed);
            if (!installed) return null;
            return {
              instanceId: activeInstallationId,
              modId: installed.mod_id,
              versionId: installed.installed_version_id,
              operationId: installed.managed_operation_id || '',
              setIds: installed.sprite_set_ids,
              selectionHash: installed.sprite_selection_hash,
            };
          })()}
          installedLoadingStatus={modsLoadingStatus}
        />
      )}

      {/* 5. Plan Preview Modal (Contract: PreviewInstall / PreviewUpdate / PreviewUninstall) */}
      {currentPlan && (
        <PlanPreviewModal
          plan={currentPlan}
          activeInstallation={activeInstallation}
          isGameRunning={isGameRunning}
          onClose={() => { if (currentPlan?.backend_operation_id) void CancelStage(currentPlan.backend_operation_id); setCurrentPlan(null); }}
          onApplyPlan={() => { if (currentPlan) void handleApplyPlan(currentPlan); }}
          onOpenRecovery={() => { setCurrentPlan(null); setActiveTab('operations'); void refreshOperations(); }}
        />
      )}

      {/* 6. Adopt Unmanaged Mod Modal */}
      {adoptTarget && (
        <AdoptModal
          item={adoptTarget}
          onClose={() => setAdoptTarget(null)}
          onConfirmAdopt={handleConfirmAdopt}
        />
      )}

      {/* 7. File Inspection Modal */}
      {inspectTarget && (
        <FileInspectModal
          key={`${activeInstallationId}:${inspectTarget.mod_id}`}
          item={inspectTarget}
          onClose={() => setInspectTarget(null)}
        />
      )}

      {/* 8. App Auto-Update Modal */}
      <AppUpdateModal
        isOpen={isAppUpdateOpen}
        onClose={() => setIsAppUpdateOpen(false)}
        updateState={appUpdateState}
        onCheckUpdate={handleCheckAppUpdate}
        onDownloadUpdate={handleDownloadAppUpdate}
        onInstallUpdate={handleInstallAppUpdate}
        onCancelUpdate={handleCancelAppUpdate}
        onOpenSettings={handleOpenAppUpdateSettings}
        isAndroid={isAndroidDevice}
      />
    </div>
  );
}
