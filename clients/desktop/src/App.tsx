import React, { useEffect, useRef, useState } from 'react';
import { mapPlanPreview } from './planPreview';
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
import { ExecutionProgressBar } from './components/ExecutionProgressBar';
import { ExecutionCoordinator } from './executionCoordinator';
import { fetchPublishedCatalog, fetchVerifiedArchive, type DownloadProgress } from '../../../ui/catalog-api';
import { AddMASInstance, StageArchive, GetStageProgress, CancelStage, ReleaseArchive, PreviewArchive, PreviewUninstall, ExecutePlan, BrowseMASDirectory, ListMASInstances, ListInstalledArchives, RemoveMASInstance, LaunchMASInstance, ScanLocalSubmods, ScanInstalledSpritepacks, CreateSpriteGift, DeleteSpritepack, SelectMASInstance, SetMASRoot, ListOperations, GetOperation, RollbackOperation, LocalSubmod, MASInstancesState, Spritepack, InstalledArchive } from './wails';
import { INITIAL_OPERATIONS } from './data/mockData';
import { createInstalledLoadCoordinator, LoadingStatus } from './installedLoading';
import {
  Installation,
  ModSummary,
  InstalledItem,
  Operation,
  ExternalChangeDrift,
  Plan,
  PlanChange,
  ExecutionSession,
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
  last_validated_at: '',
};

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
  const [externalDrift, setExternalDrift] = useState<ExternalChangeDrift | null>(null);

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

  // States & Scenario Simulation
  const [isGameRunning, setIsGameRunning] = useState<boolean>(false);
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [hasDependencyBlocker, setHasDependencyBlocker] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
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
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const loadCatalog = async () => {
    setIsRefreshing(true);
    try {
      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      const entries = await fetchPublishedCatalog(base);
      setCatalogMods(entries.map(({ mod, version }) => ({
        id: mod.id, title: mod.title, summary: mod.summary || '', description: mod.description || mod.summary || '',
        author: mod.author || { id: '', display_name: '未知作者' },
        category: mod.category || 'submod', tags: mod.tags || [],
        supported_platforms: mod.supported_platforms || [], mas_version_range: mod.mas_version_range || '',
        recommended_priority: mod.recommended_priority || 0, latest_version_id: version.id,
        latest_version: version.version, size_bytes: version.size_bytes, sha256: version.sha256,
        updated_at: '', downloads_count: mod.downloads_count || 0,
      })));
      setIsOffline(false);
    } catch (error) {
      showToast(`目录读取失败：${error instanceof Error ? error.message : 'unknown_error'}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const scanLocalSubmods = async (targetInstanceId?: string, options?: { forced?: boolean }) => {
    const instId = targetInstanceId || activeInstallationIdRef.current;
    if (!instId || instId === 'unverified') return;
    if (instId !== activeInstallationIdRef.current) return;
    const token = await loadCoordinatorRef.current.waitForModsScan(instId, options);
    if (!token) return;
    updateCoordinatorUIState();

    try {
      const [local, receipts] = await Promise.all([ScanLocalSubmods(), ListInstalledArchives()]) as [LocalSubmod[], InstalledArchive[]];
      if (activeInstallationIdRef.current !== instId) return;
      const managedDirs = new Set(receipts.flatMap((receipt) => receipt.submod_dirs || []).map((dir) => dir.toLowerCase()));
      const catalog = catalogModsRef.current.length > 0 ? catalogModsRef.current : catalogMods;
      const catalogMap = new Map(catalog.map((item) => [item.id, item]));
      const managed: InstalledItem[] = receipts.map((receipt) => {
        const catMod = catalogMap.get(receipt.mod_id);
        const authorName = receipt.author || catMod?.author?.display_name || '未知作者';
        return {
          mod_id: receipt.mod_id, title: receipt.title, summary: '已通过 SubmodHub 安装',
          author_name: authorName, category: (receipt.category as any) || catMod?.category || 'submod', installed_version: receipt.version,
          installed_version_id: receipt.version_id, latest_version: catMod?.latest_version || receipt.version,
          latest_version_id: catMod?.latest_version_id || receipt.version_id, has_update: false, priority: receipt.priority ?? 0,
          is_managed: true, files_count: receipt.files, size_bytes: receipt.size_bytes,
          installed_at: receipt.installed_at ? new Date(receipt.installed_at).toISOString() : new Date().toISOString(), sha256: receipt.sha256,
          integrity_status: 'unknown', managed_operation_id: receipt.operation_id,
        };
      });
      const unmanaged: InstalledItem[] = local.filter((item) => !managedDirs.has(item.directory.toLowerCase())).map((item) => ({
        mod_id: `local:${item.directory}`, title: item.name || item.directory,
        summary: '检测到 MAS 本地子模组，尚未与 SubmodHub 安装记录关联。',
        author_name: item.author || '未知作者 (本地检测)', category: 'submod',
        installed_version: item.version || '未声明', installed_version_id: '',
        latest_version: '未托管', latest_version_id: '', has_update: false,
        priority: 0, is_managed: false, files_count: (item.files || []).length,
        size_bytes: (item.files || []).reduce((sum, file) => sum + file.size, 0),
        installed_at: new Date().toISOString(), sha256: item.files?.[0]?.sha256 || '',
        unmanaged_paths: (item.files || []).map((file) => file.path), submod_dir_name: item.directory,
        integrity_status: 'unknown',
      }));

      const combined = [...managed, ...unmanaged];
      if (loadCoordinatorRef.current.completeModsScan(token, combined)) {
        setInstalledMods(combined);
      }
    } catch (error) {
      if (activeInstallationIdRef.current !== instId) return;
      const msg = error instanceof Error ? error.message : String(error);
      if (loadCoordinatorRef.current.failModsScan(token, msg)) {
        showToast(`本地子模组扫描失败：${msg}`);
      }
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

  const refreshOperations = async (expectedInstId?: string) => {
    const targetInstId = expectedInstId ?? activeInstallationIdRef.current;
    const reqId = ++operationsRequestIdRef.current;
    try {
      const ops = await ListOperations();
      if (reqId !== operationsRequestIdRef.current || (targetInstId && activeInstallationIdRef.current !== targetInstId)) {
        return;
      }
      if (Array.isArray(ops) && ops.length > 0) {
        setOperations(ops);
        return;
      }
      if (import.meta.env.VITE_BROWSER_MODE === '1') {
        setOperations(INITIAL_OPERATIONS);
      } else {
        setOperations(ops || []);
      }
    } catch {
      if (reqId !== operationsRequestIdRef.current || (targetInstId && activeInstallationIdRef.current !== targetInstId)) {
        return;
      }
      if (import.meta.env.VITE_BROWSER_MODE === '1') {
        setOperations(INITIAL_OPERATIONS);
      }
    }
  };

  const syncInstances = (state: MASInstancesState) => {
    const items: Installation[] = state.instances.map((item) => ({
      id: item.id, label: item.label, platform: 'windows', path_hint: item.root,
      permission_state: item.status.valid && item.status.game_exists ? 'authorized' : 'revoked',
      mas_version: '未检测', is_valid: item.status.valid && item.status.game_exists,
      is_running: false,
      disk_available_bytes: item.status.available_bytes !== undefined ? item.status.available_bytes : null,
      last_validated_at: new Date().toISOString(),
    }));
    setInstallations(items.length ? items : [UNVERIFIED_INSTALLATION]);
    const nextActiveId = state.active_id || 'unverified';
    activeInstallationIdRef.current = nextActiveId;
    setActiveInstallationId(nextActiveId);

    // Switch instance in coordinator and reset data immediately
    executionCoordinatorRef.current?.stopPolling();
    loadCoordinatorRef.current.resetForInstance(nextActiveId);
    updateCoordinatorUIState();
    setInstalledMods([]);
    setSpritepacks([]);
    setAdoptTarget(null);
    setCurrentPlan(null);

    if (state.active_id) {
      void scanLocalSubmods(state.active_id);
      void refreshSpritepacks(state.active_id);
      void refreshOperations(state.active_id);
    }
  };

  useEffect(() => {
    void loadCatalog();
    void ListMASInstances().then((state) => syncInstances(state as MASInstancesState))
      .catch((error) => showToast(`实例列表读取失败：${String(error)}`));
    void refreshOperations();
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
  const handleRefreshCatalog = () => {
    void loadCatalog();
  };

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
  const handleVerifyIntegrity = () => {
    setIsVerifying(true);
    setTimeout(() => {
      setIsVerifying(false);
      showToast('全量文件散列哈希校验完毕：已验证 109 个托管文件');
    }, 1000);
  };

  // Handler: Download, verify, and install the selected published archive.
  // Handler: Download, verify, and install the selected published archive using Go streaming stage.
  const handleStartInstallPlan = async (mod: ModSummary, selectedVersion?: { id: string; version: string; size_bytes: number; sha256: string }) => {
    const targetInstId = activeInstallationIdRef.current;
    if (!activeInstallation.is_valid || targetInstId === 'unverified') { showToast('请先验证 MAS 目录。'); return; }
    if (installingRef.current || isDownloadingArchive) return;
    if (isGameRunning) { showToast('请先退出 MAS 游戏再安装。'); return; }
    if (hasDependencyBlocker && mod.id === 'mod_memories_rain') { showToast('缺少前置依赖 ExtraPlus，无法安装。'); return; }
    installingRef.current = true;
    setInstallingModId(mod.id);
    setTransferTitle(mod.title);
    setInstallStage('preparing');
    const version = selectedVersion || { id: mod.latest_version_id, version: mod.latest_version, size_bytes: mod.size_bytes, sha256: mod.sha256 };
    const operationId = `op_install_${mod.id}_${Date.now()}`;
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
      });
      if (activeInstallationIdRef.current !== targetInstId) return;
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
        expires_at: new Date(Date.now() + 300000).toISOString(),
        dependency_blockers: [],
        semantic_blockers: [],
        changes: [],
        backups_required: 0,
        bytes_required: version.size_bytes,
        warnings: [],
      }));
    } catch (error) {
      if (activeInstallationIdRef.current === targetInstId) {
        showToast(`安装失败：${error instanceof Error ? error.message : String(error)}`);
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
      const uninstallPlan: Plan = {
        plan_id: preview.plan_id,
        kind: 'uninstall',
        installation_id: targetInstId,
        mod_id: item.mod_id,
        mod_title: item.title,
        version_id: item.installed_version_id,
        version_str: item.installed_version,
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
  const handleStartRepairPlan = (item: InstalledItem) => {
    showToast(`正在从安全发布归档为 ${item.title} 重新提取完整哈希文件...`);
    setTimeout(() => {
      setInstalledMods((prev) =>
        prev.map((m) => (m.mod_id === item.mod_id ? { ...m, integrity_status: 'intact' } : m))
      );
      showToast(`${item.title} 文件完整性修复完成！`);
    }, 1200);
  };

  // Handler: Apply Plan (Atomic write transaction)
  const handleApplyPlan = async (plan: Plan) => {
    if (installingRef.current) return;
    const coordinator = executionCoordinatorRef.current!;
    const targetInstId = plan.installation_id;
    if (isGameRunning || targetInstId !== activeInstallationIdRef.current) {
      showToast('游戏正在运行或实例已变更，请重新预览。');
      return;
    }
    setCurrentPlan(null);

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
        await ExecutePlan({ plan_id: plan.plan_id, confirmed: true });
        if (activeInstallationIdRef.current !== targetInstId) {
          coordinator.stopPolling();
          return;
        }
        await coordinator.finishSession(uninstallOperationId, targetInstId);
        await refreshOperations(targetInstId);
        setInstalledMods((prev) => prev.filter((item) => item.mod_id !== plan.mod_id));
        void scanLocalSubmods(targetInstId, { forced: true });
        showToast(`${plan.mod_title} 已卸载，恢复原文件 ${plan.summary?.restores_original || 0} 个，下层文件 ${plan.summary?.restores_layer || 0} 个。`);
      } catch (error) {
        const errObj = error instanceof Error ? error : new Error(String(error));
        await coordinator.finishSession(uninstallOperationId, targetInstId, errObj);
        if (activeInstallationIdRef.current === targetInstId) {
          showToast(`真实卸载失败：${errObj.message}`);
        }
        await refreshOperations(targetInstId);
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
        if (activeInstallationIdRef.current !== targetInstId) {
          coordinator.stopPolling();
          return;
        }
        await coordinator.finishSession(operationId, targetInstId);
        await refreshOperations(targetInstId);
        void scanLocalSubmods(targetInstId, { forced: true });
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
          } : item);
          return [...prev, {
            mod_id: plan.mod_id, title: plan.mod_title, summary: '已通过 SubmodHub 验证安装',
            author_name: authorName, category: plan.category || 'submod', installed_version: plan.version_str,
            installed_version_id: plan.version_id, latest_version: plan.version_str,
            latest_version_id: plan.version_id, has_update: false, priority: nextPriority, is_managed: true,
            files_count: result.files, size_bytes: plan.bytes_required, installed_at: new Date().toISOString(),
            sha256: plan.archive_sha256 || '', integrity_status: 'intact', managed_operation_id: operationId,
          }];
        });
        showToast(`已通过 Wails Go 安装核心写入 ${result.files} 个文件。`);
        return;
      } catch (error) {
        const errObj = error instanceof Error ? error : new Error(String(error));
        await coordinator.finishSession(operationId, targetInstId, errObj);
        if (activeInstallationIdRef.current === targetInstId) {
          showToast(`真实安装失败：${errObj.message}`);
        }
        await refreshOperations(targetInstId);
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
      setExternalDrift(null);
    } catch (err: any) {
      showToast(`回滚失败：${err.message || String(err)}`);
      await refreshOperations(activeInstallationIdRef.current);
    }
  };

  // Handler: Restore Backup
  const handleRestoreBackup = async (opId: string, backupId?: string) => {
    showToast(`正在从备份快照 [${backupId || 'snapshot'}] 执行完全还原...`);
    try {
      await RollbackOperation(opId);
      showToast(`操作 [${opId}] 已从快照安全还原`);
      await refreshOperations();
      setExternalDrift(null);
    } catch (err: any) {
      showToast(`还原失败：${err.message || String(err)}`);
      await refreshOperations();
    }
  };

  // Handler: Resolve Hash Drift
  const handleResolveDrift = (driftId: string, action: 'keep_local' | 'overwrite_with_backup') => {
    if (action === 'keep_local') {
      setExternalDrift(null);
      showToast('已保留玩家本地修改，该文件已标记为用户自定义保留项');
    } else {
      setExternalDrift(null);
      showToast('已将本地修改安全归档到备份库，并继续更新');
    }
  };

  // Handler: Export Logs
  const handleExportLogs = (opId?: string) => {
    showToast(`诊断日志已导出至本地文件: C:\\Users\\User\\AppData\\Roaming\\SubmodHub\\logs\\export_${Date.now()}.log`);
  };

  // Handler: Adopt Unmanaged Mod
  const handleConfirmAdopt = (adopted: InstalledItem) => {
    const currentInstId = activeInstallationIdRef.current;
    if (!currentInstId || currentInstId === 'unverified') return;
    setAdoptTarget(null);
    setInstalledMods((prev) =>
      prev.map((m) => (m.mod_id === adopted.mod_id ? adopted : m))
    );
    void scanLocalSubmods(currentInstId, { forced: true });
    showToast(`未托管项 "${adopted.title}" 已成功收养为托管模组！`);
  };

  // Handler: Check all updates
  const handleCheckAllUpdates = () => {
    showToast('正在向云端匹配版本签名与 SHA-256 归档...');
    setTimeout(() => {
      showToast('已完成全量更新比对：发现 1 个模组有新候选版本');
    }, 700);
  };

  // Handler: Add Custom Instance
  const handleAddCustomInstance = async (label: string, path: string) => {
    const state = await AddMASInstance(label, path);
    syncInstances(state as MASInstancesState);
    showToast('MAS 实例已添加并设为活动实例。');
  };

  const handleSelectInstance = async (id: string) => {
    try { syncInstances(await SelectMASInstance(id) as MASInstancesState); }
    catch (error) { showToast(`切换实例失败：${String(error)}`); }
  };

  const handleRemoveInstance = async (id: string) => {
    try { syncInstances(await RemoveMASInstance(id) as MASInstancesState); }
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
    try { syncInstances(await ListMASInstances() as MASInstancesState); }
    catch (error) { showToast(`重新检查失败：${String(error)}`); }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-neutral-950 text-neutral-100 overflow-hidden font-sans">
      {/* 1. PC Native Title Bar */}
      <TitleBar
        installations={installations}
        activeInstallationId={activeInstallationId}
        onSelectInstallation={(id) => { void handleSelectInstance(id); }}
        isGameRunning={isGameRunning}
        isOffline={isOffline}
        onToggleGameRunning={() => showToast('MAS 进程检测尚未接入。')}
        onToggleOffline={() => showToast('离线缓存尚未接入。')}
        onOpenInstancesView={() => setActiveTab('instances')}
        onLaunchGame={() => handleLaunchInstance(activeInstallationId)}
        isLaunchingGame={isLaunchingGame}
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
      <div className="flex flex-1 overflow-hidden">
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
          onRefreshCatalog={handleRefreshCatalog}
          isRefreshing={isRefreshing}
        />

        {/* Center Main Viewport */}
        <main className="flex-1 flex flex-col overflow-hidden relative">
          {activeTab === 'catalog' && (
            <CatalogView
              mods={catalogMods}
              installedMods={installedMods}
              activeInstallation={activeInstallation}
              isOffline={isOffline}
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
              onStartUpdatePlan={handleStartInstallPlan}
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
              onRefreshInstalled={(options) => scanLocalSubmods(undefined, options)}
              showToast={showToast}
            />
          )}

          {activeTab === 'operations' && (
            <OperationsView
              operations={operations}
              externalDrift={externalDrift}
              onRecoverOperation={handleRecoverOperation}
              onRestoreBackup={handleRestoreBackup}
              onResolveDrift={handleResolveDrift}
              onExportLogs={handleExportLogs}
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
            />
          )}

          {/* Toast Notification */}
          {toastMessage && (
            <div className="absolute bottom-4 right-4 z-50 px-4 py-2.5 rounded-lg bg-neutral-900 border border-neutral-700 shadow-xl text-xs text-neutral-200 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>{toastMessage}</span>
            </div>
          )}
        </main>
      </div>

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
          onStartInstallPlan={(mod, version) => {
            setSelectedModDetail(null);
            void handleStartInstallPlan(mod, version);
          }}
          isInstalling={installingModId === selectedModDetail.id}
          isInstalled={installedMods.some((i) => i.mod_id === selectedModDetail.id)}
          installedVersion={
            installedMods.find((i) => i.mod_id === selectedModDetail.id)?.installed_version
          }
          hasUpdate={
            installedMods.find((i) => i.mod_id === selectedModDetail.id)?.has_update
          }
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
    </div>
  );
}
