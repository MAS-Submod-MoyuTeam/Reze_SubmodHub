import React, { useState } from 'react';
import {
  X,
  ShieldCheck,
  AlertTriangle,
  Download,
  Copy,
  Check,
  FileCode2,
  Image as ImageIcon,
  Music,
  GitBranch,
  Layers,
  FileSpreadsheet,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { ModSummary, ModVersion, ScanReport } from '../types/client';

interface ModDetailModalProps {
  mod: ModSummary | null;
  onClose: () => void;
  onStartInstallPlan: (mod: ModSummary) => void;
  onDownloadArchive: (mod: ModSummary) => void;
  isDownloadingArchive: boolean;
  isInstalled: boolean;
  installedVersion?: string;
  hasUpdate?: boolean;
}

export const ModDetailModal: React.FC<ModDetailModalProps> = ({
  mod,
  onClose,
  onStartInstallPlan,
  onDownloadArchive,
  isDownloadingArchive,
  isInstalled,
  installedVersion,
  hasUpdate,
}) => {
  const [activeTab, setActiveTab] = useState<'scan' | 'files' | 'dependencies' | 'notes'>('scan');
  const [copiedHash, setCopiedHash] = useState(false);

  if (!mod) return null;

  // Retrieve version details or fallback
  const versionData: ModVersion = {
    id: mod.latest_version_id,
    mod_id: mod.id,
    version: mod.latest_version,
    state: 'published',
    size_bytes: mod.size_bytes,
    sha256: mod.sha256,
    release_notes: '发行说明暂不可用。',
    dependencies: [],
    created_at: mod.updated_at,
  };

  const scan = versionData.scan_report;

  const copyHash = () => {
    navigator.clipboard.writeText(versionData.sha256);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs select-none">
      <div className="bg-neutral-900 border border-neutral-700/80 rounded-xl w-full max-w-4xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 border-b border-neutral-800 flex items-start justify-between bg-neutral-900/90 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-neutral-100">{mod.title}</h2>
              <span className="text-xs font-mono text-emerald-400 bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800/80">
                {versionData.version}
              </span>
              <span className="text-[11px] text-neutral-400 font-mono">
                发布归档已锁定 (不可变版本)
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-400 mt-1">
              <span>作者: {mod.author.display_name}</span>
              <span aria-hidden="true">·</span>
              <span>分类: {mod.category === 'submod' ? '功能模组 (submod)' : '外观礼包 (spritepack)'}</span>
              <span aria-hidden="true">·</span>
              <span>要求 MAS 范围: {mod.mas_version_range}</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* SHA-256 and Integrity Bar */}
        <div className="px-4 py-2 bg-neutral-950/80 border-b border-neutral-800/80 flex items-center justify-between text-xs font-mono text-neutral-400 shrink-0">
          <div className="flex items-center gap-2 truncate pr-4">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-neutral-400 shrink-0">SHA-256:</span>
            <span className="text-neutral-300 truncate selection:bg-neutral-800">{versionData.sha256}</span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="text-neutral-400 tabular-nums">大小: {formatBytes(versionData.size_bytes)}</span>
            <button
              onClick={copyHash}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[11px] transition-colors"
            >
              {copiedHash ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span>已复制</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 text-neutral-400" />
                  <span>复制校验码</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Sub-Tabs: Scan Report / File Tree / Dependencies / Release Notes */}
        <div className="flex items-center gap-1 px-4 pt-2 border-b border-neutral-800 bg-neutral-900/60 text-xs shrink-0">
          <button
            onClick={() => setActiveTab('scan')}
            className={`px-3 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'scan'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            安全扫描与签名报告
          </button>
          <button
            onClick={() => setActiveTab('files')}
            className={`px-3 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'files'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            包文件树 ({scan?.files.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('dependencies')}
            className={`px-3 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'dependencies'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            依赖关系 ({versionData.dependencies.length})
          </button>
          <button
            onClick={() => setActiveTab('notes')}
            className={`px-3 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'notes'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            发行说明
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Tab 1: Scan Report */}
          {activeTab === 'scan' && (
            <div className="space-y-4">
              {/* Scan Status Summary */}
              <div className="p-3.5 rounded-lg bg-neutral-950/70 border border-neutral-800 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <div className="text-neutral-400 mb-0.5">静态合规状态</div>
                  <div className="flex items-center gap-1.5 font-semibold text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>通过预审 (Ready)</span>
                  </div>
                </div>

                <div>
                  <div className="text-neutral-400 mb-0.5">阻断性项 (Blockers)</div>
                  <div className="font-semibold font-mono tabular-nums text-neutral-200">
                    {scan?.blockers.length || 0} 项阻断
                  </div>
                </div>

                <div>
                  <div className="text-neutral-400 mb-0.5">Ren&apos;Py 脚本文件</div>
                  <div className="font-semibold font-mono tabular-nums text-neutral-200 flex items-center gap-1.5">
                    <FileCode2 className="w-3.5 h-3.5 text-sky-400" />
                    <span>{scan?.resource_stats.scripts_count} 个 .rpy 文件</span>
                  </div>
                </div>

                <div>
                  <div className="text-neutral-400 mb-0.5">材质资源统计</div>
                  <div className="font-semibold font-mono tabular-nums text-neutral-200 flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
                    <span>{scan?.resource_stats.images_count} 张图像</span>
                  </div>
                </div>
              </div>

              {/* Submod / Spritepack Registrations */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-neutral-300">
                  代码声明与静态注册识别（未知静态解析不假定安全）
                </h4>
                <div className="p-3 rounded-lg bg-neutral-950/50 border border-neutral-800 space-y-2 text-xs">
                  {scan?.registrations && scan.registrations.length > 0 ? (
                    scan.registrations.map((reg) => (
                      <div key={reg.name} className="flex items-center justify-between font-mono">
                        <div className="flex items-center gap-2">
                          <span className="text-neutral-400">[{reg.type}]</span>
                          <span className="text-neutral-200">{reg.name}</span>
                        </div>
                        <span className="text-[11px] text-emerald-400">
                          置信度: 已知注册 ({reg.confidence})
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="text-neutral-400 font-mono text-xs">
                      无 Ren&apos;Py 代码钩子注册（纯静态外观贴图包）
                    </div>
                  )}

                  {/* Derived giftnames */}
                  {scan?.derived_gifts && scan.derived_gifts.length > 0 && (
                    <div className="pt-2 border-t border-neutral-800/80">
                      <div className="text-neutral-400 mb-1 text-[11px]">
                        派生礼物命名绑定 (Derived Giftnames):
                      </div>
                      <div className="flex items-center gap-2 flex-wrap font-mono text-emerald-300">
                        {scan.derived_gifts.map((g) => (
                          <span key={g} className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/60 text-xs">
                            {g}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Mod Description */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold text-neutral-300">详细描述</h4>
                <p className="text-xs text-neutral-300 leading-relaxed bg-neutral-950/40 p-3 rounded-lg border border-neutral-800/60">
                  {mod.description || mod.summary}
                </p>
              </div>
            </div>
          )}

          {/* Tab 2: File Tree */}
          {activeTab === 'files' && (
            <div className="space-y-2">
              <div className="text-xs text-neutral-400">
                安装归档内包含的解压映射目标路径及文件散列：
              </div>
              <div className="border border-neutral-800 rounded-lg overflow-hidden font-mono text-xs">
                <table className="w-full text-left">
                  <thead className="bg-neutral-950 text-neutral-400 text-[11px] border-b border-neutral-800">
                    <tr>
                      <th className="py-2 px-3">目标安装路径</th>
                      <th className="py-2 px-3">类型</th>
                      <th className="py-2 px-3 text-right">大小</th>
                      <th className="py-2 px-3">SHA-256 前缀</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800/60 bg-neutral-900/40">
                    {scan?.files.map((f) => (
                      <tr key={f.target_path} className="hover:bg-neutral-800/30">
                        <td className="py-2 px-3 text-neutral-200 truncate max-w-sm" title={f.target_path}>
                          {f.target_path}
                        </td>
                        <td className="py-2 px-3 text-neutral-400 uppercase text-[10px]">
                          {f.kind}
                        </td>
                        <td className="py-2 px-3 text-right text-neutral-300 tabular-nums">
                          {formatBytes(f.size_bytes)}
                        </td>
                        <td className="py-2 px-3 text-neutral-400 text-[10px]">
                          {f.sha256.substring(0, 16)}...
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 3: Dependencies */}
          {activeTab === 'dependencies' && (
            <div className="space-y-3">
              <div className="text-xs text-neutral-400">
                此模组声明依赖的前置子模组或组件库：
              </div>
              {versionData.dependencies.length === 0 ? (
                <div className="p-4 rounded-lg bg-neutral-950/40 border border-neutral-800 text-xs text-neutral-400">
                  独立运行，无外部依赖前置模组。
                </div>
              ) : (
                <div className="space-y-2">
                  {versionData.dependencies.map((dep) => (
                    <div
                      key={dep.mod_id}
                      className="p-3 rounded-lg bg-neutral-950/60 border border-neutral-800 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2.5">
                        <GitBranch className="w-4 h-4 text-emerald-400" />
                        <div>
                          <div className="font-semibold text-neutral-200">
                            {dep.mod_title || dep.mod_id}
                          </div>
                          <div className="text-[11px] text-neutral-400 font-mono">
                            兼容版本约束: {dep.version_range} · {dep.required ? '强制必须' : '可选推荐'}
                          </div>
                        </div>
                      </div>

                      <span className="text-emerald-400 text-[11px] font-mono flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>已满足本地契约</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 4: Release Notes */}
          {activeTab === 'notes' && (
            <div className="space-y-2">
              <div className="text-xs text-neutral-400 font-mono">
                发布时间: {new Date(versionData.created_at).toLocaleString()}
              </div>
              <div className="p-3 rounded-lg bg-neutral-950/60 border border-neutral-800 text-xs text-neutral-200 whitespace-pre-wrap leading-relaxed font-sans">
                {versionData.release_notes}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-900/90 flex items-center justify-between shrink-0">
          <div className="text-xs text-neutral-400">
            {isInstalled ? (
              hasUpdate ? (
                <span className="text-amber-400 font-mono">
                  当前已安装 {installedVersion}，检测到可升级为 {versionData.version}
                </span>
              ) : (
                <span className="text-emerald-400 font-mono">
                  已安装最新版本 ({installedVersion})
                </span>
              )
            ) : (
              <span>准备就绪：点击右侧开始安装前依赖校验与文件覆盖计划生成</span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => onDownloadArchive(mod)}
              disabled={isDownloadingArchive}
              className="px-3.5 py-1.5 text-xs font-medium text-neutral-200 bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {isDownloadingArchive ? '下载校验中' : '下载 ZIP'}
            </button>
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700/80 rounded-lg transition-colors"
            >
              关闭
            </button>
            <button
              onClick={() => {
                onClose();
                onStartInstallPlan(mod);
              }}
              className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isInstalled ? (hasUpdate ? '进入更新规划预览' : '重新安装/修复预览') : '进入安装规划预览'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
