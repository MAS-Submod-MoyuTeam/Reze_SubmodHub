import React, { useCallback, useEffect, useState, useRef } from 'react';
import { apiBase } from '../apiBase';

import { useApp } from '../context/AppContext';
import { ModVersion, DownloadDescriptor, ASSET_PLATFORM_LABELS, assetPlatformLabel, type AssetPlatform } from '../types/submodhub';
import { fetchModImages, fetchVerifiedArchive } from '../../../ui/catalog-api';
import { MarkdownText } from './MarkdownText';
import { DeprecationNotice } from './DeprecationNotice';
import { SpritepackSets } from './SpritepackSets';
import { formatVersionLabel, sortVersionHistory } from './versionHistory';
import { formatBytes } from './formatBytes';
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
  EyeOff,
} from 'lucide-react';

interface ModDetailModalProps {
  modId: string | null;
  downloadVersionId: string | null;
  onClose: () => void;
}

export const ModDetailModal: React.FC<ModDetailModalProps> = ({
  modId,
  downloadVersionId,
  onClose,
}) => {
  const { mods, versions, scanReports, getDownloadDescriptor, showToast, currentUser, unpublishVersion, markVersionDeprecated, clearVersionDeprecation, deleteVersion, setDetailModalModId, unpublishMod } = useApp();

  // If modId provided, or derived from downloadVersionId
  const effectiveModId =
    modId || versions.find((v) => v.id === downloadVersionId)?.mod_id || null;

  const currentMod = mods.find((m) => m.id === effectiveModId);
  const modVersions = sortVersionHistory(
    versions.filter((v) => v.mod_id === effectiveModId && (v.state === 'published' || v.id === downloadVersionId)),
    currentMod?.source_type === 'github_releases',
    currentMod?.latest_version_id,
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
  // The platform the reader is downloading. Empty means "whatever this version
  // ships", which is the normal case for single-archive versions.
  const [downloadPlatform, setDownloadPlatform] = useState<AssetPlatform | ''>('');
  const [isDownloading, setIsDownloading] = useState(false);
  const [unpublishingModId, setUnpublishingModId] = useState<string | null>(null);
  const [detailImages, setDetailImages] = useState<string[]>([]);

  const isAdmin = Boolean(currentUser?.roles.includes('admin'));

  const isMountedRef = useRef(false);
  const currentModIdRef = useRef(effectiveModId);
  const inFlightModIdsRef = useRef<Set<string>>(new Set());

  // Keep this in sync during render rather than in a passive effect: a stale
  // request can resolve after the modal has already been switched to another
  // mod, but before a passive effect would have updated the ref.
  currentModIdRef.current = effectiveModId;

  // Ref callbacks fire synchronously on commit/unmount, so a stale request
  // cannot observe the modal as mounted after it was closed.
  const handleModalRootRef = useCallback((node: HTMLDivElement | null) => {
    isMountedRef.current = node !== null;
  }, []);

  // Only the mod currently displayed owns the "unpublishing" state. Requests
  // left in flight for another mod must not leak a disabled button into it.
  const isUnpublishingMod = Boolean(effectiveModId) && unpublishingModId === effectiveModId;

  const handleUnpublishMod = async () => {
    if (!currentMod || inFlightModIdsRef.current.has(currentMod.id)) return;
    const targetModId = currentMod.id;
    const confirmed = window.confirm(
      `确认下架项目「${currentMod.title}」？该项目将从公开目录隐藏，版本、归档和详情图会保留。`
    );
    if (!confirmed) return;

    inFlightModIdsRef.current.add(targetModId);
    setUnpublishingModId(targetModId);
    try {
      const ok = await unpublishMod(targetModId);
      // The modal may have been closed and another mod opened while the
      // request was in flight; never close the newly selected mod.
      if (ok && isMountedRef.current && currentModIdRef.current === targetModId) {
        onClose();
      }
    } finally {
      inFlightModIdsRef.current.delete(targetModId);
      if (isMountedRef.current) {
        setUnpublishingModId((previous) => (previous === targetModId ? null : previous));
      }
    }
  };

  useEffect(() => {
    if (!currentMod || currentMod.category === 'spritepack') { setDetailImages([]); return; }
    let active = true;
    const base = apiBase();
    fetchModImages(currentMod.id, base).then((images) => { if (active) setDetailImages(images.map((url) => new URL(url, window.location.origin).href)); }).catch(() => { if (active) setDetailImages([]); });
    return () => { active = false; };
  }, [currentMod?.id, currentMod?.category]);

  // A per-platform version has no default build, so there is nothing to prefetch
  // until the reader picks one: asking without a platform would replace the
  // platform buttons with a 400 toast.
  const prefetchTarget = downloadVersionId ? versions.find((v) => v.id === downloadVersionId) : undefined;
  const canPrefetchDescriptor =
    Boolean(downloadVersionId) && currentMod?.category !== 'spritepack' && !prefetchTarget?.platform_assets?.length;

  useEffect(() => {
    if (!canPrefetchDescriptor || !downloadVersionId) return;
    let active = true;
    getDownloadDescriptor(downloadVersionId)
      .then((descriptor) => { if (active) setDownloadDescriptor(descriptor); })
      .catch((error) => { if (active) showToast('error', `无法取得下载信息：${error.message}`); });
    return () => { active = false; };
  }, [canPrefetchDescriptor, downloadVersionId, getDownloadDescriptor, showToast]);

  const [copiedHash, setCopiedHash] = useState(false);

  if (!currentMod) return null;

  const currentVersion =
    modVersions.find((v) => v.id === selectedVersionId) || modVersions[0];
  const scanReport = currentVersion?.scan_report_id
    ? scanReports[currentVersion.scan_report_id]
    : null;

  // A version without platform_assets ships one archive that every platform
  // installs, so it is compatible with all of them and there is no platform to
  // choose. A version that ships exactly one platform means that platform — no
  // guess is involved, there is only one build. Only a version with several
  // builds needs a decision, and that decision is the reader's.
  const currentPlatforms = currentVersion?.platform_assets ?? [];
  const pickedPlatform: AssetPlatform | undefined = downloadPlatform || undefined;
  const requestedPlatform: AssetPlatform | undefined =
    currentPlatforms.length === 1
      ? currentPlatforms[0].platform
      : pickedPlatform && currentPlatforms.some((asset) => asset.platform === pickedPlatform)
        ? pickedPlatform
        : undefined;
  const platformChoicePending = currentPlatforms.length > 1 && !requestedPlatform;

  // Picking one platform's hash must also pick that platform: a download issued
  // from a highlighted hash must describe the bytes it just showed.
  const selectPlatform = (platform: AssetPlatform) => {
    setDownloadPlatform(platform);
    setDownloadDescriptor(null);
  };

  const handleFetchDownloadDescriptor = async (vId: string, platform?: AssetPlatform) => {
    setDownloadDescriptor(null);
    try {
      setDownloadDescriptor(await getDownloadDescriptor(vId, platform));
    } catch (error) {
      showToast('error', `无法取得下载信息：${error instanceof Error ? error.message : 'unknown_error'}`);
    }
  };

  const handleDownloadArchive = async () => {
    if (!currentVersion || isDownloading) return;
    setIsDownloading(true);
    try {
      const base = apiBase();
      // Download the platform the reader picked, not whichever file happens to
      // be first: an Android reader must get the Android build.
      const archive = await fetchVerifiedArchive(currentVersion.id, base, fetch, undefined, undefined, requestedPlatform);
      const url = URL.createObjectURL(archive.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `submod_${currentVersion.id}${archive.platform ? `-${archive.platform}` : ''}.zip`;
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

  return (
    <div ref={handleModalRootRef} className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs">
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

          {detailImages.length > 0 && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{detailImages.map((url, index) => <img key={url} src={url} alt={`${currentMod.title} 详情图 ${index + 1}`} loading="lazy" className="w-full max-h-80 object-contain rounded border border-neutral-200 bg-neutral-50" />)}</div>}

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
                    <span>{formatVersionLabel(v.version)}</span>
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
                      {currentVersion.platform_assets && currentVersion.platform_assets.length > 0
                        ? currentVersion.platform_assets
                            .map((asset) => `${assetPlatformLabel(asset.platform)} ${formatBytes(asset.size_bytes)}`)
                            .join(' · ')
                        : `大小: ${formatBytes(currentVersion.size_bytes)} (${currentVersion.size_bytes.toLocaleString()} 字节) · 全平台通用`}
                    </div>
                  </div>

                  {/* Download Action Trigger */}
                  <div className="flex flex-wrap items-center gap-2">
                    {currentVersion.platform_assets && currentVersion.platform_assets.length > 1 && (
                      <div className="flex items-center bg-white p-0.5 rounded border border-neutral-200 text-[11px] font-medium">
                        {currentVersion.platform_assets.map((asset) => (
                          <button
                            key={asset.platform}
                            type="button"
                            aria-pressed={requestedPlatform === asset.platform}
                            onClick={() => selectPlatform(asset.platform)}
                            className={`px-2 py-1 rounded transition-colors ${
                              requestedPlatform === asset.platform
                                ? 'bg-neutral-900 text-white'
                                : 'text-neutral-600 hover:text-neutral-900'
                            }`}
                          >
                            {ASSET_PLATFORM_LABELS[asset.platform]}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => handleFetchDownloadDescriptor(currentVersion.id, requestedPlatform)}
                      disabled={platformChoicePending}
                      title={platformChoicePending ? '该版本为 Windows 与 Android 提供了不同的包，请先选择平台' : undefined}
                      className="px-3.5 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded flex items-center gap-1.5 transition-colors shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {platformChoicePending ? '请先选择平台' : '获取下载描述符 (GET /download)'}
                    </button>
                  </div>
                </div>

                {/* Release notes */}
                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-neutral-500">发行说明 (Changelog):</span>
                  <MarkdownText value={currentVersion.release_notes || '暂无更新日志'} className="text-neutral-800 bg-white p-2.5 rounded border border-neutral-200" />
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
                          <div className="flex flex-wrap items-center gap-2">
                            {(dep.linked_mod_ids?.length ? dep.linked_mod_ids : dep.linked_mod_id ? [dep.linked_mod_id] : [])
                              .map((linkedId) => mods.find((candidate) => candidate.id === linkedId && candidate.is_published))
                              .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
                              .map((candidate) => (
                                <button key={candidate.id} type="button" onClick={() => setDetailModalModId(candidate.id)} className="font-mono text-emerald-700 hover:underline text-left">
                                  {candidate.title}
                                </button>
                              ))}
                            {!(dep.linked_mod_ids?.length || dep.linked_mod_id) && <span className="font-mono text-neutral-800">{dep.mod_title || dep.mod_id}</span>}
                          </div>
                          <span className="font-mono text-neutral-500">
                            {dep.version_range} {dep.required ? '(必需)' : '(可选建议)'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* SHA-256 Hash box. A per-platform version has one hash per
                    file, so every platform is listed instead of a single value
                    that belongs to only one of them. */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-neutral-500 flex items-center gap-1">
                      <Hash className="w-3 h-3 text-neutral-400" />
                      归档完整性 SHA-256 校验和 (不可变约束):
                    </span>
                    <button
                      onClick={() => handleCopyHash(
                        currentVersion.platform_assets && currentVersion.platform_assets.length > 0
                          ? currentVersion.platform_assets.map((asset) => `${assetPlatformLabel(asset.platform)} ${asset.sha256 || ''}`).join('\n')
                          : currentVersion.sha256
                      )}
                      className="text-[11px] text-emerald-700 hover:underline flex items-center gap-1"
                    >
                      {copiedHash ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      复制哈希
                    </button>
                  </div>
                  {currentVersion.platform_assets && currentVersion.platform_assets.length > 0 ? (
                    <div className="space-y-1">
                      {currentVersion.platform_assets.map((asset) => (
                        <div key={asset.platform} className="flex items-start gap-2">
                          {/* The label is the selector: reading one platform's hash
                              and then downloading is one decision, not two. */}
                          <button
                            type="button"
                            aria-pressed={requestedPlatform === asset.platform}
                            onClick={() => selectPlatform(asset.platform)}
                            className={`text-[11px] w-16 shrink-0 pt-1.5 text-left transition-colors ${
                              requestedPlatform === asset.platform ? 'text-neutral-900 font-medium' : 'text-neutral-500 hover:text-neutral-800'
                            }`}
                          >
                            {assetPlatformLabel(asset.platform)}
                          </button>
                          <div className="font-mono text-[11px] bg-white p-2 rounded border border-neutral-200 text-neutral-800 break-all select-all tabular-nums flex-1">
                            {asset.sha256 || '尚未就绪'}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="font-mono text-[11px] bg-white p-2 rounded border border-neutral-200 text-neutral-800 break-all select-all tabular-nums">
                      {currentVersion.sha256}
                    </div>
                  )}
                </div>

                {/* Scan Summary */}
                {scanReport && (
                  <div className="space-y-2 pt-2 border-t border-neutral-200/80">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-medium text-neutral-800">
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        静态扫描摘要 (Scan Report ID: {scanReport.id})
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
                        <div className="text-neutral-500 font-medium">Submod 注册标识:</div>
                        {scanReport.registrations.map((reg) => (
                          <div key={reg.submod_id} className="font-mono text-neutral-800">
                            {reg.name} [{reg.submod_id}]
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
                {downloadDescriptor.platform && (
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-500">分发平台:</span>
                    <span className="font-mono">{assetPlatformLabel(downloadDescriptor.platform)}</span>
                  </div>
                )}
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
              </div>
            </div>
          )}
          </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-neutral-200 bg-neutral-50/50 flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-500">
          <span>推荐安装优先级: {currentMod.recommended_priority}</span>
          <div className="flex items-center gap-2">
            {isAdmin && currentMod.is_published && (
              <button
                type="button"
                onClick={handleUnpublishMod}
                disabled={isUnpublishingMod}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 border border-amber-200 hover:bg-amber-50 rounded transition-colors disabled:opacity-50"
              >
                <EyeOff className="w-3.5 h-3.5" />
                {isUnpublishingMod ? '正在下架项目...' : '下架项目'}
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-200/80 rounded transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
