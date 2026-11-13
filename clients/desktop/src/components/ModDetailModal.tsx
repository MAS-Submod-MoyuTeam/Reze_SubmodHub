import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, Download, RefreshCw, Share2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fetchModImages, fetchModVersion, fetchPublishedVersions, fetchSpriteManifest, fetchVerifiedSpriteSelection, type CatalogVersion, type DownloadProgress, type SpriteSet } from '../../../../ui/catalog-api';
import { ModSummary } from '../types/client';
import {
  calculateSpriteSelectionDiff,
  deriveSpriteSelection,
  isSpriteSelectionValid,
  type SpriteInstallationSnapshot,
} from '../spritepackUtils';
import { SpritepackSelection } from './SpritepackSelection';
import { createModDetailTracker, executeDetailLoad, type LoadReason } from '../modDetailTracker';
import type { LoadingStatus } from '../installedLoading';
import { sortVersionHistory } from '../versionHistory';
import { copyToClipboard } from '../clipboard';
import { ModShareLink } from '../wails';
import { m } from './Motion';
import { overlayVariants } from '../../../../ui/motion-presets';
import { useI18n } from '../i18n';

interface Props {
  mod: ModSummary | null;
  catalogMods: ModSummary[];
  onSelectMod: (mod: ModSummary) => void;
  onClose: () => void;
  onStartInstallPlan: (mod: ModSummary, version?: CatalogVersion, selectedSpriteSetIDs?: string[]) => void;
  onStartUninstallPlan?: (mod: ModSummary) => void;
  onDownloadArchive: (mod: ModSummary, versionId: string) => void;
  isDownloadingArchive: boolean;
  isInstalling: boolean;
  archiveProgress: DownloadProgress | null;
  isInstalled: boolean;
  installedVersion?: string;
  hasUpdate?: boolean;
  instanceId?: string;
  installationSnapshot?: SpriteInstallationSnapshot | null;
  installedLoadingStatus?: LoadingStatus;
}

