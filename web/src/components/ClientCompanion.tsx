import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Installation, InstallationPlan } from '../types/submodhub';
import {
  Laptop,
  Smartphone,
  ShieldCheck,
  AlertTriangle,
  Play,
  RotateCcw,
  CheckCircle2,
  FolderOpen,
  ArrowRight,
  FileCode,
  HardDrive,
  DownloadCloud,
  FileCheck2,
  History,
  AlertCircle,
  FileText,
  Sliders,
} from 'lucide-react';

export const ClientCompanion: React.FC = () => {
  const {
    installations,
    activeInstallationId,
    setActiveInstallationId,
    installedMods,
    currentPlan,
    operations,
    applyPlan,
    simulateExternalChange,
    adoptUnmanagedMod,
    clearCurrentPlan,
    previewInstallPlan,
    showToast,
  } = useApp();

  const [activeClientTab, setActiveClientTab] = useState<'installations' | 'installed' | 'operations' | 'plan'>('installed');
  const [selectedPriorityModId, setSelectedPriorityModId] = useState<string | null>(null);
  const [priorityDelta, setPriorityDelta] = useState<number>(0);

  const activeInstallation = installations.find((i) => i.id === activeInstallationId) || installations[0];

  const handleSimulateGameRunning = () => {
    showToast('error', '阻断：检测到 Monika After Story (DDLC.exe) 正在运行，写入已暂停！', 'game_running');
  };

  const handleSimulateSAFRevoke = () => {
    showToast('error', 'Android SAF 存储授权被系统撤销，需重新发起目录授权。', 'permission_lost');
  };

  const handleSimulateDriftTest = () => {
    simulateExternalChange('game/Submods/ExtraEverything/ee_core.rpy');
    setActiveClientTab('operations');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Top Banner */}
      <div className="bg-white border border-neutral-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <span className="font-semibold text-neutral-900">
              {activeInstallation.platform === 'android' ? 'Android 端 (SAF 架构)' : 'Windows 端 (Wails v3 架构)'}
            </span>
            <span>·</span>
            <span>SubmodHub 客户端 Go 契约运行仿真器</span>
          </div>
          <h1 className="text-lg font-bold text-neutral-900 tracking-tight mt-0.5">
            MAS 实例授权、安装预览计划 (Plan) 与外部哈希防漂移护栏
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            双端共享统一业务 DTO；文件写入前强制生成变更层计划，杜绝意外覆写玩家私有脚本
          </p>
        </div>

        {/* Tab Controls */}
        <div className="flex flex-wrap items-center gap-1.5 bg-neutral-100 p-0.5 rounded text-xs font-medium">
          <button
            onClick={() => setActiveClientTab('installed')}
            className={`px-3 py-1.5 rounded transition-colors ${
              activeClientTab === 'installed' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600'
            }`}
          >
            已安装与托管 ({installedMods.length})
          </button>
          <button
            onClick={() => setActiveClientTab('plan')}
            className={`px-3 py-1.5 rounded transition-colors ${
              activeClientTab === 'plan' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600'
            }`}
          >
            安装计划预览 {currentPlan && '(1 个待确认)'}
          </button>
          <button
            onClick={() => setActiveClientTab('operations')}
            className={`px-3 py-1.5 rounded transition-colors ${
              activeClientTab === 'operations' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600'
            }`}
          >
            操作状态机与恢复 ({operations.length})
          </button>
          <button
            onClick={() => setActiveClientTab('installations')}
            className={`px-3 py-1.5 rounded transition-colors ${
              activeClientTab === 'installations' ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600'
            }`}
          >
            游戏目录与授权
          </button>
        </div>
      </div>

      {/* Active Installation Quick Bar */}
      <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          {activeInstallation.platform === 'android' ? (
            <Smartphone className="w-4 h-4 text-emerald-700 shrink-0" />
          ) : (
            <Laptop className="w-4 h-4 text-neutral-700 shrink-0" />
          )}
          <div>
            <div className="font-semibold text-neutral-900 flex items-center gap-2">
              <span>{activeInstallation.label}</span>
              <span className="font-mono text-[11px] text-neutral-500">
                MAS {activeInstallation.mas_version}
              </span>
            </div>
            <div className="text-[11px] text-neutral-500 font-mono truncate max-w-md">
              {activeInstallation.path_hint}
            </div>
          </div>
        </div>

        {/* Sandbox Edge State Triggers */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSimulateGameRunning}
            className="px-2.5 py-1 text-[11px] text-neutral-700 bg-white hover:bg-neutral-100 rounded border border-neutral-200"
          >
            测试「游戏运行中阻断」
          </button>
          <button
            onClick={handleSimulateDriftTest}
            className="px-2.5 py-1 text-[11px] text-rose-700 bg-rose-50 hover:bg-rose-100 rounded border border-rose-200"
          >
            测试「文件哈希外部漂移」
          </button>
        </div>
      </div>

      {/* Main Tab Content */}
      {activeClientTab === 'installed' && (
        /* Installed Mods & Unmanaged Detection List */
        <div className="bg-white border border-neutral-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-neutral-900">
                已安装模组与未托管扫描 (ListInstalled 契约)
              </h2>
              <p className="text-xs text-neutral-500">
                规范明确要求：严格区分「已托管」与「未托管」模组。未托管模组不提供直接卸载，仅允许查看或显式收养。
              </p>
            </div>
            <span className="text-xs font-mono text-neutral-400">
              共 {installedMods.length} 个模组实例
            </span>
          </div>

          <div className="divide-y divide-neutral-100">
            {installedMods.map((mod) => (
              <div key={mod.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-neutral-900">{mod.title}</span>
                    <span className="font-mono text-neutral-500">v{mod.version}</span>
                    {mod.is_managed ? (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                        SubmodHub 托管
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                        未托管本地脚本 (仅查看/收养)
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-neutral-400 flex items-center gap-3">
                    <span>生效层优先级: <strong className="font-mono text-neutral-700">{mod.priority}</strong></span>
                    <span>安装时间: {new Date(mod.installed_at).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {mod.is_managed ? (
                    <>
                      {mod.has_update && (
                        <button
                          onClick={() => {
                            previewInstallPlan(mod.mod_id, 'ver_ee_130_draft');
                            setActiveClientTab('plan');
                          }}
                          className="px-2.5 py-1 text-xs text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200 font-medium"
                        >
                          更新至 {mod.update_version}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          showToast('info', `优先级调整预览 (PreviewPriority)：将模组 ${mod.title} 优先级设为 ${mod.priority + 10}，正在计算哪些文件会发生生效层切换...`);
                        }}
                        className="px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-100 rounded border border-neutral-200"
                      >
                        调整优先级
                      </button>
                      <button
                        onClick={() => {
                          showToast('warning', `正在生成卸载计划 (PreviewUninstall)：计算需要移除的目标文件及恢复备份清单...`);
                        }}
                        className="px-2.5 py-1 text-xs text-neutral-600 hover:text-rose-700 hover:bg-rose-50 rounded border border-neutral-200"
                      >
                        卸载
                      </button>
                    </>
                  ) : (
                    /* Unmanaged mod: Explicit Adoption workflow as per spec */
                    <button
                      onClick={() => adoptUnmanagedMod(mod.mod_id)}
                      className="px-3 py-1 text-xs font-medium text-amber-900 bg-amber-50 hover:bg-amber-100 rounded border border-amber-200 flex items-center gap-1"
                    >
                      <ShieldCheck className="w-3.5 h-3.5 text-amber-700" />
                      显式收养至托管系统
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeClientTab === 'plan' && (
        /* Installation Plan Preview (PreviewInstall contract) */
        <div className="bg-white border border-neutral-200 rounded-lg p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-neutral-900">
                安装/更新计划预览 (PreviewInstall / Plan DTO)
              </h2>
              <p className="text-xs text-neutral-500">
                规范硬性要求：无直接写入；仅在阻断项为空、权限有效且 MAS 未运行时才允许用户显式确认。
              </p>
            </div>
            {currentPlan && (
              <span className="text-xs font-mono text-neutral-400">
                Plan ID: {currentPlan.plan_id}
              </span>
            )}
          </div>

          {!currentPlan ? (
            <div className="py-12 text-center border border-dashed border-neutral-200 rounded-lg space-y-3">
              <HardDrive className="w-8 h-8 text-neutral-300 mx-auto" />
              <p className="text-xs text-neutral-500">当前没有处于待确认状态的安装计划。</p>
              <button
                onClick={() => previewInstallPlan('mod_extra_everything', 'ver_ee_130_draft')}
                className="px-3.5 py-1.5 text-xs font-medium text-white bg-neutral-900 hover:bg-neutral-800 rounded transition-colors"
              >
                生成 [Extra Everything 1.3.0] 安装预览计划
              </button>
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              {/* Plan Metadata */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-neutral-50 p-3.5 rounded border border-neutral-200 font-mono text-xs">
                <div>
                  <div className="text-[10px] text-neutral-400">目标模组</div>
                  <div className="font-semibold text-neutral-800 truncate">{currentPlan.mod_id}</div>
                </div>
                <div>
                  <div className="text-[10px] text-neutral-400">所需下载与解压容量</div>
                  <div className="font-semibold text-neutral-800 tabular-nums">
                    {(currentPlan.bytes_required / 1024 / 1024).toFixed(2)} MB
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-neutral-400">备份文件数</div>
                  <div className="font-semibold text-neutral-800 tabular-nums">
                    {currentPlan.backups_required.length} 项
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-neutral-400">准备状态</div>
                  <div
                    className={`font-semibold ${
                      currentPlan.is_ready_to_apply ? 'text-emerald-700' : 'text-rose-700'
                    }`}
                  >
                    {currentPlan.is_ready_to_apply ? '校验通过 (就绪)' : '存在阻断项'}
                  </div>
                </div>
              </div>

              {/* Blockers */}
              {currentPlan.dependency_blockers.length > 0 && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-900 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-rose-700" />
                    依赖阻断 (Dependency Blockers):
                  </div>
                  <ul className="list-disc list-inside">
                    {currentPlan.dependency_blockers.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* File Changes Table */}
              <div className="space-y-2">
                <h4 className="font-semibold text-neutral-800">即将生效的文件系统变更层 (Changes):</h4>
                <div className="border border-neutral-200 rounded overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500">
                      <tr>
                        <th className="py-2 px-3">目标文件路径</th>
                        <th className="py-2 px-3">动作</th>
                        <th className="py-2 px-3">归属模组</th>
                        <th className="py-2 px-3">变更原因</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {currentPlan.changes.map((c, i) => (
                        <tr key={i} className="hover:bg-neutral-50">
                          <td className="py-2 px-3 font-mono text-[11px] text-neutral-800">
                            {c.target_path}
                          </td>
                          <td className="py-2 px-3">
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 uppercase font-semibold">
                              {c.action}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono text-neutral-600 text-[11px]">
                            {c.next_owner}
                          </td>
                          <td className="py-2 px-3 text-neutral-500 text-[11px]">{c.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Plan Action Bar */}
              <div className="pt-3 border-t border-neutral-100 flex items-center justify-between">
                <button
                  onClick={clearCurrentPlan}
                  className="px-3 py-1.5 text-neutral-600 hover:text-neutral-900"
                >
                  放弃计划
                </button>
                <button
                  disabled={!currentPlan.is_ready_to_apply}
                  onClick={() => {
                    applyPlan(currentPlan);
                    setActiveClientTab('operations');
                  }}
                  className={`px-4 py-1.5 font-medium rounded text-white flex items-center gap-1.5 transition-colors shadow-xs ${
                    currentPlan.is_ready_to_apply
                      ? 'bg-emerald-700 hover:bg-emerald-800'
                      : 'bg-neutral-300 text-neutral-500 cursor-not-allowed'
                  }`}
                >
                  <Play className="w-3.5 h-3.5" />
                  确认应用并执行写入 (ApplyPlan)
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeClientTab === 'operations' && (
        /* Operation Progress & External Change Recovery (Section 4 & 5) */
        <div className="bg-white border border-neutral-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-neutral-900">
                操作状态机、进度跟踪与断点恢复 (Operation State Machine)
              </h2>
              <p className="text-xs text-neutral-500">
                状态序列：planned → downloading → scanning → backed_up → writing → committed。失败时提供可恢复/回滚路径。
              </p>
            </div>
          </div>

          {operations.length === 0 ? (
            <div className="py-12 text-center text-xs text-neutral-400">
              当前暂无正在执行或历史操作记录。在「安装计划预览」中点击确认即可启动流水线。
            </div>
          ) : (
            <div className="space-y-4">
              {operations.map((op) => {
                const isBlocked = op.state === 'blocked';
                const isCommitted = op.state === 'committed';

                return (
                  <div
                    key={op.operation_id}
                    className={`p-4 rounded-lg border text-xs space-y-3 ${
                      isBlocked
                        ? 'border-rose-300 bg-rose-50/50'
                        : isCommitted
                        ? 'border-emerald-200 bg-emerald-50/40'
                        : 'border-neutral-200 bg-neutral-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-neutral-900">{op.mod_title}</span>
                        <span className="font-mono text-neutral-500">v{op.version}</span>
                        <span
                          className={`font-mono text-[10px] px-2 py-0.5 rounded font-semibold ${
                            isCommitted
                              ? 'bg-emerald-100 text-emerald-800'
                              : isBlocked
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-sky-100 text-sky-800'
                          }`}
                        >
                          阶段: {op.state.toUpperCase()}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-neutral-400">
                        Op ID: {op.operation_id}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] text-neutral-500">
                        <span>{op.current_file}</span>
                        <span className="font-mono tabular-nums">{op.progress_percent}%</span>
                      </div>
                      <div className="w-full bg-neutral-200 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            isBlocked ? 'bg-rose-600' : 'bg-emerald-600'
                          }`}
                          style={{ width: `${op.progress_percent}%` }}
                        />
                      </div>
                    </div>

                    {/* External Change Drift Warning Banner (Section 4 & 5 contract) */}
                    {op.error_code === 'external_change' && op.external_change_details && (
                      <div className="p-3 bg-white border border-rose-200 rounded text-rose-950 space-y-2">
                        <div className="font-bold flex items-center gap-1.5 text-xs text-rose-700">
                          <AlertTriangle className="w-4 h-4" />
                          已触发 external_change 安全护栏：文件哈希外部漂移！
                        </div>
                        <p className="text-[11px] text-neutral-600 leading-relaxed">
                          目标路径在安装期间检测到预料之外的磁盘修改。规范规定：
                          <strong>禁止静默覆盖用户手动文件</strong>，必须展示预期哈希与实测哈希供用户决定。
                        </p>
                        <div className="font-mono text-[11px] space-y-1 bg-neutral-50 p-2 rounded border border-neutral-200">
                          <div>
                            <span className="text-neutral-400">受阻路径: </span>
                            <span className="text-neutral-900">{op.external_change_details.path}</span>
                          </div>
                          <div>
                            <span className="text-neutral-400">预期哈希: </span>
                            <span className="text-emerald-700">{op.external_change_details.expected_hash}</span>
                          </div>
                          <div>
                            <span className="text-neutral-400">实测哈希: </span>
                            <span className="text-rose-700">{op.external_change_details.actual_hash}</span>
                          </div>
                        </div>

                        <div className="pt-1 flex items-center justify-end gap-2 text-xs">
                          <button
                            onClick={() => {
                              showToast('info', '已保留本地外部修改文件，放弃写入并安全回滚计划。');
                            }}
                            className="px-3 py-1 text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded"
                          >
                            保留本地修改 (回滚操作)
                          </button>
                          <button
                            onClick={() => {
                              showToast('warning', '已对用户修改文件创建独立安全副本 (.bak)，继续强制覆盖。');
                            }}
                            className="px-3 py-1 text-white bg-rose-700 hover:bg-rose-800 rounded font-medium"
                          >
                            备份本地修改并覆盖
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeClientTab === 'installations' && (
        /* Installations & Android SAF Permissions Management */
        <div className="bg-white border border-neutral-200 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-neutral-900">
                多 MAS 安装实例管理与存储授权 (ListInstallations)
              </h2>
              <p className="text-xs text-neutral-500">
                支持管理多个游戏实例与沙箱副本；Android 端严格监控 SAF 持久授权状态，未验证目录不得执行写入。
              </p>
            </div>
            <button
              onClick={() => {
                showToast('info', '正在通过原生平台文件选择器探测 MAS 安装根目录...');
              }}
              className="px-3 py-1.5 text-xs font-medium text-neutral-800 bg-neutral-100 hover:bg-neutral-200 rounded"
            >
              + 手选新 MAS 目录
            </button>
          </div>

          <div className="space-y-3">
            {installations.map((inst) => {
              const isSelected = inst.id === activeInstallationId;

              return (
                <div
                  key={inst.id}
                  className={`p-4 rounded-lg border text-xs transition-all space-y-2 ${
                    isSelected
                      ? 'border-neutral-900 bg-neutral-50/70'
                      : 'border-neutral-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {inst.platform === 'android' ? (
                        <Smartphone className="w-4 h-4 text-emerald-700" />
                      ) : (
                        <Laptop className="w-4 h-4 text-neutral-700" />
                      )}
                      <span className="font-semibold text-neutral-900">{inst.label}</span>
                      <span className="font-mono text-neutral-500">MAS {inst.mas_version}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        授权状态: {inst.permission_state}
                      </span>
                      {!isSelected && (
                        <button
                          onClick={() => {
                            setActiveInstallationId(inst.id);
                            showToast('success', `已切换当前操作实例为: ${inst.label}`);
                          }}
                          className="px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-100 rounded border border-neutral-200"
                        >
                          设为当前实例
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="font-mono text-[11px] text-neutral-500 bg-white p-2 rounded border border-neutral-200 truncate">
                    {inst.path_hint}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
