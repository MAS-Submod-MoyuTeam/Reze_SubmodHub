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
import { modShareURL } from '../../../ui/mod-link';
import { copyToClipboard } from '../../../ui/clipboard';
import { openInClient } from '../clientDeepLink';
import { AnimatePresence, m } from './Motion';
import { useI18n } from '../i18n';
import { overlayVariants, panelVariants } from '../../../ui/motion-presets';
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
  Share2,
  MonitorSmartphone,
} from 'lucide-react';

interface ModDetailModalProps {
  modId: string | null;
  downloadVersionId: string | null;
  onClose: () => void;
  /** 「未检测到客户端」时把用户送到下载入口；没有这个回调就只提示。 */
  onOpenClientDownload?: () => void;
  onNotify?: (message: string) => void;
}

export const ModDetailModal: React.FC<ModDetailModalProps> = ({
  modId,
  downloadVersionId,
  onClose,
  onOpenClientDownload,
  onNotify,
}) => {
  const { mods, versions, scanReports, getDownloadDescriptor, showToast, currentUser, unpublishVersion, markVersionDeprecated, clearVersionDeprecation, deleteVersion, setDetailModalModId, unpublishMod, catalogLoading, catalogError } = useApp();
  const { t, resolve } = useI18n();

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
      t('detail.confirmUnpublishMod', { title: currentMod.title })
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
      .catch((error) => { if (active) showToast('error', t('detail.downloadInfoFailed', { error: error.message })); });
    return () => { active = false; };
  }, [canPrefetchDescriptor, downloadVersionId, getDownloadDescriptor, showToast]);

  const [copiedHash, setCopiedHash] = useState(false);
  const [shareState, setShareState] = useState<'idle' | 'copied'>('idle');

  // 分享链接可能指向一个已下架或根本不存在的 mod：目录到手后仍然查不到，就得
  // 说出来，而不是让用户对着一个空白弹窗猜。加载中不报结论。
  //
  // 「目录没加载出来」和「目录里没有它」必须分开说：前者是我们没查到，后者才是
  // 它不在了。把请求失败说成「已下架」，是把我们自己的故障栽给这个模组。
  if (!currentMod) {
    if (catalogLoading) return null;
    const catalogFailed = Boolean(catalogError);
    return (
      <m.div
        variants={overlayVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs">
        <m.div
          variants={panelVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="bg-white rounded-lg border border-neutral-200 shadow-xl max-w-md w-full p-6 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-bold text-neutral-900">
              {catalogFailed ? t('detail.catalogNotLoaded') : t('detail.modMissing')}
            </h2>
            <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700 p-1.5 rounded transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-xs text-neutral-600 leading-relaxed">
            {catalogFailed
              ? t('detail.catalogNotLoadedBody', { error: catalogError ?? t('common.unknown') })
              : t('detail.modMissingBody')}
          </p>
          {effectiveModId && (
            <p className="font-mono text-[11px] text-neutral-500 break-all">ID: {effectiveModId}</p>
          )}
          <button
            onClick={onClose}
            className="w-full text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded px-3 py-2 transition-colors"
          >
            {t('detail.backToCatalog')}
          </button>
        </m.div>
      </m.div>
    );
  }

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
      showToast('error', t('detail.downloadInfoFailed', { error: error instanceof Error ? error.message : 'unknown_error' }));
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
      showToast('success', t('detail.downloadVerified'));
    } catch (error) {
      showToast('error', t('detail.downloadFailed', { error: error instanceof Error ? error.message : 'unknown_error' }));
    } finally {
      setIsDownloading(false);
    }
  };

  const handleCopyHash = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedHash(true);
    showToast('info', t('detail.hashCopied'));
    setTimeout(() => setCopiedHash(false), 2000);
  };

  /**
   * 分享：把「这个详情」变成一条可以直接粘贴到浏览器的链接。
   *
   * 用当前站点的 origin 而不是写死的正式域名——测试/自建实例分享出去的链接
   * 必须指回它自己，否则对方点开看到的是另一个站点。
   */
  const handleShare = async () => {
    const link = modShareURL(currentMod.id, window.location.origin);
    const copied = await copyToClipboard(link);
    if (!copied) {
      // 剪贴板被拒绝（文档没有焦点、权限策略）时别只说「失败」：
      // 把链接本身交给用户，他还能手动复制。
      showToast('warning', t('detail.clipboardBlocked', { link }));
      return;
    }
    setShareState('copied');
    showToast('success', t('detail.shareCopied', { link }));
    setTimeout(() => setShareState('idle'), 2000);
  };

  return (
    <m.div
      variants={overlayVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs">
      {/*
        承载挂载状态的 ref 挂在 motion 的兄弟节点上，而不是 `m.div` 本身：
        motion 对 ref 的转发在手写假 DOM（测试环境）里拿不到真实节点，
        `isMountedRef` 会一直为 false，导致请求失败后按钮停在禁用态。
      */}
      <div ref={handleModalRootRef} className="contents">
      <m.div
        variants={panelVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        className="bg-white rounded-lg border border-neutral-200 shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between shrink-0 bg-neutral-50/50">
          <div>
            <div className="flex items-center gap-2 text-xs text-neutral-500 mb-1">
              <span className="font-semibold text-emerald-700">
                {currentMod.category === 'spritepack' ? t('catalog.kindSpritepackLong') : t('catalog.kindSubmodLong')}
              </span>
              <span>·</span>
              <span>{t('catalog.author', { name: currentMod.author.display_name })}</span>
              <span>·</span>
              <span className="font-mono text-neutral-700">{t('detail.masCompatible', { range: currentMod.mas_version_range })}</span>
            </div>
            <h2 className="text-base font-bold text-neutral-900">{currentMod.title}</h2>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* 分享与「在客户端打开」只属于详情页：列表里既没有稳定上下文，
                也没有分享的必要。 */}
            <button
              type="button"
              onClick={handleShare}
              title={t('detail.shareTitle')}
              className="inline-flex items-center gap-1.5 text-xs text-neutral-600 hover:text-neutral-900 border border-neutral-200 hover:border-neutral-300 rounded px-2.5 py-1.5 transition-colors"
            >
              {shareState === 'copied' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Share2 className="w-3.5 h-3.5" />}
              {shareState === 'copied' ? t('common.copied') : t('detail.share')}
            </button>
            <button
              type="button"
              onClick={() => openInClient(currentMod.id, {
                onNoClient: () => {
                  onNotify?.(t('detail.clientMissing'));
                  onOpenClientDownload?.();
                },
              })}
              title={t('detail.openInClientTitle')}
              className="inline-flex items-center gap-1.5 text-xs text-neutral-600 hover:text-neutral-900 border border-neutral-200 hover:border-neutral-300 rounded px-2.5 py-1.5 transition-colors"
            >
              <MonitorSmartphone className="w-3.5 h-3.5" />
              {t('detail.openInClient')}
            </button>
            <button
              onClick={onClose}
              className="text-neutral-400 hover:text-neutral-700 p-1.5 rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs text-neutral-700 leading-relaxed">
          {/* Summary / Description */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">
              {t('detail.description')}
            </h4>
            <MarkdownText value={resolve(currentMod.description) || resolve(currentMod.summary)} className="text-neutral-600 bg-neutral-50 p-3 rounded border border-neutral-100" />
          </div>

          {detailImages.length > 0 && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{detailImages.map((url, index) => <img key={url} src={url} alt={t('detail.imageAlt', { title: currentMod.title, index: index + 1 })} loading="lazy" className="w-full max-h-80 object-contain rounded border border-neutral-200 bg-neutral-50" />)}</div>}

          {currentMod.category === 'spritepack' ? (
            <SpritepackSets modID={currentMod.id} showToast={showToast} />
          ) : (
          <>
          {/* Versions Bar & Switcher */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-neutral-900 uppercase tracking-wider">
                {t('detail.versionHistory')}
              </h4>
              <span className="text-[11px] text-neutral-400">
                {t('detail.immutableNote')}
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
                    {v.deprecated && <AlertTriangle className="h-3 w-3 text-amber-500" aria-label={t('deprecation.label')} />}
                  </button>
                );
              })}
            </div>
            {currentVersion && (currentUser?.roles.includes('admin') || currentUser?.id === currentMod.author.id) && (
              <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-3">
                {currentVersion.state === 'published' && <button onClick={() => { const reason = window.prompt(t('detail.unpublishReasonPrompt')); if (reason?.trim()) void unpublishVersion(currentVersion.id, reason); }} className="text-xs text-amber-700 border border-amber-200 rounded px-2.5 py-1.5">{t('detail.unpublishVersion')}</button>}
                {!currentVersion.deprecated && currentVersion.state !== 'draft' && <button onClick={() => { const reason = window.prompt(t('detail.deprecateReasonPrompt')); if (reason?.trim()) void markVersionDeprecated(currentVersion.id, reason); }} className="text-xs text-orange-700 border border-orange-200 rounded px-2.5 py-1.5">{t('detail.markDeprecated')}</button>}
                {currentVersion.deprecated && <button onClick={() => { if (window.confirm(t('detail.confirmUndeprecate'))) void clearVersionDeprecation(currentVersion.id); }} className="text-xs text-emerald-700 border border-emerald-200 rounded px-2.5 py-1.5">{t('detail.undeprecate')}</button>}
                {currentVersion.state !== 'published' && <button onClick={() => { if (window.confirm(t('detail.confirmDeleteVersion'))) void deleteVersion(currentVersion.id); }} className="text-xs text-rose-700 border border-rose-200 rounded px-2.5 py-1.5">{t('detail.deleteVersion')}</button>}
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
                        {t('detail.versionLabel', { version: currentVersion.version })}
                      </span>
                      {currentVersion.published_at && (
                        <span className="text-[11px] text-neutral-500 flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-neutral-400" />
                          {t('detail.publishedOn', { date: new Date(currentVersion.published_at).toLocaleDateString() })}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-neutral-500 font-mono mt-0.5">
                      {currentVersion.platform_assets && currentVersion.platform_assets.length > 0
                        ? currentVersion.platform_assets
                            .map((asset) => `${assetPlatformLabel(asset.platform)} ${formatBytes(asset.size_bytes, t('common.unknown'))}`)
                            .join(' · ')
                        : t('detail.sizeAllPlatforms', { size: formatBytes(currentVersion.size_bytes, t('common.unknown')), bytes: currentVersion.size_bytes.toLocaleString() })}
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
                      title={platformChoicePending ? t('detail.platformChoiceTitle') : undefined}
                      className="px-3.5 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded flex items-center gap-1.5 transition-colors shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {platformChoicePending ? t('detail.choosePlatformFirst') : t('common.download')}
                    </button>
                  </div>
                </div>

                {/* Release notes */}
                <div className="space-y-1">
                  <span className="text-[11px] font-medium text-neutral-500">{t('detail.changelogLabel')}</span>
                  <MarkdownText value={currentVersion.release_notes || t('detail.noChangelog')} className="text-neutral-800 bg-white p-2.5 rounded border border-neutral-200" />
                </div>

                {/* Dependencies */}
                {currentVersion.dependencies.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[11px] font-medium text-neutral-500">{t('detail.dependenciesLabel')}</span>
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
                            {dep.version_range} {dep.required ? t('detail.depRequired') : t('detail.depOptional')}
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
                      {t('detail.checksumLabel')}
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
                      {t('detail.copyHash')}
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
                            {asset.sha256 || t('detail.notReady')}
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
                        {t('detail.scanSummary', { id: scanReport.id })}
                      </div>
                      <span className="text-[11px] font-mono text-neutral-400">
                        {new Date(scanReport.scanned_at).toLocaleDateString()}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                      <div className="bg-white p-2 rounded border border-neutral-200">
                        <div className="text-[10px] text-neutral-400">{t('detail.statTotalFiles')}</div>
                        <div className="font-semibold text-neutral-800 tabular-nums">
                          {scanReport.resource_stats.total_files}
                        </div>
                      </div>
                      <div className="bg-white p-2 rounded border border-neutral-200">
                        <div className="text-[10px] text-neutral-400">{t('detail.statScripts')}</div>
                        <div className="font-semibold text-neutral-800 tabular-nums">
                          {scanReport.resource_stats.scripts_count}
                        </div>
                      </div>
                      <div className="bg-white p-2 rounded border border-neutral-200">
                        <div className="text-[10px] text-neutral-400">{t('detail.statTextures')}</div>
                        <div className="font-semibold text-neutral-800 tabular-nums">
                          {scanReport.resource_stats.sprites_count}
                        </div>
                      </div>
                      <div className="bg-white p-2 rounded border border-neutral-200">
                        <div className="text-[10px] text-neutral-400">{t('detail.statBinaries')}</div>
                        <div
                          className={`font-semibold tabular-nums ${
                            scanReport.resource_stats.binary_flag
                              ? 'text-rose-600'
                              : 'text-emerald-700'
                          }`}
                        >
                          {scanReport.resource_stats.binary_flag ? t('detail.binaryDetected') : t('detail.noBinary')}
                        </div>
                      </div>
                    </div>

                    {/* Registrations with Confidence requirement */}
                    {scanReport.registrations.length > 0 && (
                      <div className="text-[11px] bg-white p-2.5 rounded border border-neutral-200 space-y-1">
                        <div className="text-neutral-500 font-medium">{t('detail.registrations')}</div>
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
                  {t('detail.descriptorReady')}
                </div>
                <span className="text-[11px] font-mono text-emerald-800">
                  {t('detail.expiresAt', { time: new Date(downloadDescriptor.expires_at).toLocaleTimeString() })}
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-emerald-950">
                {downloadDescriptor.platform && (
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-500">{t('detail.deliveryPlatform')}</span>
                    <span className="font-mono">{assetPlatformLabel(downloadDescriptor.platform)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500">{t('detail.archiveFileName')}</span>
                  <span className="font-mono">{downloadDescriptor.filename}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500">{t('detail.downloadSize')}</span>
                  <span className="font-mono tabular-nums">{formatBytes(downloadDescriptor.size_bytes, t('common.unknown'))}</span>
                </div>
                <div>
                  <span className="text-neutral-500 block mb-0.5">{t('detail.downloadURL')}</span>
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
                  {isDownloading ? t('detail.downloading') : t('detail.verifyAndDownload')}
                </button>
              </div>
            </div>
          )}
          </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-neutral-200 bg-neutral-50/50 flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-500">
          <span>{t('detail.recommendedPriority', { priority: currentMod.recommended_priority })}</span>
          <div className="flex items-center gap-2">
            {isAdmin && currentMod.is_published && (
              <button
                type="button"
                onClick={handleUnpublishMod}
                disabled={isUnpublishingMod}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 border border-amber-200 hover:bg-amber-50 rounded transition-colors disabled:opacity-50"
              >
                <EyeOff className="w-3.5 h-3.5" />
                {isUnpublishingMod ? t('detail.unpublishing') : t('detail.unpublishMod')}
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-200/80 rounded transition-colors"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      </m.div>
      </div>
    </m.div>
  );
};
