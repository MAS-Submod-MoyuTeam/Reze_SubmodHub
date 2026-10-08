import React, { useState } from 'react';
import {
  PackageCheck,
  FileQuestion,
  RefreshCw,
  Trash2,
  Wrench,
  ShieldCheck,
  AlertTriangle,
  Layers,
  ArrowUpRight,
  ExternalLink,
  CheckCircle2,
  FolderOpen,
  Info,
} from 'lucide-react';
import { InstalledItem, ModSummary } from '../types/client';

interface InstalledViewProps {
  installedMods: InstalledItem[];
  onStartUpdatePlan: (modSummary: ModSummary) => void;
  onStartUninstallPlan: (installedItem: InstalledItem) => void;
  onStartRepairPlan: (installedItem: InstalledItem) => void;
  onOpenAdoptModal: (unmanagedItem: InstalledItem) => void;
  onInspectFiles: (item: InstalledItem) => void;
  onCheckAllUpdates: () => void;
  onVerifyIntegrity: () => void;
  isVerifying: boolean;
}

export const InstalledView: React.FC<InstalledViewProps> = ({
  installedMods,
  onStartUpdatePlan,
  onStartUninstallPlan,
  onStartRepairPlan,
  onOpenAdoptModal,
  onInspectFiles,
  onCheckAllUpdates,
  onVerifyIntegrity,
  isVerifying,
}) => {
  const [subTab, setSubTab] = useState<'managed' | 'unmanaged'>('managed');

  const managedMods = installedMods.filter((m) => m.is_managed);
  const unmanagedMods = installedMods.filter((m) => !m.is_managed);

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-950">
      {/* Top Header & Sub-Tabs */}
      <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2">
          {/* Segmented Tab Controls */}
          <div className="flex items-center gap-1 p-1 bg-neutral-900 border border-neutral-800 rounded-lg text-xs">
            <button
              onClick={() => setSubTab('managed')}
              className={`px-3 py-1 font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                subTab === 'managed'
                  ? 'bg-neutral-800 text-white shadow-xs'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <PackageCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>已托管模组 ({managedMods.length})</span>
            </button>
            <button
              onClick={() => setSubTab('unmanaged')}
              className={`px-3 py-1 font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                subTab === 'unmanaged'
                  ? 'bg-neutral-800 text-white shadow-xs'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <FileQuestion className="w-3.5 h-3.5 text-amber-400" />
              <span>未托管检测结果 ({unmanagedMods.length})</span>
            </button>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={onVerifyIntegrity}
            disabled={isVerifying}
            className="px-3 py-1.5 rounded-lg bg-neutral-800/80 hover:bg-neutral-800 border border-neutral-700/60 text-neutral-300 hover:text-white transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            <ShieldCheck className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin text-emerald-400' : 'text-neutral-400'}`} />
            <span>{isVerifying ? '全量比对哈希中...' : '校验文件完整性'}</span>
          </button>
          <button
            onClick={onCheckAllUpdates}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors flex items-center gap-1.5 shadow-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>检查所有模组更新</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* SUBTAB 1: MANAGED MODS */}
        {subTab === 'managed' && (
          <div className="space-y-3">
            {managedMods.length === 0 ? (
              <div className="p-8 text-center text-neutral-400">
                <PackageCheck className="w-10 h-10 text-neutral-600 mx-auto mb-2" />
                <p>当前 MAS 实例尚未安装任何托管模组。</p>
              </div>
            ) : (
              <div className="border border-neutral-800 rounded-xl overflow-hidden bg-neutral-900/60">
                <table className="w-full text-left text-xs font-sans">
                  <thead className="bg-neutral-950/80 text-neutral-400 text-[11px] border-b border-neutral-800 uppercase tracking-wider font-medium">
                    <tr>
                      <th className="py-2.5 px-4">模组名称 / 作者</th>
                      <th className="py-2.5 px-3">已装版本</th>
                      <th className="py-2.5 px-3">最新版本</th>
                      <th className="py-2.5 px-3">图层优先级</th>
                      <th className="py-2.5 px-3">文件与占用</th>
                      <th className="py-2.5 px-3">完整性</th>
                      <th className="py-2.5 px-4 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/60">
                    {managedMods.map((item) => (
                      <tr key={item.mod_id} className="hover:bg-neutral-800/30 transition-colors">
                        {/* Name and Author */}
                        <td className="py-3 px-4">
                          <div className="font-semibold text-neutral-100">{item.title}</div>
                          <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 mt-0.5">
                            <span>{item.author_name}</span>
                            <span aria-hidden="true">·</span>
                            <span>{item.category === 'submod' ? '功能模组' : '外观包'}</span>
                          </div>
                        </td>

                        {/* Installed Version */}
                        <td className="py-3 px-3 font-mono text-neutral-200">
                          {item.installed_version}
                        </td>

                        {/* Latest Version */}
                        <td className="py-3 px-3 font-mono">
                          {item.has_update ? (
                            <span className="text-amber-400 font-semibold flex items-center gap-1">
                              <span>{item.latest_version}</span>
                              <span className="text-[10px] px-1 py-0.2 bg-amber-950 border border-amber-800 rounded">
                                可更新
                              </span>
                            </span>
                          ) : (
                            <span className="text-neutral-400">{item.latest_version}</span>
                          )}
                        </td>

                        {/* Layer Priority */}
                        <td className="py-3 px-3 font-mono text-neutral-300">
                          <span className="px-2 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-xs">
                            Layer {item.priority}
                          </span>
                        </td>

                        {/* File counts and size */}
                        <td className="py-3 px-3 font-mono text-neutral-400 text-[11px]">
                          <div>{item.files_count} 个托管文件</div>
                          <div className="text-neutral-400 tabular-nums">{formatBytes(item.size_bytes)}</div>
                        </td>

                        {/* Integrity Status */}
                        <td className="py-3 px-3">
                          {item.integrity_status === 'intact' ? (
                            <span className="text-emerald-400 text-[11px] flex items-center gap-1 font-mono">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>未被改动</span>
                            </span>
                          ) : item.integrity_status === 'modified' ? (
                            <span className="text-amber-400 text-[11px] flex items-center gap-1 font-mono">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>检测到外部改动</span>
                            </span>
                          ) : (
                            <span className="text-neutral-400 text-[11px]">待验证</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {item.has_update && (
                              <button
                                onClick={() => {
                                  // Trigger update plan
                                  const dummyMod: ModSummary = {
                                    id: item.mod_id,
                                    title: item.title,
                                    summary: item.summary,
                                    author: { id: 'usr', display_name: item.author_name },
                                    category: item.category,
                                    tags: [],
                                    supported_platforms: ['windows'],
                                    mas_version_range: '>=0.12.0',
                                    recommended_priority: item.priority,
                                    latest_version_id: item.latest_version_id,
                                    latest_version: item.latest_version,
                                    size_bytes: item.size_bytes,
                                    sha256: item.sha256,
                                    updated_at: '2026-10-01T00:00:00Z',
                                    downloads_count: 0,
                                  };
                                  onStartUpdatePlan(dummyMod);
                                }}
                                className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-400 hover:bg-amber-300 text-neutral-900 transition-colors shadow-xs"
                              >
                                规划更新
                              </button>
                            )}

                            <button
                              onClick={() => onInspectFiles(item)}
                              className="px-2 py-1 text-xs text-neutral-300 hover:text-white hover:bg-neutral-800 rounded transition-colors"
                              title="查看该模组托管的所有本地文件路径及哈希"
                            >
                              文件清单
                            </button>

                            <button
                              onClick={() => onStartRepairPlan(item)}
                              className="px-2 py-1 text-xs text-neutral-300 hover:text-white hover:bg-neutral-800 rounded transition-colors"
                              title="校验缺失文件并从发布版本归档重新解压"
                            >
                              修复
                            </button>

                            <button
                              onClick={() => onStartUninstallPlan(item)}
                              className="px-2 py-1 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded transition-colors"
                              title="生成卸载计划，直接删除当前文件，不恢复安装前备份"
                            >
                              卸载
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* SUBTAB 2: UNMANAGED DETECTED ITEMS */}
        {subTab === 'unmanaged' && (
          <div className="space-y-4">
            {/* Spec Compliance Banner */}
            <div className="p-4 rounded-xl bg-neutral-900 border border-neutral-800 text-xs space-y-2">
              <div className="flex items-center gap-2 text-amber-400 font-semibold">
                <Info className="w-4 h-4 shrink-0" />
                <span>SubmodHub 契约保护机制：未托管内容保护原则</span>
              </div>
              <p className="text-neutral-300 leading-relaxed">
                依据 <code>2026-09-25-submodhub-design.md</code> 规范要求：
                未托管内容仅提供<strong>文件查看与显式收养（Adopt）</strong>流程，<strong>不提供直接删除/卸载操作</strong>。
                此举可绝对避免 SubmodHub 客户端误删玩家手写未发布的原创代码、个人修改备份或未经登记的测试资产。
              </p>
            </div>

            {/* Unmanaged items list */}
            <div className="space-y-3">
              {unmanagedMods.map((item) => (
                <div
                  key={item.mod_id}
                  className="p-4 rounded-xl bg-neutral-900/70 border border-neutral-800 flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 text-[10px] rounded bg-amber-950 text-amber-300 border border-amber-800 font-mono">
                        未托管发现项
                      </span>
                      <h4 className="font-semibold text-neutral-100 text-sm">{item.title}</h4>
                    </div>
                    <p className="text-xs text-neutral-400 mt-1 leading-relaxed">{item.summary}</p>

                    <div className="mt-2 space-y-1 font-mono text-[11px] text-neutral-400 bg-neutral-950/60 p-2.5 rounded-lg border border-neutral-800/80">
                      <div className="text-neutral-400">检测到的本地路径 ({item.unmanaged_paths?.length || 0} 个文件):</div>
                      {item.unmanaged_paths?.map((p) => (
                        <div key={p} className="text-neutral-300 truncate">
                          • {p}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                    <button
                      onClick={() => onInspectFiles(item)}
                      className="px-3 py-1.5 text-xs text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700/80 rounded-lg transition-colors"
                    >
                      检查散落散列
                    </button>
                    <button
                      onClick={() => onOpenAdoptModal(item)}
                      className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      <span>显式收养为托管模组 (Adopt)</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