const apiBase = `${((import.meta as any).env?.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const Markdown: React.FC<{ value: string }> = ({ value }) => <div className="min-w-0 space-y-2 break-words [&_a]:text-sky-400 [&_a]:underline [&_h1]:text-base [&_h2]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-neutral-900 [&_pre]:p-2 [&_table]:block [&_table]:overflow-x-auto [&_img]:max-w-full"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{value}</ReactMarkdown></div>;

export const ModDetailModal: React.FC<Props> = ({
  mod,
  catalogMods,
  onSelectMod,
  onClose,
  onStartInstallPlan,
  onStartUninstallPlan,
  onDownloadArchive,
  isDownloadingArchive,
  isInstalling,
  archiveProgress,
  isInstalled,
  installedVersion,
  hasUpdate,
  instanceId,
  installationSnapshot,
  installedLoadingStatus,
}) => {
  const { t, resolve } = useI18n();
  const [versions, setVersions] = useState<CatalogVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [spriteSets, setSpriteSets] = useState<SpriteSet[]>([]);
  const [selectedSets, setSelectedSets] = useState<string[]>([]);
  const [manifestVersionId, setManifestVersionId] = useState('');
  const [manifestVersion, setManifestVersion] = useState<CatalogVersion | null>(null);
  const [downloadingSprite, setDownloadingSprite] = useState(false);
  const [spriteProgress, setSpriteProgress] = useState<DownloadProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [manifestError, setManifestError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [copied, setCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareError, setShareError] = useState('');
  const [legacyRiskConfirmed, setLegacyRiskConfirmed] = useState(false);
  const [isDraftInitialized, setIsDraftInitialized] = useState(false);

  const modRef = useRef(mod);
  modRef.current = mod;

  const trackerRef = useRef(createModDetailTracker(mod?.id ?? null, instanceId ?? null));

  // Compute baseline and diff from current instance records and manifest
  const baseline = deriveSpriteSelection(
    spriteSets,
    installationSnapshot,
    installedLoadingStatus || 'success'
  );
  const diff = calculateSpriteSelectionDiff(baseline, selectedSets, t);

  // Track baseline identity to prevent accidental overwrite of user draft on standard re-renders
  const baselineKey = `${instanceId || ''}:${mod?.id || ''}:${manifestVersionId}:${installationSnapshot?.operationId || ''}:${installationSnapshot?.selectionHash || ''}:${installedLoadingStatus || ''}`;
  const lastInitializedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (mod?.category !== 'spritepack') return;
    if (loading || manifestError) return;
    if (baseline.mode === 'loading' || baseline.mode === 'error') return;

    if (lastInitializedKeyRef.current !== baselineKey) {
      lastInitializedKeyRef.current = baselineKey;
      setSelectedSets(baseline.initialIds);
      setIsDraftInitialized(true);
    }
  }, [baselineKey, baseline.mode, baseline.initialIds, loading, manifestError, mod?.category]);

  const loadDetails = async (options?: { reason?: LoadReason; targetMod?: ModSummary }) => {
    const target = options?.targetMod ?? modRef.current;
    if (!target) return;
    const reason = options?.reason ?? 'retry';

    await executeDetailLoad(
      trackerRef.current,
      target,
      reason,
      {
        fetchSpriteManifest: (id) => fetchSpriteManifest(id, apiBase),
        fetchModVersion: (id, versionId) => fetchModVersion(id, versionId, apiBase),
        fetchPublishedVersions: (id) => fetchPublishedVersions(id, apiBase),
        fetchModImages: async (id) => {
          const pics = await fetchModImages(id, apiBase);
          return pics.map((url) => new URL(url, window.location.origin).href);
        },
      },
      {
        onStart: (r, m) => {
          setLoading(true);
          setManifestError('');
          if (r === 'initial') {
            setIsDraftInitialized(false);
            lastInitializedKeyRef.current = null;
            setLegacyRiskConfirmed(false);
            setDownloadError('');
            setVersions([]);
            setSelectedVersionId(m.latest_version_id);
            setImages([]);
            setSpriteSets([]);
            setSelectedSets([]);
            setManifestVersionId('');
            setManifestVersion(null);
            setDownloadingSprite(false);
            setSpriteProgress(null);
          } else if (r === 'conflict') {
            setIsDraftInitialized(false);
            lastInitializedKeyRef.current = null;
            setDownloadError(t('modDetail.spriteVersionReloading'));
          }
        },
        onSpritepackSuccess: (manifest, ver, r) => {
          setSpriteSets(manifest.sets);
          setManifestVersionId(ver?.id || manifest.version_id || '');
          setManifestVersion(ver);
          setManifestError('');

          if (r === 'conflict') {
            // Version conflict refresh: re-establish baseline and notify user
            lastInitializedKeyRef.current = null;
            setDownloadError(t('modDetail.spriteVersionRefreshed'));
          }
        },
        onSubmodSuccess: (pubVersions, pics) => {
          setVersions(pubVersions);
          setImages(pics);
          setManifestError('');
        },
        onError: (msg, r) => {
          setIsDraftInitialized(false);
          if (r === 'conflict') {
            setManifestError(t('modDetail.manifestReloadFailed', { message: msg }));
            setDownloadError('');
          } else {
            setManifestError(msg);
          }
        },
        onFinally: () => {
          setLoading(false);
        },
      },
      instanceId
    );
  };

  useEffect(() => {
    trackerRef.current.setContext(instanceId ?? null, mod?.id ?? null);
    if (!mod) {
      return;
    }
    void loadDetails({ reason: 'initial', targetMod: mod });
    return () => {
      trackerRef.current.invalidate();
    };
  }, [instanceId, mod?.id, mod?.category, mod?.latest_version_id]);

  if (!mod) return null;
  const selected = versions.find((version) => version.id === selectedVersionId) || versions[0];
  const orderedVersions = sortVersionHistory(versions, mod.latest_version_id);
  const copyHash = async () => {
    if (!selected) return;
    await navigator.clipboard.writeText(selected.sha256);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  /**
   * 分享：把「这个详情」变成一条能直接粘到浏览器的链接。
   *
   * 链接由 Go 侧生成（`ModShareLink`），规则与 web 端 modShareURL 是同一套；
   * 前端不自己拼字符串，否则两端迟早各写一种。写剪贴板走统一入口，兼顾
   * WebView2 / Android WebView 可能没有异步剪贴板 API 的情况。
   */
  const shareModLink = async () => {
    setShareError('');
    try {
      const link = await ModShareLink(mod.id);
      const ok = await copyToClipboard(link);
      if (!ok) {
        // 链接生成成功但写不进剪贴板：把链接本身显示出来，用户还能手动复制。
        setShareError(t('modDetail.clipboardFailed', { link }));
        return;
      }
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    } catch (error) {
      setShareError(t('modDetail.shareFailed', { message: error instanceof Error ? error.message : String(error) }));
    }
  };
  const downloadSets = async (ids: string[]) => {
    if (!ids.length || downloadingSprite || !isSpriteSelectionValid(ids, spriteSets, loading, manifestError)) return;
    const downloadModId = mod.id;
    setDownloadingSprite(true);
    setSpriteProgress(null);
    setDownloadError('');
    try {
      const archive = await fetchVerifiedSpriteSelection(mod.id, ids, apiBase, fetch, setSpriteProgress, undefined, manifestVersionId || undefined);
      if (modRef.current?.id !== downloadModId) return;
      const url = URL.createObjectURL(archive.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `spritepack_${mod.id}_${ids.length === spriteSets.length ? 'all' : ids.length + '-sets'}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      if (modRef.current?.id !== downloadModId) return;
      const msg = cause instanceof Error ? cause.message : String(cause);
      if (msg.includes('sprite_version_changed')) {
        await loadDetails({ reason: 'conflict', targetMod: mod });
      } else {
        setDownloadError(t('modDetail.setDownloadFailed', { message: msg }));
      }
    } finally {
      if (modRef.current?.id === downloadModId) {
        setDownloadingSprite(false);
        setSpriteProgress(null);
      }
    }
  };

  const progress = mod.category === 'spritepack' ? spriteProgress : archiveProgress;
  const progressPercent = progress && progress.total > 0 ? Math.min(100, Math.round(progress.received / progress.total * 100)) : 0;

  // Determine whether this version differs from what is currently installed
  const isVersionChanged = Boolean(
    hasUpdate ||
    (installationSnapshot?.versionId && manifestVersionId && installationSnapshot.versionId !== manifestVersionId)
  );

  return <m.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2 sm:p-4" variants={overlayVariants} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label={t('modDetail.dialogAria', { title: mod.title })} className="flex max-h-[92dvh] sm:max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-100 shadow-2xl">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-neutral-800 px-4 sm:px-5 py-3 sm:py-4">
        <div className="min-w-0 flex-1"><div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-400"><span className="font-semibold text-emerald-400">{mod.category === 'spritepack' ? t('modDetail.categorySpritepack') : t('modDetail.categorySubmod')}</span><span>·</span><span className="truncate max-w-[160px]">{t('modDetail.author', { name: mod.author.display_name })}</span>{mod.mas_version_range && <><span>·</span><span>{t('modDetail.masRange', { range: mod.mas_version_range })}</span></>}</div><h2 className="text-sm sm:text-base font-bold break-words">{mod.title}</h2></div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* 分享只在详情页：列表项没有稳定上下文，也不值得为它做分享。 */}
          <button onClick={() => void shareModLink()} title={t('modDetail.shareTitle')} aria-label={t('modDetail.shareAria')} className="rounded-lg px-2.5 py-2 text-neutral-400 hover:bg-neutral-800 hover:text-white min-h-[40px] flex items-center gap-1.5 text-xs">
            {shareCopied ? <Check className="h-4 w-4 text-emerald-400" /> : <Share2 className="h-4 w-4" />}
            <span className="hidden sm:inline">{shareCopied ? t('modDetail.copied') : t('modDetail.share')}</span>
          </button>
          <button onClick={onClose} title={t('modDetail.closeTitle')} aria-label={t('modDetail.closeTitle')} className="shrink-0 rounded-lg p-2 text-neutral-400 hover:bg-neutral-800 hover:text-white min-w-[40px] min-h-[40px] flex items-center justify-center"><X className="h-5 w-5" /></button>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3.5 sm:p-5 text-xs leading-relaxed">
        {shareError && (
          // 分享失败与下载失败是两件事：这里不摆「重试下载」，只把链接交出来让用户手动复制。
          <div role="alert" className="flex items-start gap-2 rounded border border-amber-800 bg-amber-950/40 p-3 text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
            <span className="min-w-0 break-all">{shareError}</span>
          </div>
        )}
        <section className="space-y-2"><h3 className="font-semibold text-neutral-100">{t('modDetail.descriptionHeading')}</h3><div className="rounded border border-neutral-800 bg-neutral-950 p-3 text-neutral-300"><Markdown value={resolve(mod.description) || resolve(mod.summary) || t('modDetail.noDescription')} /></div></section>
        {images.length > 0 && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{images.map((url, index) => <img key={url} src={url} alt={t('modDetail.screenshotAlt', { title: mod.title, index: index + 1 })} loading="lazy" className="max-h-80 w-full rounded border border-neutral-800 bg-neutral-950 object-contain" />)}</div>}
        {loading && <p className="text-neutral-400">{t('modDetail.loadingDetails')}</p>}
        {manifestError && mod.category !== 'spritepack' && (
          <div role="alert" className="flex items-center justify-between rounded border border-rose-800 bg-rose-950/50 p-3 text-rose-200">
            <span>{t('modDetail.detailLoadFailed', { message: manifestError })}</span>
            <button
              type="button"
              onClick={() => void loadDetails({ reason: 'retry' })}
              className="flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
            >
              <RefreshCw className="h-3 w-3" /> {t('common.retry')}
            </button>
          </div>
        )}
        {downloadError && (
          <div role="alert" className="flex items-center justify-between rounded border border-rose-800 bg-rose-950/50 p-3 text-rose-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{downloadError}</span>
            </div>
            <div className="flex items-center gap-2">
              {selectedSets.length > 0 && !downloadingSprite && (
                <button
                  type="button"
                  onClick={() => void downloadSets(selectedSets)}
                  className="rounded bg-rose-900/60 px-2 py-1 text-xs text-rose-100 hover:bg-rose-800"
                >
                  {t('modDetail.retryDownload')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setDownloadError('')}
                className="rounded p-1 text-rose-300 hover:text-white"
                title={t('modDetail.closeNotice')}
                aria-label={t('modDetail.closeNotice')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
        {mod.category === 'spritepack' ? (
          <SpritepackSelection
            spriteSets={spriteSets}
            selectedSets={selectedSets}
            onToggleSet={(id) =>
              setSelectedSets((prev) =>
                prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
              )
            }
            onSelectAll={() => setSelectedSets(spriteSets.map((set) => set.id))}
            onDeselectAll={() => setSelectedSets([])}
            loading={loading}
            error={manifestError}
            onRetry={() => void loadDetails({ reason: 'retry' })}
            baseline={baseline}
            diff={diff}
            legacyRiskConfirmed={legacyRiskConfirmed}
            onToggleLegacyRisk={setLegacyRiskConfirmed}
          />
        ) : (
          <section className="space-y-3"><h3 className="font-semibold">{t('modDetail.versionHistory')}</h3><div className="flex gap-2 overflow-x-auto pb-1">{orderedVersions.map((version) => <button key={version.id} onClick={() => setSelectedVersionId(version.id)} className={`shrink-0 rounded px-3 py-1.5 ${selected?.id === version.id ? 'bg-emerald-700 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}>{version.version}{version.deprecated && <AlertTriangle className="ml-1 inline h-3 w-3 text-amber-400" aria-label={t('modDetail.deprecatedAria')} />}</button>)}</div>
            {!loading && !manifestError && versions.length === 0 && <p className="text-neutral-400">{t('modDetail.noVersions')}</p>}
            {selected && <div className="space-y-4 rounded border border-neutral-800 bg-neutral-950 p-4"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 pb-3"><div><div className="font-semibold text-neutral-100">{t('modDetail.versionLabel', { version: selected.version })}</div><div className="text-neutral-400">{t('modDetail.versionMeta', { size: formatBytes(selected.size_bytes) })}{selected.created_at && ` · ${t('modDetail.publishedAt', { date: new Date(selected.created_at).toLocaleDateString() })}`}</div></div>{selected.deprecated && <span className="text-amber-400">{t('modDetail.deprecatedNotice', { reason: selected.deprecation_reason || t('modDetail.deprecatedFallback') })}</span>}</div>
              <div><h4 className="mb-1 font-medium text-neutral-400">{t('modDetail.releaseNotes')}</h4><div className="text-neutral-200"><Markdown value={selected.release_notes || t('modDetail.noReleaseNotes')} /></div></div>
              {(selected.dependencies || []).length > 0 && <div className="space-y-2"><h4 className="font-medium text-neutral-400">{t('modDetail.dependenciesHeading')}</h4>{selected.dependencies!.map((dep, index) => {
                const linkedIds = dep.linked_mod_ids?.length ? dep.linked_mod_ids : dep.linked_mod_id ? [dep.linked_mod_id] : [];
                const linkedMods = linkedIds.map((id) => catalogMods.find((candidate) => candidate.id === id)).filter((candidate): candidate is ModSummary => Boolean(candidate));
                return <div key={`${dep.mod_id}-${index}`} className="flex flex-wrap justify-between gap-2 rounded border border-neutral-800 bg-neutral-900 px-3 py-2"><span className="flex flex-wrap gap-2">{linkedMods.length ? linkedMods.map((candidate) => <button key={candidate.id} type="button" onClick={() => onSelectMod(candidate)} className="text-left font-medium text-emerald-400 hover:underline">{candidate.title}</button>) : dep.mod_title || dep.mod_id}</span><span className="text-neutral-400">{dep.version_range} {dep.required ? t('modDetail.depRequired') : t('modDetail.depOptional')}</span></div>;
              })}</div>}
              <div><div className="mb-1 flex items-center justify-between gap-2"><h4 className="font-medium text-neutral-400">{t('modDetail.archiveHash')}</h4><button onClick={() => void copyHash()} title={t('modDetail.copyHash')} aria-label={t('modDetail.copyHash')} className="text-emerald-400">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button></div><div className="break-all rounded border border-neutral-800 bg-neutral-900 p-2 font-mono text-neutral-200 select-all">{selected.sha256}</div></div>
              {selected.scan_report_id && <p className="text-neutral-500">{t('modDetail.scanReportNote', { id: selected.scan_report_id })}</p>}
            </div>}
          </section>)}
      </div>
      {progress && <div role="status" aria-label={t('modDetail.downloadProgress')} className="shrink-0 space-y-1.5 border-t border-neutral-800 bg-neutral-900 px-5 py-3 text-xs"><div className="flex justify-between gap-3 text-neutral-300"><span>{progress.stage === 'connecting' ? t('modDetail.progressConnecting') : progress.stage === 'verifying' ? t('modDetail.progressVerifying') : t('modDetail.progressDownloading')}</span><span className="font-mono tabular-nums">{progress.total > 0 ? `${progressPercent}% · ${formatBytes(progress.received)} / ${formatBytes(progress.total)}` : formatBytes(progress.received)}</span></div><div className="h-2 overflow-hidden rounded bg-neutral-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.total > 0 ? progressPercent : undefined}><div className={`h-full bg-emerald-500 transition-[width] duration-150 ${progress.total > 0 ? '' : 'w-full animate-pulse'}`} style={progress.total > 0 ? { width: `${progressPercent}%` } : undefined} /></div></div>}
      {mod.category === 'spritepack' ? (
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-neutral-800 p-3 sm:p-4 text-xs">
          <span className="text-neutral-400">
            {isInstalled
              ? t(hasUpdate ? 'modDetail.installedUpdatable' : 'modDetail.installed', { version: installedVersion || '' })
              : t('modDetail.setsSelected', { selected: selectedSets.length, total: spriteSets.length })}
          </span>
          <div className="flex flex-wrap gap-2">
            {isInstalled && onStartUninstallPlan && (
              <button
                type="button"
                disabled={isInstalling}
                onClick={() => {
                  onClose();
                  onStartUninstallPlan(mod);
                }}
                className="flex items-center gap-1.5 rounded border border-rose-800/80 bg-rose-950/40 px-3 py-2 font-medium text-rose-300 hover:bg-rose-900/60 disabled:opacity-50"
                title={t('modDetail.uninstallAllTitle')}
              >
                <X className="h-4 w-4" />
                {t('modDetail.uninstallMod')}
              </button>
            )}
            <button
              type="button"
              disabled={!isSpriteSelectionValid(selectedSets, spriteSets, loading, manifestError) || downloadingSprite}
              onClick={() => void downloadSets(selectedSets)}
              className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-2 text-neutral-100 hover:bg-neutral-700 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {t('modDetail.downloadSelectedZip', { count: selectedSets.length })}
            </button>

            {/* Action button routing: Install / Apply Selection / Uninstall */}
            {loading ? (
              <button
                type="button"
                disabled
                className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-2 font-semibold text-neutral-500 disabled:opacity-50 cursor-not-allowed"
              >
                <RefreshCw className="h-4 w-4 animate-spin" />
                {t('modDetail.loadingManifest')}
              </button>
            ) : manifestError ? (
              <button
                type="button"
                disabled
                className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-2 font-semibold text-neutral-500 disabled:opacity-50 cursor-not-allowed"
              >
                {t('modDetail.manifestFailed')}
              </button>
            ) : baseline.mode === 'loading' || baseline.mode === 'error' ? (
              <button
                type="button"
                disabled
                className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-2 font-semibold text-neutral-500 disabled:opacity-50 cursor-not-allowed"
              >
                {baseline.mode === 'loading' ? t('modDetail.loadingInstallState') : t('modDetail.installStateFailed')}
              </button>
            ) : !isDraftInitialized ? (
              <button
                type="button"
                disabled
                className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-2 font-semibold text-neutral-500 disabled:opacity-50 cursor-not-allowed"
              >
                {t('modDetail.initializingSelection')}
              </button>
            ) : baseline.mode === 'first_install' ? (
              <button
                type="button"
                disabled={!isSpriteSelectionValid(selectedSets, spriteSets, loading, manifestError) || isInstalling}
                onClick={() => {
                  onClose();
                  onStartInstallPlan(
                    mod,
                    manifestVersion || undefined,
                    selectedSets
                  );
                }}
                className="flex items-center gap-1.5 rounded bg-emerald-700 px-3 py-2 font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                {isInstalling ? t('catalog.installing') : t('modDetail.installSelectedSets', { count: selectedSets.length })}
              </button>
            ) : baseline.mode === 'known_installed' ? (
              selectedSets.length === 0 ? (
                <button
                  type="button"
                  disabled={isInstalling}
                  onClick={() => {
                    onClose();
                    onStartUninstallPlan?.(mod);
                  }}
                  className="flex items-center gap-1.5 rounded bg-rose-700 px-3 py-2 font-semibold text-white hover:bg-rose-600 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                  {t('modDetail.uninstallSpritepackNoSets')}
                </button>
              ) : diff.isUnchanged && !isVersionChanged ? (
                <button
                  type="button"
                  disabled
                  className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-2 font-semibold text-neutral-500 cursor-not-allowed border border-neutral-700"
                >
                  {t('modDetail.selectionUnchanged')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!isSpriteSelectionValid(selectedSets, spriteSets, loading, manifestError) || isInstalling}
                  onClick={() => {
                    onClose();
                    onStartInstallPlan(
                      mod,
                      manifestVersion || undefined,
                      selectedSets
                    );
                  }}
                  className="flex items-center gap-1.5 rounded bg-emerald-700 px-3 py-2 font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  {isInstalling ? t('modDetail.applying') : t('modDetail.applySelection', { count: selectedSets.length })}
                </button>
              )
            ) : baseline.mode === 'unknown_installed' ? (
              selectedSets.length === 0 ? (
                <button
                  type="button"
                  disabled={isInstalling}
                  onClick={() => {
                    onClose();
                    onStartUninstallPlan?.(mod);
                  }}
                  className="flex items-center gap-1.5 rounded bg-rose-700 px-3 py-2 font-semibold text-white hover:bg-rose-600 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                  {t('modDetail.uninstallSpritepackNoSets')}
                </button>
              ) : !legacyRiskConfirmed ? (
                <button
                  type="button"
                  disabled
                  className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-2 font-semibold text-neutral-500 cursor-not-allowed border border-neutral-700"
                >
                  {t('modDetail.confirmLegacyRiskFirst')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!isSpriteSelectionValid(selectedSets, spriteSets, loading, manifestError) || isInstalling}
                  onClick={() => {
                    onClose();
                    onStartInstallPlan(
                      mod,
                      manifestVersion || undefined,
                      selectedSets
                    );
                  }}
                  className="flex items-center gap-1.5 rounded bg-emerald-700 px-3 py-2 font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  <Download className="h-4 w-4" />
                  {isInstalling ? t('modDetail.applying') : t('modDetail.applySelection', { count: selectedSets.length })}
                </button>
              )
            ) : null}
          </div>
        </footer>
      ) : (
        selected && (
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-neutral-800 p-3 sm:p-4 text-xs">
            <span className="text-neutral-400">{isInstalled ? t(hasUpdate ? 'modDetail.installedUpdatable' : 'modDetail.installed', { version: installedVersion || '' }) : t('modDetail.selectVersionHint')}</span>
            <div className="flex flex-wrap gap-2">
              {isInstalled && onStartUninstallPlan && (
                <button
                  type="button"
                  disabled={isInstalling}
                  onClick={() => {
                    onClose();
                    onStartUninstallPlan(mod);
                  }}
                  className="flex items-center gap-1.5 rounded border border-rose-800/80 bg-rose-950/40 px-3 py-2 font-medium text-rose-300 hover:bg-rose-900/60 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                  {t('modDetail.uninstallMod')}
                </button>
              )}
              <button onClick={() => onDownloadArchive(mod, selected.id)} disabled={isDownloadingArchive} className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-2 text-neutral-100 hover:bg-neutral-700 disabled:opacity-50"><Download className="h-4 w-4" />{isDownloadingArchive
                ? archiveProgress?.stage === 'connecting'
                  ? t('modDetail.progressConnectingShort')
                  : archiveProgress?.stage === 'verifying'
                    ? t('modDetail.progressVerifyingShort')
                    : t('modDetail.progressDownloadingPercent', {
                        percent: archiveProgress && archiveProgress.total > 0
                          ? Math.round((archiveProgress.received / archiveProgress.total) * 100)
                          : 0,
                      })
                : t('modDetail.downloadZip')}</button>
              <button onClick={() => { onClose(); onStartInstallPlan(mod, selected); }} disabled={isInstalling} className="flex items-center gap-1.5 rounded bg-emerald-700 px-3 py-2 font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"><Download className="h-4 w-4" />{isInstalling ? t('catalog.installing') : t('catalog.install')}</button>
            </div>
          </footer>
        )
      )}
    </section>
  </m.div>;
};
