import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { ModVersion, DownloadDescriptor } from '../types/submodhub';
import { fetchVerifiedArchive } from '../../../ui/catalog-api';
import { MarkdownText } from './MarkdownText';
import { DeprecationNotice } from './DeprecationNotice';
import { SpritepackSets } from './SpritepackSets';
import {
  X,
  Download,
  ShieldCheck,
  FileCode,
  Layers,
  HardDrive,
  Hash,
  ExternalLink,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  Terminal,
} from 'lucide-react';

interface ModDetailModalProps {
  modId: string | null;
  downloadVersionId: string | null;
  onClose: () => void;
  onTriggerClientPlan: (modId: string, versionId: string) => void;
}

export const ModDetailModal: React.FC<ModDetailModalProps> = ({
  modId,
  downloadVersionId,
  onClose,
  onTriggerClientPlan,
}) => {
  const { mods, versions, scanReports, getDownloadDescriptor, showToast, currentUser, unpublishVersion, markVersionDeprecated, clearVersionDeprecation, deleteVersion, setDetailModalModId } = useApp();

  // If modId provided, or derived from downloadVersionId
  const effectiveModId =
    modId || versions.find((v) => v.id === downloadVersionId)?.mod_id || null;

  const currentMod = mods.find((m) => m.id === effectiveModId);
  const modVersions = versions.filter(
    (v) => v.mod_id === effectiveModId && (v.state === 'published' || v.id === downloadVersionId)
  );

  const [selectedVersionId, setSelectedVersionId] = useState<string>(() => {
    if (downloadVersionId) return downloadVersionId;
    if (currentMod?.latest_version_id) return currentMod.latest_version_id;
    return modVersions[0]?.id || '';
  });

  useEffect(() => {
    if (downloadVersionId) return;
    if (currentMod?.latest_version_id) setSelectedVersionId(currentMod.latest_version_id);
    else if (modVersions[0]) setSelectedVersionId(modVersions[0].id);
  }, [currentMod?.id, currentMod?.latest_version_id, downloadVersionId]);

  const [downloadDescriptor, setDownloadDescriptor] = useState<DownloadDescriptor | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    if (!downloadVersionId || currentMod?.category === 'spritepack') return;
    let active = true;
    getDownloadDescriptor(downloadVersionId)
      .then((descriptor) => { if (active) setDownloadDescriptor(descriptor); })
      .catch((error) => { if (active) showToast('error', `无法取得下载信息：${error.message}`); });
    return () => { active = false; };
  }, [downloadVersionId, currentMod?.category, getDownloadDescriptor, showToast]);

  const [copiedHash, setCopiedHash] = useState(false);

  if (!currentMod) return null;

  const currentVersion =
    modVersions.find((v) => v.id === selectedVersionId) || modVersions[0];
  const scanReport = currentVersion?.scan_report_id
    ? scanReports[currentVersion.scan_report_id]
    : null;

  const handleFetchDownloadDescriptor = async (vId: string) => {
    setDownloadDescriptor(null);
    try {
      setDownloadDescriptor(await getDownloadDescriptor(vId));
    } catch (error) {
      showToast('error', `无法取得下载信息：${error instanceof Error ? error.message : 'unknown_error'}`);
    }
  };

  const handleDownloadArchive = async () => {
    if (!currentVersion || isDownloading) return;
    setIsDownloading(true);
    try {
      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      const archive = await fetchVerifiedArchive(currentVersion.id, base);
      const url = URL.createObjectURL(archive.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `submod_${currentVersion.id}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      showToast('success', 'ZIP 大小与 SHA-256 校验通过，已交给浏览器保存。');
    } catch (error) {
      showToast('error', `下载未完成：${error instanceof Error ? error.message : 'unknown_error'}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCopyHash = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedHash(true);
    showToast('info', 'SHA-256 校验和已复制到剪贴板');
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs">
      <div className="bg-white rounded-lg border border-neutral-200 shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between shrink-0 bg-neutral-50/50">
          <div>
            <div className="flex items-center gap-2 text-xs text-neutral-500 mb-1">
              <span className="font-semibold text-emerald-700">
                {currentMod.category === 'spritepack' ? 'Spritepack 服饰配件' : 'Submod 功能模组'}
              </span>
              <span>·</span>
              <span>作者: {currentMod.author.display_name}</span>
              <span>·</span>
              <span className="font-mono text-neutral-700">兼容 MAS {currentMod.mas_version_range}</span>
            </div>
            <h2 className="text-base font-bold text-neutral-900">{currentMod.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 p-1.5 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs text-neutral-700 leading-relaxed">
          {/* Summary / Description */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">
              详细简介
            </h4>
            <MarkdownText value={currentMod.description || currentMod.summary} className="text-neutral-600 bg-neutral-50 p-3 rounded border border-neutral-100" />
          </div>

          {currentMod.category === 'spritepack' ? (
            <SpritepackSets modID={currentMod.id} showToast={showToast} />
          ) : (
          <>
          {/* Versions Bar & Switcher */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">
                版本历史
              </h4>
              <span className="text-[11px] text-neutral-400">
                所有已发布版本的 ZIP 归档字节均具备不可变凭证
              </span>
            </div>

            <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1">
              {modVersions.map((v) => {
                const isSelected = v.id === currentVersion?.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => {
                      setSelectedVersionId(v.id);
                      setDownloadDescriptor(null);
                    }}
                    className={`px-3 py-1.5 rounded text-xs transition-colors flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-neutral-900 text-white font-medium'
                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200/70'
                    }`}
                  >
                    <span>v{v.version}</span>
                    {v.deprecated && <AlertTriangle className="h-3 w-3 text-amber-500" aria-label="不推荐使用" />}
                  </button>
                );
              })}
            </div>
            {currentVersion && (currentUser?.roles.includes('admin') || currentUser?.id === currentMod.author.id) && (
              <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
                {currentVersion.state === 'published' && <button onClick={() => { const reason = window.prompt('请输入下架理由'); if (reason?.trim()) void unpublishVersion(currentVersion.id, reason); }} className="text-xs text-amber-700 border border-amber-200 rounded px-2.5 py-1.5">下架此版本</button>}
                {!currentVersion.deprecated && currentVersion.state !== 'draft' && <button onClick={() => { const reason = window.prompt('请输入不推荐使用的原因'); if (reason?.trim()) void markVersionDeprecated(currentVersion.id, reason); }} className="text-xs text-orange-700 border border-orange-200 rounded px-2.5 py-1.5">标记不推荐</button>}
                {currentVersion.deprecated && <button onClick={() => { if (window.confirm('取消不推荐标记并清除原因？')) void clearVersionDeprecation(currentVersion.id); }} className="text-xs text-emerald-700 border border-emerald-200 rounded px-2.5 py-1.5">取消不推荐</button>}
                {currentVersion.state !== 'published' && <button onClick={() => { if (window.confirm('确认删除这个旧版本？')) void deleteVersion(currentVersion.id); }} className="text-xs text-rose-700 border border-rose-200 rounded px-2.5 py-1.5">删除此版本</button>}
              </div>
            )}

            <DeprecationNotice deprecated={currentVersion?.deprecated} reason={currentVersion?.deprecation_reason} />

            {/* Selected Version Detail Card */}
            {currentVersion && (
              <div className="p-4 rounded-lg border border-neutral-200 bg-neutral-50/50 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-200/80 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-neutral-900">
                        版本 {currentVersion.version}
                      </span>
                      {currentVersion.published_at && (
                        <span className="text-[11px] text-neutral-500 flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-neutral-400" />
                          发布于 {new Date(currentVersion.published_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-neutral-500 font-mono mt-0.5">
                      大小: {formatBytes(currentVersion.size_bytes)} ({currentVersion.size_bytes.toLocaleString()} 字节)
                    </div>
                  </div>

                  {/* Download Action Trigger */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleFetchDownloadDescriptor(currentVersion.id)}
                      className="px-3.5 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded flex items-center gap-1.5 transition-colors shadow-xs"
                    >
                      <Download className="w-3.5 h-3.5" />
                      获取下载描述符 (GET /download)
                    </button>
                  </div>
                </div>

                {/* Release notes */}
                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-neutral-500">发行说明 (Changelog):</span>
                  <p className="text-neutral-800 whitespace-pre-wrap bg-white p-2.5 rounded border border-neutral-200">
                    {currentVersion.release_notes || '暂无更新日志'}
                  </p>
                </div>

                {/* Dependencies */}
                {currentVersion.dependencies.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-medium text-neutral-500">前置模组依赖 (Dependencies):</span>
                    <div className="space-y-1">
                      {currentVersion.dependencies.map((dep) => (
                        <div
                          key={dep.mod_id}
                          className="flex items-center justify-between bg-white px-2.5 py-1.5 rounded border border-neutral-200 text-xs"
                        >
                          {dep.linked_mod_id && mods.some((candidate) => candidate.id === dep.linked_mod_id && candidate.is_published)
                            ? <button type="button" onClick={() => setDetailModalModId(dep.linked_mod_id!)} className="font-mono text-emerald-700 hover:underline text-left">{mods.find((candidate) => candidate.id === dep.linked_mod_id)?.title || dep.mod_title || dep.mod_id}</button>
                            : <span className="font-mono text-neutral-800">{dep.mod_title || dep.mod_id}</span>}
                          <span className="font-mono text-neutral-500">
                            {dep.version_range} {dep.required ? '(必需)' : '(可选建议)'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* SHA-256 Hash box */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-neutral-500 flex items-center gap-1">
                      <Hash className="w-3 h-3 text-neutral-400" />
                      归档完整性 SHA-256 校验和 (不可变约束):
                    </span>
                    <button
                      onClick={() => handleCopyHash(currentVersion.sha256)}
                      className="text-[11px] text-emerald-700 hover:underline flex items-center gap-1"
                    >
                      {copiedHash ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      复制哈希
                    </button>
                  </div>
                  <div className="font-mono text-[11px] bg-white p-2 rounded border border-neutral-200 text-neutral-800 break-all select-all tabular-nums">
                    {currentVersion.sha256}
                  </div>
                </div>

                {/* Aegis Scan Summary */}
                {scanReport && (
                  <div className="space-y-2 pt-2 border-t border-neutral-200/80">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-medium text-neutral-800">
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        Aegis 静态扫描摘要 (Scan Report ID: {scanReport.id})
                      </div>
                      <span className="text-[11px] font-mono text-neutral-400">
                        {new Date(scanReport.scanned_at).toLocaleDateString()}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                      <div className="bg-white p-2 rounded border border-neutral-200">
                        <div className="text-[10px] text-neutral-400">总文件数</div>
                        <div className="font-semibold text-neutral-800 tabular-nums">
                          {scanReport.resource_stats.total_files}
                        </div>
                      </div>
                      <div className="bg-white p-2 rounded border border-neutral-200">
                        <div className="text-[10px] text-neutral-400">RenPy 脚本</div>
                        <div className="font-semibold text-neutral-800 tabular-nums">
                          {scanReport.resource_stats.scripts_count}
                        </div>
                      </div>
                      <div className="bg-white p-2 rounded border border-neutral-200">
                        <div className="text-[10px] text-neutral-400">材质贴图</div>
                        <div className="font-semibold text-neutral-800 tabular-nums">
                          {scanReport.resource_stats.sprites_count}
                        </div>
                      </div>
                      <div className="bg-white p-2 rounded border border-neutral-200">
                        <div className="text-[10px] text-neutral-400">原生二进制</div>
                        <div
                          className={`font-semibold tabular-nums ${
                            scanReport.resource_stats.binary_flag
                              ? 'text-rose-600'
                              : 'text-emerald-700'
                          }`}
                        >
                          {scanReport.resource_stats.binary_flag ? '已检出 (警告)' : '无外挂二进制'}
                        </div>
                      </div>
                    </div>

                    {/* Registrations with Confidence requirement */}
                    {scanReport.registrations.length > 0 && (
                      <div className="text-[11px] bg-white p-2.5 rounded border border-neutral-200 space-y-1">
                        <div className="text-neutral-500 font-medium">Submod 注册标识与签名可信度:</div>
                        {scanReport.registrations.map((reg) => (
                          <div key={reg.submod_id} className="flex items-center justify-between">
                            <span className="font-mono text-neutral-800">{reg.name} [{reg.submod_id}]</span>
                            <span
                              className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                                reg.confidence === 'known'
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : 'bg-rose-50 text-rose-800 border border-rose-200'
                              }`}
                            >
                              可信度: {reg.confidence} (规范禁止将未知结果显示为安全)
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Download Descriptor Modal / Section (Section 1 & 2 contract) */}
          {downloadDescriptor && (
            <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-lg space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-900 text-xs">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                  已取得下载信息
                </div>
                <span className="text-[11px] font-mono text-emerald-800">
                  有效时间至: {new Date(downloadDescriptor.expires_at).toLocaleTimeString()}
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-emerald-950">
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500">归档文件名:</span>
                  <span className="font-mono">{downloadDescriptor.filename}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500">下载大小:</span>
                  <span className="font-mono tabular-nums">{formatBytes(downloadDescriptor.size_bytes)}</span>
                </div>
                <div>
                  <span className="text-neutral-500 block mb-0.5">下载地址:</span>
                  <input
                    readOnly
                    value={downloadDescriptor.url}
                    className="w-full text-[11px] font-mono bg-white px-2 py-1 rounded border border-emerald-200 select-all"
                  />
                </div>
              </div>

              {/* Action buttons */}
              <div className="pt-2 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleDownloadArchive()}
                  disabled={isDownloading}
                  className="px-3.5 py-1.5 text-xs font-medium text-white bg-emerald-800 hover:bg-emerald-900 rounded flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  {isDownloading ? '正在下载并校验' : '校验并下载 ZIP'}
                </button>

                <button
                  onClick={() => {
                    if (currentVersion) {
                      onTriggerClientPlan(currentMod.id, currentVersion.id);
                      onClose();
                    }
                  }}
                  className="px-3.5 py-1.5 text-xs font-medium text-neutral-800 bg-white hover:bg-neutral-100 rounded border border-neutral-300 flex items-center gap-1.5 transition-colors"
                >
                  <Terminal className="w-3.5 h-3.5 text-neutral-600" />
                  在客户端安装预览 (Go 契约计划)
                </button>
              </div>
            </div>
          )}
          </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-neutral-200 bg-neutral-50/50 flex items-center justify-between text-xs text-neutral-500">
          <span>推荐安装优先级: {currentMod.recommended_priority}</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-200/80 rounded transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
