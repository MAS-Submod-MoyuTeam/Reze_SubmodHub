import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, Download, RefreshCw, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fetchModImages, fetchModVersion, fetchPublishedVersions, fetchSpriteManifest, fetchVerifiedSpriteSelection, type CatalogVersion, type DownloadProgress, type SpriteSet } from '../../../../ui/catalog-api';
import { ModSummary } from '../types/client';
import { isSpriteSelectionValid } from '../spritepackUtils';
import { SpritepackSelection } from './SpritepackSelection';
import { createModDetailTracker, executeDetailLoad, type LoadReason } from '../modDetailTracker';

interface Props {
  mod: ModSummary | null;
  catalogMods: ModSummary[];
  onSelectMod: (mod: ModSummary) => void;
  onClose: () => void;
  onStartInstallPlan: (mod: ModSummary, version?: CatalogVersion, selectedSpriteSetIDs?: string[]) => void;
  onDownloadArchive: (mod: ModSummary, versionId: string) => void;
  isDownloadingArchive: boolean;
  isInstalling: boolean;
  archiveProgress: DownloadProgress | null;
  isInstalled: boolean;
  installedVersion?: string;
  hasUpdate?: boolean;
}

const apiBase = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const Markdown: React.FC<{ value: string }> = ({ value }) => <div className="min-w-0 space-y-2 break-words [&_a]:text-sky-400 [&_a]:underline [&_h1]:text-base [&_h2]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-neutral-900 [&_pre]:p-2 [&_table]:block [&_table]:overflow-x-auto [&_img]:max-w-full"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>{value}</ReactMarkdown></div>;

