import React, { useState, useEffect, useTransition } from 'react';
import {
  INITIAL_INSTALLATIONS,
  generateSamplePlan,
} from './mock/data';
import { fetchPublishedCatalog } from '../../../ui/catalog-api';
import {
  Installation,
  Mod,
  InstalledMod,
  Operation,
  Plan,
} from './types/submodhub';
import { AndroidFrame } from './components/AndroidFrame';
import { TopAppBar } from './components/TopAppBar';
import { BottomNavBar, NavTabId } from './components/BottomNavBar';
import { CatalogTab } from './components/CatalogTab';
import { InstalledTab } from './components/InstalledTab';
import { OperationsTab } from './components/OperationsTab';
import { StorageTab } from './components/StorageTab';
import { ModDetailModal } from './components/ModDetailModal';
import { InstallPlanSheet } from './components/InstallPlanSheet';
import { ExternalChangeModal } from './components/ExternalChangeModal';
import { AdoptModal } from './components/AdoptModal';
import { PriorityModal } from './components/PriorityModal';
import { InstancePickerModal } from './components/InstancePickerModal';
import { CheckCircle2, AlertCircle, Info } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTabId>('catalog');
  const [installations, setInstallations] = useState<Installation[]>([{
    ...INITIAL_INSTALLATIONS[0], id: 'unverified', label: '尚未授权 MAS',
    path_hint: '', saf_tree_uri: '', permission_state: 'unverified',
    mas_version: '', is_running: false, free_space_bytes: 0, installed_mods_count: 0, last_verified_at: '',
  }]);
  const [currentInstallationId, setCurrentInstallationId] = useState<string>('unverified');
  const [mods, setMods] = useState<Mod[]>([]);
  const [installedMods, setInstalledMods] = useState<InstalledMod[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);

  // Modals & Sheets State
  const [selectedModForDetail, setSelectedModForDetail] = useState<Mod | null>(null);
  const [activePlan, setActivePlan] = useState<Plan | null>(null);
  const [driftOperation, setDriftOperation] = useState<Operation | null>(null);
  const [unmanagedToAdopt, setUnmanagedToAdopt] = useState<InstalledMod | null>(null);
  const [modForPriority, setModForPriority] = useState<InstalledMod | null>(null);
  const [isInstancePickerOpen, setIsInstancePickerOpen] = useState(false);

  // Simulator / Scenario State
  const [offlineMode, setOfflineMode] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type?: 'info' | 'success' | 'warn' } | null>(null);

  const currentInstallation =
    installations.find((i) => i.id === currentInstallationId) || installations[0];

  const showToast = (message: string, type: 'info' | 'success' | 'warn' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 3200);
  };

  const loadCatalog = async () => {
    setIsRefreshing(true);
    try {
      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      const entries = await fetchPublishedCatalog(base);
      setMods(entries.map(({ mod, version }) => ({
        id: mod.id, title: mod.title, summary: mod.summary || '', description: mod.summary || '',
        author: mod.author || { id: '', display_name: '未知作者' }, category: mod.category || 'submod',
        tags: mod.tags || [], supported_platforms: mod.supported_platforms || [],
        mas_version_range: mod.mas_version_range || '', recommended_priority: mod.recommended_priority || 0,
        latest_version_id: version.id, latest_version: version.version, size_bytes: version.size_bytes,
        downloads_count: 0, updated_at: '', versions: [{
          ...version, release_notes: version.release_notes || '', dependencies: (version.dependencies || []).map((dep) => ({
            ...dep, mod_name: dep.mod_id,
          })), scan_report_id: version.scan_report_id || '', created_at: '',
        }],
      })));
      setOfflineMode(false);
    } catch (error) {
      showToast(`目录读取失败：${error instanceof Error ? error.message : 'unknown_error'}`, 'warn');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => { void loadCatalog(); }, []);

  // Plan generation from Mod Detail
  const handleRequestPlan = (mod: Mod, targetVersionId: string) => {
    showToast('安装预览尚未接入本地 Go 服务，未生成计划。', 'warn');
    return;
    const plan = generateSamplePlan(mod, targetVersionId, currentInstallation);
    setActivePlan(plan);
  };

  // Plan confirmation execution (ApplyPlan RPC / Go binding)
  const handleConfirmApplyPlan = (plan: Plan) => {
    const targetMod = mods.find((m) => m.id === plan.mod_id);
    const modTitle = targetMod ? targetMod.title : plan.mod_id;
    const version = targetMod?.versions.find((v) => v.id === plan.version_id)?.version || '1.0.0';

    const newOp: Operation = {
      operation_id: `op_${Date.now()}`,
      installation_id: plan.installation_id,
      plan_id: plan.plan_id,
      mod_title: modTitle,
      mod_id: plan.mod_id,
      version: version,
      kind: plan.kind === 'priority_change' ? 'priority' : plan.kind,
      stage: 'downloading',
      status: 'in_progress',
      progress_percent: 20,
      current_file: plan.changes[0]?.target_path,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      log_lines: [
        `[${new Date().toLocaleTimeString()}] ApplyPlan 启动: 准备执行 ${plan.changes.length} 个文件变更`,
        `[${new Date().toLocaleTimeString()}] 校验 SAF 根权限与游戏运行状态 [OK]`,
        `[${new Date().toLocaleTimeString()}] 开始下载并比对 SHA-256...`,
      ],
    };

    setOperations((prev) => [newOp, ...prev]);
    setActivePlan(null);
    setSelectedModForDetail(null);
    setActiveTab('operations');
    showToast(`安装计划已生效，正在执行写入事务: ${modTitle}`, 'success');

    // Simulate multi-stage progression according to contract
    setTimeout(() => {
      setOperations((prev) =>
        prev.map((op) =>
          op.operation_id === newOp.operation_id
            ? {
                ...op,
                stage: 'scanning',
                progress_percent: 45,
                log_lines: [
                  ...(op.log_lines || []),
                  `[${new Date().toLocaleTimeString()}] 下载完成，执行本地 AST 语法树安全扫描 [OK]`,
                ],
              }
            : op
        )
      );
    }, 1200);

    setTimeout(() => {
      setOperations((prev) =>
        prev.map((op) =>
          op.operation_id === newOp.operation_id
            ? {
                ...op,
                stage: 'backed_up',
                progress_percent: 70,
                log_lines: [
                  ...(op.log_lines || []),
                  `[${new Date().toLocaleTimeString()}] 创建原子回滚快照点 (.submodhub_backups/) [OK]`,
                  `[${new Date().toLocaleTimeString()}] 写入新模组文件: ${plan.changes[0]?.target_path}`,
                ],
              }
            : op
        )
      );
    }, 2400);

    setTimeout(() => {
      setOperations((prev) =>
        prev.map((op) =>
          op.operation_id === newOp.operation_id
            ? {
                ...op,
                stage: 'committed',
                status: 'completed',
                progress_percent: 100,
                log_lines: [
                  ...(op.log_lines || []),
                  `[${new Date().toLocaleTimeString()}] 全部文件写入完成，更新本地 SQLite 索引基线 [OK]`,
                  `[${new Date().toLocaleTimeString()}] 事务提交完成 (COMMITTED)`,
                ],
              }
            : op
        )
      );

      // Register or update installed mods list
      setInstalledMods((prev) => {
        const existing = prev.find((m) => m.mod_id === plan.mod_id);
        if (existing) {
          return prev.map((m) =>
            m.mod_id === plan.mod_id
              ? {
                  ...m,
                  current_version: version,
                  has_update: false,
                  priority: plan.target_priority ?? m.priority,
                  installed_at: new Date().toISOString(),
                }
              : m
          );
        } else {
          return [
            {
              mod_id: plan.mod_id,
              title: modTitle,
              author_name: targetMod?.author.display_name || 'Community',
              category: targetMod?.category || 'submod',
              current_version: version,
              latest_available_version: version,
              has_update: false,
              priority: plan.target_priority ?? 10,
              managed: true,
              installed_at: new Date().toISOString(),
              file_count: plan.changes.length,
            },
            ...prev,
          ];
        }
      });

      showToast(`模组「${modTitle}」已成功安装并提交！`, 'success');
    }, 3800);
  };

  // Reauthorize Android SAF
  const handleReauthorizeSaf = (id: string) => {
    showToast('Android SAF 授权桥接尚未通过真机验证，未取得权限。', 'warn');
    return;
    setInstallations((prev) =>
      prev.map((inst) =>
        inst.id === id ? { ...inst, permission_state: 'granted', last_verified_at: new Date().toISOString() } : inst
      )
    );
    showToast('Android SAF 文档树持久访问权限已重新获取！', 'success');
  };

  // Discover MAS Installations
  const handleDiscoverInstallations = () => {
    showToast('MAS 目录探测尚未接入，未扫描设备。', 'warn');
    return;
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      showToast('已扫描设备存储，确认找到 2 个 MAS 游戏目录。', 'info');
    }, 800);
  };

  // Toggle MAS process running state
  const handleToggleGameRunning = () => {
    setInstallations((prev) =>
      prev.map((inst) =>
        inst.id === currentInstallationId
          ? { ...inst, is_running: !inst.is_running }
          : inst
      )
    );
    const willRun = !currentInstallation.is_running;
    showToast(
      willRun
        ? '已模拟 MAS 游戏在前台运行，安装与写入已触发协议阻断！'
        : 'MAS 游戏已退出，文件锁已释放，恢复正常写入。',
      willRun ? 'warn' : 'success'
    );
  };

  // Explicit Adoption of unmanaged mod
  const handleConfirmAdopt = (modId: string, title: string, priority: number) => {
    showToast('未托管模组收养尚未接入，文件未改变。', 'warn');
    return;
    setInstalledMods((prev) =>
      prev.map((m) =>
        m.mod_id === modId
          ? {
              ...m,
              title: title,
              author_name: '本地自制 / 已收养',
              managed: true,
              priority: priority,
              current_version: '1.0.0 (收养基线)',
            }
          : m
      )
    );
    setUnmanagedToAdopt(null);
    showToast(`未托管文件已显式收养为受管模组「${title}」！`, 'success');
  };

  // Apply Priority Change
  const handleApplyPriority = (modId: string, newPriority: number) => {
    showToast('优先级写入尚未接入，文件未改变。', 'warn');
    return;
    setInstalledMods((prev) =>
      prev.map((m) => (m.mod_id === modId ? { ...m, priority: newPriority } : m))
    );
    setModForPriority(null);
    showToast(`优先级已更新至 ${newPriority}，生效层加载序已重新计算。`, 'success');
  };

  // External Change resolution
  const handleResolveDrift = (action: 'backup_and_overwrite' | 'abort' | 'force_overwrite') => {
    if (!driftOperation) return;

    if (action === 'backup_and_overwrite') {
      setOperations((prev) =>
        prev.map((op) =>
          op.operation_id === driftOperation.operation_id
            ? {
                ...op,
                status: 'in_progress',
                stage: 'writing',
                progress_percent: 85,
                failure_reason: undefined,
                log_lines: [
                  ...(op.log_lines || []),
                  `[${new Date().toLocaleTimeString()}] 备份本地改动到 .submodhub_backups/drift_backup/ [OK]`,
                  `[${new Date().toLocaleTimeString()}] 恢复写入事务...`,
                ],
              }
            : op
        )
      );
      setDriftOperation(null);
      showToast('已备份外部修改文件，正在继续写入更新...', 'info');

      setTimeout(() => {
        setOperations((prev) =>
          prev.map((op) =>
            op.operation_id === driftOperation.operation_id
              ? {
                  ...op,
                  status: 'completed',
                  stage: 'committed',
                  progress_percent: 100,
                  log_lines: [
                    ...(op.log_lines || []),
                    `[${new Date().toLocaleTimeString()}] 事务提交完成 (COMMITTED)`,
                  ],
                }
              : op
          )
        );
        showToast('模组已恢复并成功更新！', 'success');
      }, 1500);
    } else if (action === 'abort') {
      setOperations((prev) =>
        prev.map((op) =>
          op.operation_id === driftOperation.operation_id
            ? {
                ...op,
                status: 'rolled_back',
                failure_reason: '用户选择保留外部改动并中止',
                log_lines: [
                  ...(op.log_lines || []),
                  `[${new Date().toLocaleTimeString()}] 用户中止操作，完全保留本地改动文件，安全退出。`,
                ],
              }
            : op
        )
      );
      setDriftOperation(null);
      showToast('已取消本次更新，本地手动修改完整保留。', 'warn');
    } else {
      setOperations((prev) =>
        prev.map((op) =>
          op.operation_id === driftOperation.operation_id
            ? {
                ...op,
                status: 'completed',
                stage: 'committed',
                progress_percent: 100,
                failure_reason: undefined,
                log_lines: [
                  ...(op.log_lines || []),
                  `[${new Date().toLocaleTimeString()}] 强制覆盖本地改动为官方版本 [OK]`,
                ],
              }
            : op
        )
      );
      setDriftOperation(null);
      showToast('已强制以官方发布版本覆盖本地改动。', 'info');
    }
  };

  // Cold restart simulation
  const handleSimulateRestart = (operationId: string) => {
    showToast(`模拟应用冷重启：正在通过 operation_id [${operationId.slice(-8)}] 重建权威状态...`, 'info');
    setTimeout(() => {
      showToast('重连成功：会话状态已自本地 SQLite 完整还原。', 'success');
    }, 600);
  };

  // Export logs simulation
  const handleExportLogs = (operationId?: string) => {
    showToast('审计日志包已导出至 /sdcard/Download/submodhub_logs_20261003.zip', 'success');
  };

  // Restore snapshot backup
  const handleRestoreBackup = (backupName: string) => {
    showToast(`正在从备份快照 [${backupName}] 原子恢复游戏目录...`, 'info');
    setTimeout(() => {
      showToast(`已成功将游戏目录还原至快照点状态！`, 'success');
    }, 1000);
  };

  const updatesCount = installedMods.filter((m) => m.has_update).length;
  const hasRunningOps = operations.some((o) => o.status === 'in_progress');
  const hasPermissionIssue = currentInstallation.permission_state !== 'granted';

  return (
    <AndroidFrame activeTab={activeTab}>
      {/* Top App Bar */}
      <TopAppBar
        currentInstallation={currentInstallation}
        onOpenInstancePicker={() => showToast('SAF 实例选择尚未通过真机验证。', 'warn')}
        onRefreshCatalog={() => {
          void loadCatalog();
        }}
        isRefreshing={isRefreshing}
        offlineMode={offlineMode}
      />

      {/* Screen Body Viewport */}
      <main className="flex-1 relative overflow-hidden flex flex-col bg-slate-900">
        {activeTab === 'catalog' && (
          <CatalogTab
            mods={mods}
            currentInstallation={currentInstallation}
            onSelectMod={(mod) => setSelectedModForDetail(mod)}
            offlineMode={offlineMode}
          />
        )}

        {activeTab === 'installed' && (
          <InstalledTab
            installedMods={installedMods}
            currentInstallation={currentInstallation}
            allMods={mods}
            onSelectModById={(modId) => {
              const found = mods.find((m) => m.id === modId);
              if (found) setSelectedModForDetail(found);
            }}
            onRequestUpdatePlan={(modId) => {
              const found = mods.find((m) => m.id === modId);
              if (found) {
                const plan = generateSamplePlan(found, found.latest_version_id, currentInstallation);
                setActivePlan(plan);
              }
            }}
            onOpenAdoptModal={(unmanaged) => setUnmanagedToAdopt(unmanaged)}
            onOpenPriorityModal={(mod) => setModForPriority(mod)}
            onRequestUninstallPlan={(mod) => {
              showToast(`已生成卸载计划：将移除 ${mod.title} 并保留备份。`, 'info');
            }}
          />
        )}

        {activeTab === 'operations' && (
          <OperationsTab
            operations={operations}
            onOpenDriftModal={(op) => setDriftOperation(op)}
            onSimulateRestart={handleSimulateRestart}
            onExportLogs={handleExportLogs}
            onRetryOperation={(opId) => {
              showToast(`已重新启动操作 ID: ${opId}`, 'info');
            }}
          />
        )}

        {activeTab === 'storage' && (
          <StorageTab
            installations={installations}
            currentInstallationId={currentInstallationId}
            onSelectInstallation={(id) => setCurrentInstallationId(id)}
            onReauthorizeSaf={handleReauthorizeSaf}
            onDiscoverInstallations={handleDiscoverInstallations}
            onToggleGameRunning={handleToggleGameRunning}
            onRestoreBackup={handleRestoreBackup}
            onExportLogs={() => handleExportLogs()}
          />
        )}
      </main>

      {/* Bottom Navigation Bar */}
      <BottomNavBar
        activeTab={activeTab}
        onSelectTab={(tab) => {
          if (tab === 'catalog') setActiveTab(tab);
          else showToast('本地安装与操作服务尚未接入。', 'warn');
        }}
        hasUpdatesCount={updatesCount}
        hasRunningOperations={hasRunningOps}
        hasPermissionIssue={hasPermissionIssue}
      />

      {/* Mod Detail Slide-up Modal */}
      {selectedModForDetail && (
        <ModDetailModal
          mod={selectedModForDetail}
          currentInstallation={currentInstallation}
          installedMods={installedMods}
          onClose={() => setSelectedModForDetail(null)}
          onRequestPlan={handleRequestPlan}
        />
      )}

      {/* Plan Preview Sheet (The Core Contract Verification Sheet) */}
      {activePlan && (
        <InstallPlanSheet
          plan={activePlan}
          installation={currentInstallation}
          onClose={() => setActivePlan(null)}
          onConfirmApply={handleConfirmApplyPlan}
        />
      )}

      {/* External Change / Drift Resolution Dialog */}
      {driftOperation && (
        <ExternalChangeModal
          operation={driftOperation}
          onClose={() => setDriftOperation(null)}
          onResolve={handleResolveDrift}
        />
      )}

      {/* Adopt Unmanaged Mod Dialog */}
      {unmanagedToAdopt && (
        <AdoptModal
          unmanagedMod={unmanagedToAdopt}
          onClose={() => setUnmanagedToAdopt(null)}
          onConfirmAdopt={handleConfirmAdopt}
        />
      )}

      {/* Priority Adjustment Preview Dialog */}
      {modForPriority && (
        <PriorityModal
          mod={modForPriority}
          allInstalledMods={installedMods}
          installation={currentInstallation}
          onClose={() => setModForPriority(null)}
          onApplyPriority={handleApplyPriority}
        />
      )}

      {/* Instance Picker Modal */}
      <InstancePickerModal
        isOpen={isInstancePickerOpen}
        installations={installations}
        currentInstallationId={currentInstallationId}
        onClose={() => setIsInstancePickerOpen(false)}
        onSelect={(id) => setCurrentInstallationId(id)}
        onDiscover={handleDiscoverInstallations}
        onReauthorize={handleReauthorizeSaf}
      />


      {/* Toast Notification Alert */}
      {toast && (
        <div className="absolute top-16 left-4 right-4 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          <div
            className={`px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2.5 text-xs font-medium border ${
              toast.type === 'success'
                ? 'bg-emerald-950/90 text-emerald-200 border-emerald-700/80 shadow-emerald-950/40'
                : toast.type === 'warn'
                ? 'bg-amber-950/90 text-amber-200 border-amber-700/80 shadow-amber-950/40'
                : 'bg-slate-800/90 text-slate-100 border-slate-700 shadow-slate-950/40'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : toast.type === 'warn' ? (
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            ) : (
              <Info className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span className="flex-1 leading-snug">{toast.message}</span>
          </div>
        </div>
      )}
    </AndroidFrame>
  );
}
