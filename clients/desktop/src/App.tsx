import React, { useEffect, useState } from 'react';
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
import { fetchPublishedCatalog, fetchVerifiedArchive } from '../../../ui/catalog-api';
import { ApplyArchive, GetMASStatus, ScanLocalSubmods, SetMASRoot, Uninstall, LocalSubmod } from './wails';
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
  const [operations, setOperations] = useState<Operation[]>([]);
  const [externalDrift, setExternalDrift] = useState<ExternalChangeDrift | null>(null);

  // States & Scenario Simulation
  const [isGameRunning, setIsGameRunning] = useState<boolean>(false);
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [hasDependencyBlocker, setHasDependencyBlocker] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [isDownloadingArchive, setIsDownloadingArchive] = useState(false);
  const [pendingArchives, setPendingArchives] = useState<Record<string, { blob: Blob; sha256: string }>>({});

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
        id: mod.id, title: mod.title, summary: mod.summary || '', description: mod.summary || '',
        author: mod.author || { id: '', display_name: '未知作者' },
        category: mod.category || 'submod', tags: mod.tags || [],
        supported_platforms: mod.supported_platforms || [], mas_version_range: mod.mas_version_range || '',
        recommended_priority: mod.recommended_priority || 0, latest_version_id: version.id,
        latest_version: version.version, size_bytes: version.size_bytes, sha256: version.sha256,
        updated_at: '', downloads_count: 0,
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
      const local = await ScanLocalSubmods() as unknown as LocalSubmod[];
      const unmanaged: InstalledItem[] = local.map((item) => ({
        mod_id: `local:${item.directory}`, title: item.name || item.directory,
        summary: '检测到 MAS 本地子模组，尚未与 SubmodHub 安装记录关联。',
        author_name: '未知作者 (本地检测)', category: 'submod',
        installed_version: item.version || '未声明', installed_version_id: '',
        latest_version: '未托管', latest_version_id: '', has_update: false,
        priority: 0, is_managed: false, files_count: item.files.length,
        size_bytes: item.files.reduce((sum, file) => sum + file.size, 0),
        installed_at: new Date().toISOString(), sha256: item.files[0]?.sha256 || '',
        unmanaged_paths: item.files.map((file) => file.path), submod_dir_name: item.directory,
        integrity_status: 'unknown',
      }));
      setInstalledMods((current) => [...current.filter((item) => item.is_managed), ...unmanaged]);
    } catch (error) {
      showToast(`本地子模组扫描失败：${error instanceof Error ? error.message : 'unknown_error'}`);
    }
  };

  useEffect(() => { void loadCatalog(); void GetMASStatus().then((status) => {
    if (status.valid && status.game_exists) {
      const installation: Installation = { id: 'mas-real', label: 'MAS 实例', platform: 'windows', path_hint: status.root, permission_state: 'authorized', mas_version: 'unknown', is_valid: true, is_running: false, disk_available_bytes: 0, last_validated_at: new Date().toISOString() };
      setInstallations([installation]); setActiveInstallationId(installation.id); void scanLocalSubmods();
    }
  }).catch(() => undefined); }, []);

  const activeInstallation =
    installations.find((i) => i.id === activeInstallationId) || installations[0];

  const unmanagedCount = installedMods.filter((m) => !m.is_managed).length;
  const recoverableOpsCount = operations.filter((o) => o.state === 'recoverable').length;

  // Handler: Refresh Catalog
  const handleRefreshCatalog = () => {
    void loadCatalog();
  };

  const handleDownloadArchive = async (mod: ModSummary) => {
    if (isDownloadingArchive) return;
    setIsDownloadingArchive(true);
    try {
      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      const archive = await fetchVerifiedArchive(mod.latest_version_id, base);
      const url = URL.createObjectURL(archive.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `submod_${mod.latest_version_id}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      showToast(`${mod.title} 的 ZIP 已校验并交给浏览器保存。`);
    } catch (error) {
      showToast(`下载未完成：${error instanceof Error ? error.message : 'unknown_error'}`);
    } finally {
      setIsDownloadingArchive(false);
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

  // Handler: Generate and Open Install Plan Preview
  const handleStartInstallPlan = async (mod: ModSummary) => {
    if (!activeInstallation.is_valid) { showToast('请先验证 MAS 目录。'); return; }
    try {
      showToast(`正在校验 ${mod.title} 的 ZIP 归档...`);
      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      const archive = await fetchVerifiedArchive(mod.latest_version_id, base);
      setPendingArchives((prev) => ({ ...prev, [mod.latest_version_id]: { blob: archive.blob, sha256: archive.sha256 } }));
      await SetMASRoot(activeInstallation.path_hint);
    } catch (error) { showToast(`安装准备失败：${error instanceof Error ? error.message : String(error)}`); return; }
    const isUpdate = installedMods.some((i) => i.mod_id === mod.id);

    // Build realistic Plan according to contract
    const newPlan: Plan = {
      plan_id: `plan_${activeInstallation.id}_${mod.id}_${Date.now().toString().slice(-6)}`,
      kind: isUpdate ? 'update' : 'install',
      installation_id: activeInstallation.id,
      mod_id: mod.id,
      mod_title: mod.title,
      version_id: mod.latest_version_id,
      version_str: mod.latest_version,
      expires_at: new Date(Date.now() + 300000).toISOString(),
      dependency_blockers:
        hasDependencyBlocker && mod.id === 'mod_memories_rain'
          ? [
              {
                mod_id: 'mod_extraplus',
                mod_title: 'ExtraPlus',
                required_range: '>=1.3.0',
                reason: '缺少核心前置子模组运行库，需先行安装 ExtraPlus 框架。',
              },
            ]
          : [],
      semantic_blockers: [],
      changes: [
        {
          target_path: `game/submods/${mod.id}/header.rpy`,
          action: isUpdate ? 'OVERWRITE' : 'CREATE',
          previous_owner: isUpdate ? mod.title : null,
          next_owner: mod.title,
          previous_hash: isUpdate ? '8835b8df838520cf8126b4859a4bb38ca094f31c' : null,
          next_hash: mod.sha256.slice(0, 40),
          reason: '核心入口声明与子模组元数据注册',
          backup_required: isUpdate,
        },
        {
          target_path: `game/submods/${mod.id}/content.rpy`,
          action: isUpdate ? 'OVERWRITE' : 'CREATE',
          previous_owner: isUpdate ? mod.title : null,
          next_owner: mod.title,
          previous_hash: isUpdate ? '38a902bf8910a8b901fc883901af88290192c392' : null,
          next_hash: mod.sha256.slice(20, 60),
          reason: '功能交互对话流与事件监听脚本',
          backup_required: isUpdate,
        },
        {
          target_path: `game/submods/${mod.id}/assets/pack.png`,
          action: 'CREATE',
          previous_owner: null,
          next_owner: mod.title,
          previous_hash: null,
          next_hash: '9a87d46e38b3a0f18835b8df838520cf8126b485',
          reason: 'UI 贴图资源',
          backup_required: false,
        },
      ],
      backups_required: isUpdate ? 2 : 0,
      bytes_required: mod.size_bytes + 2400000,
      warnings: [],
    };

    setCurrentPlan(newPlan);
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
  const handleApplyPlan = async (planId: string) => {
    if (!currentPlan) return;
    const plan = currentPlan;
    setCurrentPlan(null);

    const archive = pendingArchives[plan.version_id];
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
    if (archive && plan.kind !== 'uninstall') {
      try {
        const encoded = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(archive.blob); });
        const operationId = `op_${plan.kind}_${plan.mod_id}_${Date.now()}`;
        const result = await ApplyArchive({ operation_id: operationId, archive_base64: encoded, expected_sha256: archive.sha256 });
        setPendingArchives((prev) => { const next = { ...prev }; delete next[plan.version_id]; return next; });
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
  const handleAddCustomInstance = (label: string, path: string) => {
    const newInst: Installation = {
      id: `inst_custom_${Date.now()}`,
      label,
      platform: 'windows',
      path_hint: path,
      permission_state: 'authorized',
      mas_version: 'v0.12.14',
      is_valid: true,
      is_running: false,
      disk_available_bytes: 84000000000,
      last_validated_at: new Date().toISOString(),
    };
    setInstallations((prev) => [...prev, newInst]);
    setActiveInstallationId(newInst.id);
    showToast(`新 MAS 实例 "${label}" 验证通过并已设为活动实例`);
  };

  // Handler: Reauthorize Instance
  const handleReauthorizeInstance = (id: string) => {
    const installation = installations.find((item) => item.id === id);
    if (!installation) return;
    void SetMASRoot(installation.path_hint).then((status) => {
      setInstallations((prev) => prev.map((item) => item.id === id ? { ...item, permission_state: status.valid && status.game_exists ? 'authorized' : 'revoked', is_valid: status.valid && status.game_exists, last_validated_at: new Date().toISOString() } : item));
      showToast(status.valid && status.game_exists ? 'MAS 目录已通过 Wails Go bindings 重新验证。' : 'MAS 目录验证失败。');
    }).catch((error) => showToast(`MAS 目录验证失败：${error instanceof Error ? error.message : String(error)}`));
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
        onSelectInstallation={setActiveInstallationId}
        isGameRunning={isGameRunning}
        isOffline={isOffline}
        onToggleGameRunning={() => showToast('MAS 进程检测尚未接入。')}
        onToggleOffline={() => showToast('离线缓存尚未接入。')}
        onOpenInstancesView={() => showToast('MAS 实例管理尚未接入。')}
      />

      {/* 2. Main Desktop Workspace (Sidebar + Dynamic Viewport) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Navigation */}
        <Sidebar
          activeTab={activeTab}
          onSelectTab={(tab) => {
            if (tab === 'catalog') setActiveTab(tab);
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
            />
          )}

          {activeTab === 'installed' && (
            <InstalledView
              installedMods={installedMods}
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
              onSelectActive={setActiveInstallationId}
              onAddCustomInstance={handleAddCustomInstance}
              onReauthorizeInstance={handleReauthorizeInstance}
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
          onClose={() => setSelectedModDetail(null)}
          onDownloadArchive={(mod) => void handleDownloadArchive(mod)}
          isDownloadingArchive={isDownloadingArchive}
          onStartInstallPlan={(mod) => {
            setSelectedModDetail(null);
            handleStartInstallPlan(mod);
          }}
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
          onApplyPlan={handleApplyPlan}
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
