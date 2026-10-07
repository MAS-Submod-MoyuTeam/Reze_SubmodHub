import { useEffect, useState } from 'react';
import { Download, ImageOff, LoaderCircle } from 'lucide-react';
import { fetchSpriteSets, fetchVerifiedSpriteSelection, type SpriteSet } from '../../../ui/catalog-api';

interface SpritepackSetsProps {
  modID: string;
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

export function SpritepackSets({ modID, showToast }: SpritepackSetsProps) {
  const [sets, setSets] = useState<SpriteSet[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    fetchSpriteSets(modID, base)
      .then((items) => {
        if (!active) return;
        setSets(items);
        setSelected(items.length === 1 ? [items[0].id] : []);
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'unknown_error'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [modID, base]);

  const download = async (ids: string[]) => {
    if (ids.length === 0 || downloading) return;
    setDownloading(true);
    try {
      const archive = await fetchVerifiedSpriteSelection(modID, ids, base);
      const url = URL.createObjectURL(archive.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `spritepack_${modID}_${ids.length === sets.length ? 'all' : ids.length + '-sets'}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      showToast('success', '精灵包 ZIP 已校验并交给浏览器保存。');
    } catch (reason) {
      showToast('error', `精灵包下载失败：${reason instanceof Error ? reason.message : 'unknown_error'}`);
    } finally {
      setDownloading(false);
    }
  };

  if (loading) return <div className="flex items-center gap-2 text-neutral-500"><LoaderCircle className="w-4 h-4 animate-spin" />正在读取精灵包内容</div>;
  if (error) return <div className="flex items-center justify-between gap-3 text-rose-700"><span>套件列表加载失败：{error}</span><button onClick={() => { setLoading(true); fetchSpriteSets(modID, base).then((items) => { setSets(items); setError(''); setLoading(false); }).catch((reason) => { setError(String(reason)); setLoading(false); }); }} className="underline">重试</button></div>;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">精灵包套件</h3>
          <p className="text-[11px] text-neutral-500 mt-1">{sets.length} 套 · {sets.reduce((sum, set) => sum + set.items.length, 0)} 个精灵项目</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setSelected(selected.length === sets.length ? [] : sets.map((set) => set.id))} className="px-2.5 py-1.5 border border-neutral-300 rounded text-neutral-700 hover:bg-neutral-50">{selected.length === sets.length ? '取消全选' : '全选'}</button>
          <button type="button" onClick={() => void download(selected)} disabled={!selected.length || downloading} className="px-3 py-1.5 bg-emerald-700 text-white rounded disabled:opacity-40 flex items-center gap-1.5"><Download className="w-3.5 h-3.5" />下载已选 ({selected.length})</button>
          <button type="button" onClick={() => void download(sets.map((set) => set.id))} disabled={!sets.length || downloading} className="px-3 py-1.5 border border-emerald-700 text-emerald-800 rounded disabled:opacity-40">全部下载</button>
        </div>
      </div>
      {sets.map((set) => (
        <div key={set.id} className="border border-neutral-200 rounded-md p-3 space-y-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={selected.includes(set.id)} onChange={(event) => setSelected((before) => event.target.checked ? [...before, set.id] : before.filter((id) => id !== set.id))} className="mt-0.5 accent-emerald-700" />
            <span className="font-semibold text-neutral-900">{set.name}</span>
            <span className="text-neutral-400">({set.items.length})</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-5">
            {set.items.map((item, index) => (
              <div key={`${set.id}-${index}`} className="flex items-center gap-2 min-w-0">
                {item.preview_url
                  ? <img src={item.preview_url} alt="" loading="lazy" className="w-14 h-14 shrink-0 object-contain bg-neutral-50 border border-neutral-200 rounded" />
                  : <span className="w-14 h-14 shrink-0 bg-neutral-50 border border-neutral-200 rounded flex items-center justify-center text-neutral-300"><ImageOff className="w-5 h-5" /></span>}
                <span className="break-words min-w-0 text-neutral-700">{item.display_name}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