export const ModDetailModal: React.FC<Props> = ({ mod, catalogMods, onSelectMod, onClose, onStartInstallPlan, onDownloadArchive, isDownloadingArchive, isInstalling, archiveProgress, isInstalled, installedVersion, hasUpdate }) => {
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

  const modRef = useRef(mod);
  modRef.current = mod;

  const trackerRef = useRef(createModDetailTracker(mod?.id ?? null));

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
            setDownloadError('精灵包版本已更新，正在重新加载最新清单…');
          }
        },
        onSpritepackSuccess: (manifest, ver, r) => {
          setSpriteSets(manifest.sets);
          if (r === 'conflict') {
            setSelectedSets([]);
            setDownloadError('精灵包版本已更新，已刷新至最新版本，请重新选择套装。');
          } else {
            setSelectedSets(manifest.sets.map((set) => set.id));
          }
          setManifestVersionId(ver?.id || manifest.version_id || '');
          setManifestVersion(ver);
          setManifestError('');
        },
        onSubmodSuccess: (pubVersions, pics) => {
          setVersions(pubVersions);
          setImages(pics);
          setManifestError('');
        },
        onError: (msg, r) => {
          if (r === 'conflict') {
            setManifestError(`重新加载清单失败：${msg}`);
            setDownloadError('');
          } else {
            setManifestError(msg);
          }
        },
        onFinally: () => {
          setLoading(false);
        },
      }
    );
  };

  useEffect(() => {
    trackerRef.current.setMod(mod?.id ?? null);
    if (!mod) {
      return;
    }
    void loadDetails({ reason: 'initial', targetMod: mod });
    return () => {
      trackerRef.current.invalidate();
    };
  }, [mod?.id, mod?.category, mod?.latest_version_id]);

  if (!mod) return null;
  const selected = versions.find((version) => version.id === selectedVersionId) || versions[0];
  const orderedVersions = [...versions].sort((a, b) => {
    if (a.id === mod.latest_version_id) return -1;
    if (b.id === mod.latest_version_id) return 1;
    return (b.created_at || '').localeCompare(a.created_at || '');
  });
  const copyHash = async () => {
    if (!selected) return;
    await navigator.clipboard.writeText(selected.sha256);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
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
        setDownloadError(`套装下载失败：${msg}`);
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

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label={`${mod.title} 详情`} className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900 text-neutral-100 shadow-2xl">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-neutral-800 px-5 py-4">
        <div className="min-w-0"><div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-400"><span className="font-semibold text-emerald-400">{mod.category === 'spritepack' ? 'Spritepack 服饰配件' : 'Submod 功能模组'}</span><span>·</span><span>作者: {mod.author.display_name}</span>{mod.mas_version_range && <><span>·</span><span>兼容 MAS {mod.mas_version_range}</span></>}</div><h2 className="text-base font-bold">{mod.title}</h2></div>
        <button onClick={onClose} title="关闭详情" aria-label="关闭详情" className="shrink-0 rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"><X className="h-5 w-5" /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 text-xs leading-relaxed">
        <section className="space-y-2"><h3 className="font-semibold text-neutral-100">详细简介</h3><div className="rounded border border-neutral-800 bg-neutral-950 p-3 text-neutral-300"><Markdown value={mod.description || mod.summary || '暂无简介'} /></div></section>
        {images.length > 0 && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{images.map((url, index) => <img key={url} src={url} alt={`${mod.title} 详情图 ${index + 1}`} loading="lazy" className="max-h-80 w-full rounded border border-neutral-800 bg-neutral-950 object-contain" />)}</div>}
        {loading && <p className="text-neutral-400">正在读取详情...</p>}
        {manifestError && mod.category !== 'spritepack' && (
          <div role="alert" className="flex items-center justify-between rounded border border-rose-800 bg-rose-950/50 p-3 text-rose-200">
            <span>详情读取失败：{manifestError}</span>
            <button
              type="button"
              onClick={() => void loadDetails({ reason: 'retry' })}
              className="flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200 hover:bg-neutral-700"
            >
              <RefreshCw className="h-3 w-3" /> 重试
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
                  重试下载
                </button>
              )}
              <button
                type="button"
                onClick={() => setDownloadError('')}
                className="rounded p-1 text-rose-300 hover:text-white"
                title="关闭提示"
                aria-label="关闭提示"
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
          />
        ) : (
          <section className="space-y-3"><h3 className="font-semibold">版本历史</h3><div className="flex gap-2 overflow-x-auto pb-1">{orderedVersions.map((version) => <button key={version.id} onClick={() => setSelectedVersionId(version.id)} className={`shrink-0 rounded px-3 py-1.5 ${selected?.id === version.id ? 'bg-emerald-700 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}>{version.version}{version.deprecated && <AlertTriangle className="ml-1 inline h-3 w-3 text-amber-400" aria-label="不推荐使用" />}</button>)}</div>
            {!loading && !manifestError && versions.length === 0 && <p className="text-neutral-400">暂无公开版本</p>}
            {selected && <div className="space-y-4 rounded border border-neutral-800 bg-neutral-950 p-4"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 pb-3"><div><div className="font-semibold text-neutral-100">版本 {selected.version}</div><div className="text-neutral-400">大小: {formatBytes(selected.size_bytes)}{selected.created_at && ` · 发布于 ${new Date(selected.created_at).toLocaleDateString()}`}</div></div>{selected.deprecated && <span className="text-amber-400">不推荐使用：{selected.deprecation_reason || '请查看其他版本'}</span>}</div>
              <div><h4 className="mb-1 font-medium text-neutral-400">发行说明</h4><div className="text-neutral-200"><Markdown value={selected.release_notes || '暂无更新日志'} /></div></div>
              {(selected.dependencies || []).length > 0 && <div className="space-y-2"><h4 className="font-medium text-neutral-400">前置模组依赖</h4>{selected.dependencies!.map((dep, index) => {
                const linkedIds = dep.linked_mod_ids?.length ? dep.linked_mod_ids : dep.linked_mod_id ? [dep.linked_mod_id] : [];
                const linkedMods = linkedIds.map((id) => catalogMods.find((candidate) => candidate.id === id)).filter((candidate): candidate is ModSummary => Boolean(candidate));
                return <div key={`${dep.mod_id}-${index}`} className="flex flex-wrap justify-between gap-2 rounded border border-neutral-800 bg-neutral-900 px-3 py-2"><span className="flex flex-wrap gap-2">{linkedMods.length ? linkedMods.map((candidate) => <button key={candidate.id} type="button" onClick={() => onSelectMod(candidate)} className="text-left font-medium text-emerald-400 hover:underline">{candidate.title}</button>) : dep.mod_title || dep.mod_id}</span><span className="text-neutral-400">{dep.version_range} {dep.required ? '(必需)' : '(可选建议)'}</span></div>;
              })}</div>}
              <div><div className="mb-1 flex items-center justify-between gap-2"><h4 className="font-medium text-neutral-400">归档 SHA-256</h4><button onClick={() => void copyHash()} title="复制 SHA-256" aria-label="复制 SHA-256" className="text-emerald-400">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button></div><div className="break-all rounded border border-neutral-800 bg-neutral-900 p-2 font-mono text-neutral-200 select-all">{selected.sha256}</div></div>
              {selected.scan_report_id && <p className="text-neutral-500">扫描报告 ID：{selected.scan_report_id}。公开接口暂未提供完整扫描报告。</p>}
            </div>}
          </section>)}
      </div>
      {progress && <div role="status" aria-label="下载进度" className="shrink-0 space-y-1.5 border-t border-neutral-800 bg-neutral-900 px-5 py-3 text-xs"><div className="flex justify-between gap-3 text-neutral-300"><span>{progress.stage === 'connecting' ? '正在连接下载源' : progress.stage === 'verifying' ? '正在校验' : '正在下载'}</span><span className="font-mono tabular-nums">{progress.total > 0 ? `${progressPercent}% · ${formatBytes(progress.received)} / ${formatBytes(progress.total)}` : formatBytes(progress.received)}</span></div><div className="h-2 overflow-hidden rounded bg-neutral-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.total > 0 ? progressPercent : undefined}><div className={`h-full bg-emerald-500 transition-[width] duration-150 ${progress.total > 0 ? '' : 'w-full animate-pulse'}`} style={progress.total > 0 ? { width: `${progressPercent}%` } : undefined} /></div></div>}
      {mod.category === 'spritepack' ? (
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-neutral-800 p-4 text-xs">
          <span className="text-neutral-400">
            {isInstalled
              ? `${hasUpdate ? '可更新' : '已安装'} ${installedVersion || ''}`
              : `已选择 ${selectedSets.length}/${spriteSets.length} 个外观套装`}
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!isSpriteSelectionValid(selectedSets, spriteSets, loading, manifestError) || downloadingSprite}
              onClick={() => void downloadSets(selectedSets)}
              className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-2 text-neutral-100 hover:bg-neutral-700 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              下载已选 ZIP ({selectedSets.length})
            </button>
            <button
              type="button"
              disabled={!isSpriteSelectionValid(selectedSets, spriteSets, loading, manifestError) || isInstalling}
              onClick={() => {
                onClose();
                onStartInstallPlan(
                  mod,
                  manifestVersion || undefined,
                  selectedSets,
                );
              }}
              className="flex items-center gap-1.5 rounded bg-emerald-700 px-3 py-2 font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {isInstalling ? '安装中…' : `安装已选套装 (${selectedSets.length})`}
            </button>
          </div>
        </footer>
      ) : (
        selected && (
          <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-neutral-800 p-4 text-xs">
            <span className="text-neutral-400">{isInstalled ? `${hasUpdate ? '可更新' : '已安装'} ${installedVersion || ''}` : '选择版本后下载或安装'}</span>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => onDownloadArchive(mod, selected.id)} disabled={isDownloadingArchive} className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-2 text-neutral-100 hover:bg-neutral-700 disabled:opacity-50"><Download className="h-4 w-4" />{isDownloadingArchive ? (archiveProgress?.stage === 'connecting' ? '连接中' : archiveProgress?.stage === 'verifying' ? '校验中' : `下载中 ${archiveProgress && archiveProgress.total > 0 ? Math.round(archiveProgress.received / archiveProgress.total * 100) : 0}%`) : '下载 ZIP'}</button>
              <button onClick={() => { onClose(); onStartInstallPlan(mod, selected); }} disabled={isInstalling} className="flex items-center gap-1.5 rounded bg-emerald-700 px-3 py-2 font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"><Download className="h-4 w-4" />{isInstalling ? '安装中…' : '安装'}</button>
            </div>
          </footer>
        )
      )}
    </section>
  </div>;
};
