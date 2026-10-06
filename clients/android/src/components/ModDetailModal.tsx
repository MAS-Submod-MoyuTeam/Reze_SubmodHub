import React, { useState } from 'react';
import { Mod, Installation, InstalledMod } from '../types/submodhub';
import { formatBytes, formatDate, truncateHash } from '../utils/formatters';
import {
  ArrowLeft,
  ShieldCheck,
  AlertTriangle,
  Copy,
  Check,
  Layers,
  FileCode2,
  Package,
  HardDrive,
  Info,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';

interface ModDetailModalProps {
  mod: Mod;
  currentInstallation: Installation;
  installedMods: InstalledMod[];
  onClose: () => void;
  onRequestPlan: (mod: Mod, targetVersionId: string) => void;
}

export const ModDetailModal: React.FC<ModDetailModalProps> = ({
  mod,
  currentInstallation,
  installedMods,
  onClose,
  onRequestPlan,
}) => {
  const [selectedVersionId, setSelectedVersionId] = useState(mod.latest_version_id);
  const [copiedHash, setCopiedHash] = useState(false);

  const currentVersion =
    mod.versions.find((v) => v.id === selectedVersionId) || mod.versions[0];

  const installedRecord = installedMods.find((im) => im.mod_id === mod.id);
  const isInstalled = !!installedRecord;
  const isUpdate = isInstalled && installedRecord.current_version !== currentVersion.version;

  const handleCopyHash = () => {
    navigator.clipboard?.writeText(currentVersion.sha256);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const scanReport = currentVersion.scan_report;
  const hasBlockers = scanReport && scanReport.blockers.length > 0;

  return (
    <div className="absolute inset-0 bg-slate-900 z-40 flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
      {/* Top App Bar */}
      <div className="shrink-0 h-14 px-4 bg-slate-950/95 backdrop-blur-md border-b border-slate-800 flex items-center justify-between">
        <button
          onClick={onClose}
          className="w-10 h-10 -ml-2 rounded-xl flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
          title="返回"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-sm font-semibold text-slate-200 truncate max-w-[240px]">
          {mod.title}
        </span>
        <div className="w-8" /> {/* Balance spacer */}
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24">
        {/* Mod Hero & Core Metadata */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-3xl p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-100 leading-snug">
                {mod.title}
              </h2>
              {/* Zero-Pill Metadata */}
              <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-2 flex-wrap">
                <span className="text-slate-200 font-medium">{mod.author.display_name}</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="capitalize">{mod.category}</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span>更新于 {formatDate(mod.updated_at)}</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-300 mt-3 leading-relaxed">
            {mod.description}
          </p>

          {/* Installation Status Banner if already installed */}
          {isInstalled && (
            <div className="mt-4 p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="text-rose-200">
                  当前已安装版本: <strong className="font-mono">{installedRecord.current_version}</strong>
                  {isUpdate && ' (检测到新版本)'}
                </span>
              </div>
              <span className="text-[10px] text-rose-300 font-mono">优先级: {installedRecord.priority}</span>
            </div>
          )}
        </div>

        {/* Version Selector & Integrity Check */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-3xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-rose-400" />
              版本选择与下载校验
            </h3>
            <span className="text-[11px] text-slate-500">
              共 {mod.versions.length} 个发布版本
            </span>
          </div>

          {/* Version Pills / Select */}
          <div className="flex items-center gap-2 overflow-x-auto py-1 no-scrollbar">
            {mod.versions.map((ver) => (
              <button
                key={ver.id}
                onClick={() => setSelectedVersionId(ver.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-mono font-medium transition-all ${
                  selectedVersionId === ver.id
                    ? 'bg-rose-500 text-white shadow-md'
                    : 'bg-slate-850 hover:bg-slate-800 text-slate-300 border border-slate-750'
                }`}
              >
                v{ver.version} {ver.id === mod.latest_version_id && '(最新)'}
              </button>
            ))}
          </div>

          {/* SHA-256 Hash Display */}
          <div className="p-3 bg-slate-900 rounded-2xl border border-slate-800/80 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>归档 SHA-256 校验摘要 (发布不可变)</span>
              <span className="font-mono text-slate-300">{formatBytes(currentVersion.size_bytes)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-850">
              <span className="font-mono text-[11px] text-slate-300 break-all select-all">
                {currentVersion.sha256}
              </span>
              <button
                onClick={handleCopyHash}
                className="shrink-0 p-1 rounded-lg text-slate-400 hover:text-slate-200 transition-colors"
                title="复制 SHA-256"
              >
                {copiedHash ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          {/* Release notes */}
          {currentVersion.release_notes && (
            <div className="text-xs text-slate-400 pt-1">
              <span className="text-slate-300 font-medium">更新日志: </span>
              {currentVersion.release_notes}
            </div>
          )}
        </div>

        {/* MAS Compatibility & Dependencies */}
        <div className="bg-slate-950/70 border border-slate-800 rounded-3xl p-5 space-y-3">
          <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5 text-blue-400" />
            运行环境与依赖项要求
          </h3>

          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">MAS 要求版本:</span>
              <span className="font-mono text-slate-200">{mod.mas_version_range}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">当前活跃实例:</span>
              <span className="font-mono text-emerald-400">v{currentInstallation.mas_version} (兼容)</span>
            </div>
          </div>

          {/* Dependencies List */}
          <div className="space-y-2">
            <span className="text-xs text-slate-400">模组依赖图谱 ({currentVersion.dependencies.length})</span>
            {currentVersion.dependencies.length === 0 ? (
              <p className="text-xs text-slate-500 italic pl-1">无前置依赖，可直接独立安装。</p>
            ) : (
              <div className="space-y-2">
                {currentVersion.dependencies.map((dep) => {
                  return (
                    <div
                      key={dep.mod_id}
                      className="p-3 bg-slate-900 rounded-2xl border border-slate-800/80 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-medium text-slate-200">{dep.mod_name}</div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          要求范围: {dep.version_range}
                        </div>
                      </div>
                      <div className="text-right">
                        {dep.is_satisfied ? (
                          <div className="flex items-center gap-1 text-emerald-400 text-[11px]">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>已满足 (v{dep.installed_version})</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-rose-400 text-[11px]">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>缺少依赖</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Static Scan Report (Contract Requirement) */}
        {scanReport && (
          <div className="bg-slate-950/70 border border-slate-800 rounded-3xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <FileCode2 className="w-3.5 h-3.5 text-emerald-400" />
                SubmodHub 静态安全扫描报告
              </h3>
              <span className="text-[10px] text-emerald-400 font-mono">AST READY</span>
            </div>

            <div className="p-3 bg-slate-900 rounded-2xl border border-slate-800/80 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">包内文件总数:</span>
                <span className="font-mono text-slate-200">{scanReport.files_count} 个</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">注册名实体:</span>
                <span className="font-mono text-slate-200">
                  {scanReport.registrations.map((r) => r.name).join(', ') || '无注册名'}
                </span>
              </div>
              {scanReport.derived_gifts.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">派生礼品 (.gift):</span>
                  <span className="font-mono text-slate-200">{scanReport.derived_gifts.join(', ')}</span>
                </div>
              )}
            </div>

            {/* Blockers & Warnings */}
            {scanReport.blockers.length > 0 && (
              <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-xs space-y-1">
                <div className="flex items-center gap-1.5 text-rose-300 font-semibold">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>静态扫描阻断项 ({scanReport.blockers.length})</span>
                </div>
                {scanReport.blockers.map((b, i) => (
                  <p key={i} className="text-rose-200 pl-5 text-[11px] leading-relaxed">
                    · {b}
                  </p>
                ))}
              </div>
            )}

            {scanReport.warnings.length > 0 && (
              <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs space-y-1">
                <div className="flex items-center gap-1.5 text-amber-300 font-medium">
                  <Info className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>静态分析提示</span>
                </div>
                {scanReport.warnings.map((w, i) => (
                  <p key={i} className="text-amber-200/90 pl-5 text-[11px] leading-relaxed">
                    · {w}
                  </p>
                ))}
              </div>
            )}

            <p className="text-[11px] text-slate-500 leading-normal">
              根据契约规范：未知静态解析结果均以警示呈现，严禁将未知 AST 伪装为“完全安全”。
            </p>
          </div>
        )}
      </div>

      {/* Sticky Bottom Action CTA (Layout C in Mobile Touch Reference) */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent z-40 border-t border-slate-800/60 max-w-[420px] mx-auto">
        <button
          onClick={() => onRequestPlan(mod, currentVersion.id)}
          className={`w-full h-12 rounded-2xl font-semibold text-xs flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98] ${
            hasBlockers
              ? 'bg-amber-600/30 text-amber-200 border border-amber-500/50 hover:bg-amber-600/40'
              : 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/30'
          }`}
        >
          <span>
            {hasBlockers
              ? '预览阻断安装计划 (Preview Blocked Plan)'
              : isUpdate
              ? '生成升级计划并预览变更 (Preview Update Plan)'
              : isInstalled
              ? '重新安装 / 修复安装计划 (Preview Reinstall)'
              : '生成安装计划并预览变更 (Preview Install Plan)'}
          </span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
