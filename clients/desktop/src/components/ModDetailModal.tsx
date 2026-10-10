import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, Download, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fetchModImages, fetchPublishedVersions, fetchSpriteSets, fetchVerifiedSpriteSelection, type CatalogVersion, type DownloadProgress, type SpriteSet } from '../../../../ui/catalog-api';
import { ModSummary } from '../types/client';

interface Props {
  mod: ModSummary | null;
  catalogMods: ModSummary[];
  onSelectMod: (mod: ModSummary) => void;
  onClose: () => void;
  onStartInstallPlan: (mod: ModSummary, version: CatalogVersion) => void;
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
  const [downloadingSprite, setDownloadingSprite] = useState(false);
  const [spriteProgress, setSpriteProgress] = useState<DownloadProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!mod) return;
    let active = true;
    setLoading(true);
    setError('');
    setVersions([]);
    setSelectedVersionId(mod.latest_version_id);
    setImages([]);
    setSpriteSets([]);
    const detail = mod.category === 'spritepack'
      ? fetchSpriteSets(mod.id, apiBase).then((sets) => { if (active) { setSpriteSets(sets); setSelectedSets(sets.length === 1 ? [sets[0].id] : []); } })
      : fetchPublishedVersions(mod.id, apiBase).then((items) => { if (active) setVersions(items.filter((item) => item.state === 'published')); });
    const pictures = mod.category === 'spritepack' ? Promise.resolve() : fetchModImages(mod.id, apiBase)
      .then((items) => { if (active) setImages(items.map((url) => new URL(url, window.location.origin).href)); });
    Promise.all([detail, pictures]).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [mod?.id, mod?.category]);

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
    if (!ids.length || downloadingSprite) return;
    setDownloadingSprite(true);
    setSpriteProgress(null);
    try {
      const archive = await fetchVerifiedSpriteSelection(mod.id, ids, apiBase, fetch, setSpriteProgress);
      const url = URL.createObjectURL(archive.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `spritepack_${mod.id}_${ids.length === spriteSets.length ? 'all' : ids.length + '-sets'}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) { setError(`套装下载失败：${cause instanceof Error ? cause.message : String(cause)}`); }
    finally { setDownloadingSprite(false); setSpriteProgress(null); }
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
        {error && <div role="alert" className="rounded border border-rose-800 bg-rose-950/50 p-3 text-rose-200">详情读取失败：{error}</div>}
        {mod.category === 'spritepack' ? <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">外观套装 · {spriteSets.length} 套</h3><div className="flex flex-wrap gap-2"><button onClick={() => setSelectedSets(selectedSets.length === spriteSets.length ? [] : spriteSets.map((set) => set.id))} className="rounded bg-neutral-800 px-2 py-1.5">{selectedSets.length === spriteSets.length ? '取消全选' : '全选'}</button><button disabled={!selectedSets.length || downloadingSprite} onClick={() => void downloadSets(selectedSets)} className="rounded bg-emerald-700 px-2 py-1.5 disabled:opacity-50">下载已选 ({selectedSets.length})</button><button disabled={!spriteSets.length || downloadingSprite} onClick={() => void downloadSets(spriteSets.map((set) => set.id))} className="rounded border border-emerald-700 px-2 py-1.5 disabled:opacity-50">全部下载</button></div></div>{!loading && !error && spriteSets.length === 0 && <p className="text-neutral-400">暂无公开套装</p>}{spriteSets.map((set) => <div key={set.id} className="rounded border border-neutral-800 bg-neutral-950 p-3"><label className="flex cursor-pointer items-center gap-2 font-semibold"><input type="checkbox" checked={selectedSets.includes(set.id)} onChange={(event) => setSelectedSets((previous) => event.target.checked ? [...previous, set.id] : previous.filter((id) => id !== set.id))} />{set.name} <span className="text-neutral-500">({set.items.length})</span></label><div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">{set.items.map((item, index) => <div key={`${set.id}-${index}`} className="min-w-0 text-neutral-300">{item.preview_url && <img src={new URL(item.preview_url, window.location.origin).href} alt={item.display_name} loading="lazy" className="mb-1 aspect-square w-full rounded bg-neutral-900 object-contain" />}<span className="break-words">{item.display_name}</span></div>)}</div></div>)}</section> :
          <section className="space-y-3"><h3 className="font-semibold">版本历史</h3><div className="flex gap-2 overflow-x-auto pb-1">{orderedVersions.map((version) => <button key={version.id} onClick={() => setSelectedVersionId(version.id)} className={`shrink-0 rounded px-3 py-1.5 ${selected?.id === version.id ? 'bg-emerald-700 text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}>{version.version}{version.deprecated && <AlertTriangle className="ml-1 inline h-3 w-3 text-amber-400" aria-label="不推荐使用" />}</button>)}</div>
            {!loading && !error && versions.length === 0 && <p className="text-neutral-400">暂无公开版本</p>}
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
          </section>}
      </div>
      {progress && <div role="status" aria-label="下载进度" className="shrink-0 space-y-1.5 border-t border-neutral-800 bg-neutral-900 px-5 py-3 text-xs"><div className="flex justify-between gap-3 text-neutral-300"><span>{progress.stage === 'connecting' ? '正在连接下载源' : progress.stage === 'verifying' ? '正在校验' : '正在下载'}</span><span className="font-mono tabular-nums">{progress.total > 0 ? `${progressPercent}% · ${formatBytes(progress.received)} / ${formatBytes(progress.total)}` : formatBytes(progress.received)}</span></div><div className="h-2 overflow-hidden rounded bg-neutral-700" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.total > 0 ? progressPercent : undefined}><div className={`h-full bg-emerald-500 transition-[width] duration-150 ${progress.total > 0 ? '' : 'w-full animate-pulse'}`} style={progress.total > 0 ? { width: `${progressPercent}%` } : undefined} /></div></div>}
      {mod.category !== 'spritepack' && selected && <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-neutral-800 p-4 text-xs"><span className="text-neutral-400">{isInstalled ? `${hasUpdate ? '可更新' : '已安装'} ${installedVersion || ''}` : '选择版本后下载或安装'}</span><div className="flex flex-wrap gap-2"><button onClick={() => onDownloadArchive(mod, selected.id)} disabled={isDownloadingArchive} className="flex items-center gap-1.5 rounded bg-neutral-800 px-3 py-2 text-neutral-100 hover:bg-neutral-700 disabled:opacity-50"><Download className="h-4 w-4" />{isDownloadingArchive ? (archiveProgress?.stage === 'connecting' ? '连接中' : archiveProgress?.stage === 'verifying' ? '校验中' : `下载中 ${archiveProgress && archiveProgress.total > 0 ? Math.round(archiveProgress.received / archiveProgress.total * 100) : 0}%`) : '下载 ZIP'}</button><button onClick={() => { onClose(); onStartInstallPlan(mod, selected); }} disabled={isInstalling} className="flex items-center gap-1.5 rounded bg-emerald-700 px-3 py-2 font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"><Download className="h-4 w-4" />{isInstalling ? '安装中…' : '安装'}</button></div></footer>}
    </section>
  </div>;
};
