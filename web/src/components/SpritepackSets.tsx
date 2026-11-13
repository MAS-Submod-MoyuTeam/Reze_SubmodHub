import React, { useEffect, useState } from 'react';
import { apiBase } from '../apiBase';
import { Download, ImageOff, LoaderCircle } from 'lucide-react';
import { fetchSpriteSets, fetchVerifiedSpriteSelection, type SpriteSet } from '../../../ui/catalog-api';
import { useI18n } from '../i18n';

interface SpritepackSetsProps {
  modID: string;
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

export function SpritepackSets({ modID, showToast }: SpritepackSetsProps) {
  const { t } = useI18n();
  const [sets, setSets] = useState<SpriteSet[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const base = apiBase();

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
      showToast('success', t('spritepack.zipSaved'));
    } catch (reason) {
      showToast('error', t('spritepack.zipFailed', { error: reason instanceof Error ? reason.message : 'unknown_error' }));
    } finally {
      setDownloading(false);
    }
  };

  if (loading) return <div className="flex items-center gap-2 text-neutral-500"><LoaderCircle className="w-4 h-4 animate-spin" />{t('spritepack.setsLoading')}</div>;
  if (error) return <div className="flex items-center justify-between gap-3 text-rose-700"><span>{t('spritepack.setsLoadFailed', { error })}</span><button onClick={() => { setLoading(true); fetchSpriteSets(modID, base).then((items) => { setSets(items); setError(''); setLoading(false); }).catch((reason) => { setError(String(reason)); setLoading(false); }); }} className="rounded px-1 py-0.5 transition-colors underline hover:bg-rose-50 active:bg-rose-100 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">{t('common.retry')}</button></div>;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-900">{t('spritepack.setsTitle')}</h3>
          <p className="text-[11px] text-neutral-500 mt-1">{t('spritepack.setsSummary', { sets: sets.length, items: sets.reduce((sum, set) => sum + set.items.length, 0) })}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setSelected(selected.length === sets.length ? [] : sets.map((set) => set.id))} className="px-2.5 py-1.5 border border-neutral-300 rounded text-neutral-700 hover:bg-neutral-50 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">{selected.length === sets.length ? t('spritepack.clearAll') : t('spritepack.selectAll')}</button>
          <button type="button" onClick={() => void download(selected)} disabled={!selected.length || downloading} className="px-3 py-1.5 bg-emerald-700 text-white rounded transition-colors hover:bg-emerald-800 disabled:opacity-40 flex items-center gap-1.5 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"><Download className="w-3.5 h-3.5" />{t('spritepack.downloadSelected', { count: selected.length })}</button>
          <button type="button" onClick={() => void download(sets.map((set) => set.id))} disabled={!sets.length || downloading} className="px-3 py-1.5 border border-emerald-700 text-emerald-800 rounded transition-colors hover:bg-emerald-50 disabled:opacity-40 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">{t('spritepack.downloadAll')}</button>
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
