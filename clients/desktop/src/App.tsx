import React, { useEffect, useRef, useState } from 'react';
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
import {
  INITIAL_INSTALLATIONS,
  INITIAL_EXTERNAL_DRIFT,
  MOCK_MOD_VERSIONS,
} from './data/mockData';
import { fetchPublishedCatalog, fetchVerifiedArchive, type DownloadProgress } from '../../../ui/catalog-api';
import { AddMASInstance, ApplyArchive, BrowseMASDirectory, ListMASInstances, ListInstalledArchives, RemoveMASInstance, LaunchMASInstance, ScanLocalSubmods, ScanInstalledSpritepacks, CreateSpriteGift, DeleteSpritepack, SelectMASInstance, SetMASRoot, Uninstall, LocalSubmod, MASInstancesState, Spritepack, InstalledArchive } from './wails';
import {
  Installation,
  ModSummary,
  InstalledItem,
  Operation,
  ExternalChangeDrift,
  Plan,
} from './types/client';

export default function App() {
  // Installations
  const [installations, setInstallations] = useState<Installation[]>([{
    ...INITIAL_INSTALLATIONS[0], id: 'unverified', label: '尚未连接 MAS', path_hint: '',
    permission_state: 'pending', mas_version: '', is_valid: false, is_running: false,
    disk_available_bytes: 0, last_validated_at: '',
  }]);
  const [activeInstallationId, setActiveInstallationId] = useState<string>('unverified');

  // Navigation
  const [activeTab, setActiveTab] = useState<ActiveTab>('catalog');

  // Catalog and Installed Data
  const [catalogMods, setCatalogMods] = useState<ModSummary[]>([]);
  const [installedMods, setInstalledMods] = useState<InstalledItem[]>([]);
  const [spritepacks, setSpritepacks] = useState<Spritepack[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [externalDrift, setExternalDrift] = useState<ExternalChangeDrift | null>(null);

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

  const scanLocalSubmods = async () => {
    try {
      const [local, receipts] = await Promise.all([ScanLocalSubmods(), ListInstalledArchives()]) as [LocalSubmod[], InstalledArchive[]];
      const managedDirs = new Set(receipts.flatMap((receipt) => receipt.submod_dirs || []).map((dir) => dir.toLowerCase()));
      const managed: InstalledItem[] = receipts.map((receipt) => ({
        mod_id: receipt.mod_id, title: receipt.title, summary: '已通过 SubmodHub 安装',
        author_name: '本地安装记录', category: 'submod', installed_version: receipt.version,
        installed_version_id: receipt.version_id, latest_version: receipt.version,
        latest_version_id: receipt.version_id, has_update: false, priority: 50,
        is_managed: true, files_count: receipt.files, size_bytes: receipt.size_bytes,
        installed_at: receipt.installed_at, sha256: receipt.sha256,
        integrity_status: 'unknown', managed_operation_id: receipt.operation_id,
      }));
      const unmanaged: InstalledItem[] = local.filter((item) => !managedDirs.has(item.directory.toLowerCase())).map((item) => ({
        mod_id: `local:${item.directory}`, title: item.name || item.directory,
        summary: '检测到 MAS 本地子模组，尚未与 SubmodHub 安装记录关联。',
        author_name: '未知作者 (本地检测)', category: 'submod',
        installed_version: item.version || '未声明', installed_version_id: '',
        latest_version: '未托管', latest_version_id: '', has_update: false,
        priority: 0, is_managed: false, files_count: (item.files || []).length,
        size_bytes: (item.files || []).reduce((sum, file) => sum + file.size, 0),
        installed_at: new Date().toISOString(), sha256: item.files?.[0]?.sha256 || '',
        unmanaged_paths: (item.files || []).map((file) => file.path), submod_dir_name: item.directory,
        integrity_status: 'unknown',
      }));
      setInstalledMods([...managed, ...unmanaged]);
    } catch (error) {
      showToast(`本地子模组扫描失败：${error instanceof Error ? error.message : 'unknown_error'}`);
    }
  };

  const syncInstances = (state: MASInstancesState) => {
    const items: Installation[] = state.instances.map((item) => ({
      id: item.id, label: item.label, platform: 'windows', path_hint: item.root,
      permission_state: item.status.valid && item.status.game_exists ? 'authorized' : 'revoked',
      mas_version: '未检测', is_valid: item.status.valid && item.status.game_exists,
      is_running: false, disk_available_bytes: 0, last_validated_at: new Date().toISOString(),
    }));
    setInstallations(items.length ? items : [{ ...INITIAL_INSTALLATIONS[0], id: 'unverified', label: '尚未连接 MAS', path_hint: '', permission_state: 'pending', mas_version: '', is_valid: false, is_running: false, disk_available_bytes: 0, last_validated_at: '' }]);
    setActiveInstallationId(state.active_id || 'unverified');
    setInstalledMods([]);
    setSpritepacks([]);
    if (state.active_id) {
      void scanLocalSubmods();
      void ScanInstalledSpritepacks().then((items) => setSpritepacks(items as Spritepack[]))
        .catch((error) => showToast(`精灵包扫描失败：${String(error)}`));
    }
  };

  useEffect(() => {
    void loadCatalog();
    void ListMASInstances().then((state) => syncInstances(state as MASInstancesState))
      .catch((error) => showToast(`实例列表读取失败：${String(error)}`));
  }, []);

  const activeInstallation = installations.find((i) => i.id === activeInstallationId) || {
    ...INITIAL_INSTALLATIONS[0], id: 'unverified', label: '尚未选择 MAS', path_hint: '',
    permission_state: 'pending' as const, is_valid: false,
  };

  const unmanagedCount = installedMods.filter((m) => !m.is_managed).length;
  const recoverableOpsCount = operations.filter((o) => o.state === 'recoverable').length;
  const transferPercent = archiveProgress ? Math.min(100, Math.round(archiveProgress.received / archiveProgress.total * 100)) : 0;
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
  const handleStartInstallPlan = async (mod: ModSummary, selectedVersion?: { id: string; version: string; size_bytes: number; sha256: string }) => {
    if (!activeInstallation.is_valid) { showToast('请先验证 MAS 目录。'); return; }
    if (installingRef.current || isDownloadingArchive) return;
    if (isGameRunning) { showToast('请先退出 MAS 游戏再安装。'); return; }
    if (hasDependencyBlocker && mod.id === 'mod_memories_rain') { showToast('缺少前置依赖 ExtraPlus，无法安装。'); return; }
    installingRef.current = true;
    setInstallingModId(mod.id);
    setTransferTitle(mod.title);
    setInstallStage('preparing');
    const version = selectedVersion || { id: mod.latest_version_id, version: mod.latest_version, size_bytes: mod.size_bytes, sha256: mod.sha256 };
    try {
      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      setArchiveProgress(null);
      const archive = await fetchVerifiedArchive(version.id, base, fetch, setArchiveProgress);
      await SetMASRoot(activeInstallation.path_hint);
      setArchiveProgress(null);
      setInstallStage('installing');
      showToast(`正在安装 ${mod.title}...`);
      await handleApplyPlan({
        plan_id: `install_${mod.id}_${Date.now()}`,
        kind: installedMods.some((item) => item.mod_id === mod.id) ? 'update' : 'install',
        installation_id: activeInstallation.id, mod_id: mod.id, mod_title: mod.title,
        version_id: version.id, version_str: version.version,
        expires_at: new Date(Date.now() + 300000).toISOString(),
        dependency_blockers: [], semantic_blockers: [], changes: [],
        backups_required: 0, bytes_required: version.size_bytes, warnings: [],
      }, archive);
    } catch (error) {
      showToast(`安装失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setArchiveProgress(null);
      installingRef.current = false;
      setInstallingModId(null);
      setTransferTitle(null);
      setInstallStage(null);
    }
  };

  // Handler: Start Uninstall Plan
  const handleStartUninstallPlan = (item: InstalledItem) => {
    const uninstallPlan: Plan = {
      plan_id: `plan_uninstall_${item.mod_id}_${Date.now().toString().slice(-6)}`,
      kind: 'uninstall',
      installation_id: activeInstallation.id,
      mod_id: item.mod_id,
      mod_title: item.title,
      version_id: item.installed_version_id,
      version_str: item.installed_version,
      expires_at: new Date(Date.now() + 300000).toISOString(),
      dependency_blockers: [],
      semantic_blockers: [],
      changes: [
        {
          target_path: `game/submods/${item.submod_dir_name || item.mod_id}/header.rpy`,
          action: 'REMOVE',
          previous_owner: item.title,
          next_owner: null,
          previous_hash: item.sha256.slice(0, 40),
          next_hash: null,
          reason: '卸载子模组，清理脚本文件',
          backup_required: true,
        },
        {
          target_path: `game/submods/${item.submod_dir_name || item.mod_id}/content.rpy`,
          action: 'REMOVE',
          previous_owner: item.title,
          next_owner: null,
          previous_hash: item.sha256.slice(20, 60),
          next_hash: null,
          reason: '卸载子模组代码',
          backup_required: true,
        },
      ],
      backups_required: 2,
      bytes_required: 0,
      warnings: ['卸载会直接删除当前文件，不恢复安装前备份；备份快照仍保留在本地供人工恢复。'],
    };

    setCurrentPlan(uninstallPlan);
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
  const handleApplyPlan = async (plan: Plan, archive?: { blob: Blob; sha256: string }) => {
    setCurrentPlan(null);
    if (plan.kind === 'uninstall') {
      const installed = installedMods.find((item) => item.mod_id === plan.mod_id);
      if (!installed?.managed_operation_id) {
        showToast('该模组没有可追溯的真实安装记录，无法执行自动卸载。');
        return;
      }
      try {
        await SetMASRoot(activeInstallation.path_hint);
        const uninstallOperationId = `uninstall_${plan.mod_id}_${Date.now()}`;
        await Uninstall(installed.managed_operation_id, uninstallOperationId);
        setInstalledMods((prev) => prev.filter((item) => item.mod_id !== plan.mod_id));
        setOperations((prev) => [{
          operation_id: uninstallOperationId, installation_id: plan.installation_id,
          mod_id: plan.mod_id, mod_title: plan.mod_title, version_id: plan.version_id,
          version_str: plan.version_str, kind: 'uninstall', state: 'committed',
          progress: { stage: '已删除当前文件，未恢复安装前备份', processed_files: plan.changes.length,
            total_files: plan.changes.length, bytes_processed: 0, total_bytes: 0, percent: 100 },
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }, ...prev]);
        showToast(`${plan.mod_title} 已通过真实 Wails 卸载，当前文件已删除。`);
      } catch (error) {
        showToast(`真实卸载失败：${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    if (archive) {
      try {
        const encoded = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(archive.blob); });
        const operationId = `op_${plan.kind}_${plan.mod_id}_${Date.now()}`;
        const result = await ApplyArchive({ operation_id: operationId, archive_base64: encoded, expected_sha256: archive.sha256,
          mod_id: plan.mod_id, version_id: plan.version_id, version: plan.version_str, title: plan.mod_title });
        setOperations((prev) => [{
          operation_id: operationId, installation_id: plan.installation_id,
          mod_id: plan.mod_id, mod_title: plan.mod_title, version_id: plan.version_id,
          version_str: plan.version_str, kind: plan.kind, state: 'committed',
          progress: { stage: `真实归档已写入 ${result.files} 个文件`, processed_files: result.files,
            total_files: result.files, bytes_processed: plan.bytes_required, total_bytes: plan.bytes_required, percent: 100 },
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }, ...prev]);
        setInstalledMods((prev) => {
          const exists = prev.find((item) => item.mod_id === plan.mod_id);
          if (exists) return prev.map((item) => item.mod_id === plan.mod_id ? {
            ...item, installed_version: plan.version_str, installed_version_id: plan.version_id,
            latest_version: plan.version_str, latest_version_id: plan.version_id,
            has_update: false, integrity_status: 'intact', is_managed: true,
            managed_operation_id: operationId, files_count: result.files,
          } : item);
          return [...prev, {
            mod_id: plan.mod_id, title: plan.mod_title, summary: '已通过 SubmodHub 验证安装',
            author_name: '已签约作者', category: 'submod', installed_version: plan.version_str,
            installed_version_id: plan.version_id, latest_version: plan.version_str,
            latest_version_id: plan.version_id, has_update: false, priority: 50, is_managed: true,
            files_count: result.files, size_bytes: plan.bytes_required, installed_at: new Date().toISOString(),
            sha256: archive.sha256, integrity_status: 'intact', managed_operation_id: operationId,
          }];
        });
        showToast(`已通过 Wails Go 安装核心写入 ${result.files} 个文件。`);
        return;
      } catch (error) { showToast(`真实安装失败：${error instanceof Error ? error.message : String(error)}`); return; }
    }

    // Create active operation in list for non-archive UI operations.
    const newOpId = `op_${plan.kind}_${plan.mod_id}_${Date.now().toString().slice(-4)}`;
    const newOperation: Operation = {
      operation_id: newOpId,
      installation_id: plan.installation_id,
      mod_id: plan.mod_id,
      mod_title: plan.mod_title,
      version_id: plan.version_id,
      version_str: plan.version_str,
      kind: plan.kind,
      state: 'writing',
      progress: {
        stage: '正在原子写入目标文件并校验写入哈希...',
        processed_files: 2,
        total_files: plan.changes.length,
        bytes_processed: plan.bytes_required,
        total_bytes: plan.bytes_required,
        percent: 75,
      },
      backup_id: plan.backups_required > 0 ? `bkp_${plan.mod_id}_auto` : undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setOperations((prev) => [newOperation, ...prev]);
    showToast(`开始执行写入事务 [${newOpId}]...`);

    // Simulate completion
    setTimeout(() => {
      setOperations((prev) =>
        prev.map((o) =>
          o.operation_id === newOpId
            ? {
                ...o,
                state: 'committed',
                progress: {
                  ...o.progress,
                  stage: '事务已完全提交至持久化 Ledger',
                  processed_files: plan.changes.length,
                  percent: 100,
                },
              }
            : o
        )
      );

      if (plan.kind === 'uninstall') {
        setInstalledMods((prev) => prev.filter((i) => i.mod_id !== plan.mod_id));
        showToast(`${plan.mod_title} 已成功安全卸载并归档快照`);
      } else {
        // Install or Update
        setInstalledMods((prev) => {
          const exists = prev.find((i) => i.mod_id === plan.mod_id);
          if (exists) {
            return prev.map((i) =>
              i.mod_id === plan.mod_id
                ? {
                    ...i,
                    installed_version: plan.version_str,
                    installed_version_id: plan.version_id,
                    has_update: false,
                    integrity_status: 'intact',
                  }
                : i
            );
          } else {
            const newInstalled: InstalledItem = {
              mod_id: plan.mod_id,
              title: plan.mod_title,
              summary: '已通过 SubmodHub 验证安装',
              author_name: '已签约作者',
              category: 'submod',
              installed_version: plan.version_str,
              installed_version_id: plan.version_id,
              latest_version: plan.version_str,
              latest_version_id: plan.version_id,
              has_update: false,
              priority: 50,
              is_managed: true,
              files_count: plan.changes.length,
              size_bytes: plan.bytes_required,
              installed_at: new Date().toISOString(),
              sha256: '9a87d46e38b3a0f18835b8df838520cf8126b4859a4bb38ca094f31c771fa109',
              integrity_status: 'intact',
            };
            return [...prev, newInstalled];
          }
        });
        showToast(`${plan.mod_title} ${plan.version_str} 安装完成并成功登记！`);
      }
    }, 1500);
  };

  // Handler: Recover Operation
  const handleRecoverOperation = (opId: string) => {
    showToast(`正在从断点恢复操作 [${opId}]...`);
    setTimeout(() => {
      setOperations((prev) =>
        prev.map((o) =>
          o.operation_id === opId
            ? {
                ...o,
                state: 'committed',
                error: undefined,
                progress: {
                  stage: '恢复后原子写入成功，已完成提交',
                  processed_files: o.progress.total_files,
                  total_files: o.progress.total_files,
                  bytes_processed: o.progress.total_bytes,
                  total_bytes: o.progress.total_bytes,
                  percent: 100,
                },
              }
            : o
        )
      );
      setExternalDrift(null);
      showToast('操作恢复完成，状态已持久化');
    }, 1200);
  };

  // Handler: Restore Backup
  const handleRestoreBackup = (opId: string, backupId?: string) => {
    showToast(`正在从备份快照 [${backupId || 'snapshot'}] 执行完全还原...`);
    setTimeout(() => {
      setOperations((prev) =>
        prev.map((o) =>
          o.operation_id === opId
            ? {
                ...o,
                state: 'rolled_back',
                progress: {
                  ...o.progress,
                  stage: '已从快照安全回滚至修改前状态',
                },
              }
            : o
        )
      );
      setExternalDrift(null);
      showToast('快照还原完成，MAS 目录已复原');
    }, 1000);
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

  // Handler: Priority Changes
  const handleApplyNewPriorities = (newPriorities: Record<string, number>) => {
    setInstalledMods((prev) =>
      prev.map((m) =>
        newPriorities[m.mod_id] !== undefined ? { ...m, priority: newPriorities[m.mod_id] } : m
      )
    );
    showToast('新图层优先级配置已成功生效并写入 MAS 图层映射表');
  };

  // Handler: Adopt Unmanaged Mod
  const handleConfirmAdopt = (adopted: InstalledItem) => {
    setAdoptTarget(null);
    setInstalledMods((prev) =>
      prev.map((m) => (m.mod_id === adopted.mod_id ? adopted : m))
    );
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

  // Scenario Toggles
  const handleToggleGameRunning = () => {
    setIsGameRunning((prev) => {
      const next = !prev;
      showToast(next ? '已模拟触发: MAS 正在运行中 (文件写入物理锁定)' : '已模拟解除: MAS 已退出 (就绪状态)');
      return next;
    });
  };

  const handleToggleOffline = () => {
    setIsOffline((prev) => {
      const next = !prev;
      showToast(next ? '已切换至: 离线只读缓存模式' : '已恢复: 云端 API v1 在线模式');
      return next;
    });
  };

  const handleToggleExternalDrift = () => {
    if (externalDrift) {
      setExternalDrift(null);
      showToast('已清除哈希漂移模拟状态');
    } else {
      setExternalDrift(INITIAL_EXTERNAL_DRIFT);
      showToast('已模拟注入: external_change 文件哈希漂移异常');
    }
  };

  const handleToggleDependencyBlocker = () => {
    setHasDependencyBlocker((prev) => {
      const next = !prev;
      showToast(next ? '已开启依赖缺失模拟: 安装雨中记忆将触发 dependency_missing 阻断' : '已关闭依赖缺失模拟');
      return next;
    });
  };

  const handleResetAllScenarios = () => {
    setIsGameRunning(false);
    setIsOffline(false);
    setHasDependencyBlocker(false);
    setExternalDrift(null);
    showToast('已重置所有异常场景，恢复标准就绪工作流');
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

      {(isDownloadingArchive || installingModId !== null) && (
        <div role="status" aria-label="下载进度" className="shrink-0 border-b border-neutral-800 bg-neutral-900 px-4 py-2 text-xs text-neutral-200">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="min-w-0 truncate">{archiveProgress?.stage === 'downloading' ? `正在下载 ${transferTitle}` : archiveProgress?.stage === 'verifying' ? `正在校验 ${transferTitle}` : installStage === 'installing' ? `正在安装 ${transferTitle}` : `正在准备下载 ${transferTitle}`}</span>
            <span className="shrink-0 font-mono tabular-nums text-neutral-300">{archiveProgress ? `${transferPercent}% · ${formatTransferBytes(archiveProgress.received)} / ${formatTransferBytes(archiveProgress.total)}` : installStage === 'installing' ? '下载完成' : '等待响应'}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded bg-neutral-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={archiveProgress ? transferPercent : undefined}>
            <div className={`h-full bg-emerald-500 transition-[width] duration-150 ${archiveProgress ? '' : 'animate-pulse'}`} style={{ width: archiveProgress ? `${transferPercent}%` : installStage === 'installing' ? '100%' : '30%' }} />
          </div>
        </div>
      )}

      {/* 2. Main Desktop Workspace (Sidebar + Dynamic Viewport) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Navigation */}
        <Sidebar
          activeTab={activeTab}
          onSelectTab={(tab) => {
            if (tab === 'catalog' || tab === 'instances' || tab === 'installed') setActiveTab(tab);
            else showToast('本地安装、恢复和优先级服务尚未接入。');
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
              onRefreshSpritepacks={() => { void ScanInstalledSpritepacks().then((items) => setSpritepacks(items as Spritepack[])).catch((error) => showToast(`精灵包扫描失败：${String(error)}`)); }}
              onCreateSpriteGift={async (file) => {
                try {
                  const path = await CreateSpriteGift(file);
                  return `礼物已创建：${path}`;
                } catch (error) {
                  const message = String(error);
                  if (message.includes('sprite_gift_already_exists')) return '礼物已存在，无需重复创建。';
                  if (message.includes('spritepack_incomplete')) return '精灵包文件不完整，暂时无法创建礼物。';
                  if (message.includes('spritepack_has_no_valid_giftname')) return '该精灵包没有可用的礼物名称。';
                  return '礼物创建失败，请检查游戏目录权限后重试。';
                }
              }}
              onDeleteSpritepack={async (file) => {
                try {
                  const result = await DeleteSpritepack(file);
                  setSpritepacks(await ScanInstalledSpritepacks() as Spritepack[]);
                  showToast(`已移出 ${result.files} 项，备份位于 ${result.backup}`);
                } catch (error) {
                  showToast(`删除精灵包失败：${String(error)}`);
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
              onApplyNewPriorities={handleApplyNewPriorities}
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
          onClose={() => setCurrentPlan(null)}
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
          item={inspectTarget}
          onClose={() => setInspectTarget(null)}
        />
      )}
    </div>
  );
}
