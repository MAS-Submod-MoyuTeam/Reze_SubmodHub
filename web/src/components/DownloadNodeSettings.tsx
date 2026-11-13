import React, { useCallback, useEffect, useState } from 'react';
import {
  Server,
  Cloud,
  HardDrive,
  RefreshCw,
  Plus,
  Trash2,
  Edit3,
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Sliders,
  ExternalLink,
  ShieldAlert,
  ArrowUpDown,
  RotateCcw,
  Sparkles,
  Layers,
  ChevronRight,
  Info,
} from 'lucide-react';
import { readSession } from '../../../ui/auth-api';
import { AnimatePresence, m } from './Motion';
import { panelVariants } from '../../../ui/motion-presets';
import {
  fetchDownloadNodes,
  saveDownloadNode,
  deleteDownloadNode,
  retryDownloadMirrors,
  testDownloadNode,
  type DownloadNode,
  type DownloadNodeInput,
  type DownloadNodeSettings,
} from '../../../ui/settings-api';
import { useI18n } from '../i18n';

const blank = (): DownloadNodeInput => ({
  id: '',
  name: '',
  type: 'cloudreve',
  enabled: true,
  weight: 1,
  capabilities: ['cloudreve'],
  password: '',
  api_base_url: '',
  username: '',
  directory: '/SubmodHub',
  allowed_download_origins: [],
});

const FAILURE_KEYS = [
  ['conflict', 'downloadNode.errConflict'],
  ['authentication', 'downloadNode.errAuth'],
  ['timeout', 'downloadNode.errTimeout'],
  ['master_key', 'downloadNode.errMasterKey'],
  ['forbidden', 'downloadNode.errForbidden'],
] as const;

/** 错误码 → 文案键；真正的翻译在组件里用 `t()` 做，这里只做纯映射。 */
function failureKey(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  for (const [needle, key] of FAILURE_KEYS) {
    if (message.includes(needle)) return key;
  }
  return 'downloadNode.errGeneric';
}

export function DownloadNodeSettings({ apiBase, reloadSignal = 0 }: { apiBase: string; reloadSignal?: number }) {
  const { t } = useI18n();
  const failure = (error: unknown) => t(failureKey(error));
  const [settings, setSettings] = useState<DownloadNodeSettings | null>(null);
  const [input, setInput] = useState<DownloadNodeInput>(blank);
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [deleteID, setDeleteID] = useState('');
  const [testingNodeId, setTestingNodeId] = useState<string | null>(null);
  const [retryingNodeId, setRetryingNodeId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSettings(await fetchDownloadNodes(apiBase));
      setError('');
    } catch (err) {
      setError(failure(err));
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void load();
    // A settings import replaces the node list behind this component's back, so
    // it has to re-read rather than keep rendering nodes that no longer exist.
  }, [load, reloadSignal]);

  const edit = (node: DownloadNode) => {
    if (node.type === 'builtin') return;
    setInput({
      id: node.id,
      name: node.name,
      type: node.type,
      enabled: node.enabled,
      weight: node.weight,
      capabilities: node.capabilities,
      base_url: node.base_url,
      api_base_url: node.api_base_url,
      username: node.username,
      directory: node.directory,
      allowed_download_origins: node.allowed_download_origins,
      password: '',
    });
    setEditing(true);
    setOpen(true);
    setError('');
    setNotice('');
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !settings) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const session = await readSession(apiBase);
      setSettings(await saveDownloadNode(input, settings.revision, session.csrf_token, editing, apiBase));
      setInput(blank());
      setOpen(false);
      setNotice(t('downloadNode.saved'));
    } catch (err) {
      setError(failure(err));
      setInput((old) => ({ ...old, password: '' }));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || !settings || !deleteID) return;
    setBusy(true);
    setError('');
    try {
      const session = await readSession(apiBase);
      setSettings(await deleteDownloadNode(deleteID, settings.revision, session.csrf_token, apiBase));
      setDeleteID('');
      setNotice(t('downloadNode.deleted'));
    } catch (err) {
      setError(failure(err));
    } finally {
      setBusy(false);
    }
  };

  const retry = async (node: DownloadNode) => {
    if (busy || !settings) return;
    setBusy(true);
    setRetryingNodeId(node.id);
    setError('');
    setNotice('');
    try {
      const session = await readSession(apiBase);
      const result = await retryDownloadMirrors(node.id, settings.revision, session.csrf_token, apiBase);
      setNotice(t('downloadNode.retried', { count: result.retried }));
      setSettings(await fetchDownloadNodes(apiBase));
    } catch (err) {
      setError(failure(err));
    } finally {
      setBusy(false);
      setRetryingNodeId(null);
    }
  };

  const test = async (node: DownloadNode) => {
    if (busy || !settings) return;
    setBusy(true);
    setTestingNodeId(node.id);
    setError('');
    setNotice('');
    try {
      const session = await readSession(apiBase);
      const result = await testDownloadNode(node.id, settings.revision, session.csrf_token, apiBase);
      if (result.ok) {
        setNotice(t('downloadNode.testOk', { ms: result.elapsed_ms }));
      } else {
        setError(failure(new Error(result.error_code)));
      }
      setSettings(await fetchDownloadNodes(apiBase));
    } catch (err) {
      setError(failure(err));
    } finally {
      setInput((old) => ({ ...old, password: '' }));
      setBusy(false);
      setTestingNodeId(null);
    }
  };

  return (
    <section
      className="bg-white border border-neutral-200/90 rounded-2xl shadow-xs overflow-hidden transition-all"
      aria-labelledby="download-nodes-title"
    >
      {/* Header bar */}
      <div className="p-6 border-b border-neutral-100 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100/80">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <h2 id="download-nodes-title" className="text-base font-bold text-neutral-900 tracking-tight">
              {t('downloadNode.title')}
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              {t('downloadNode.subtitle')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => void load()}
            className="px-3.5 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-40 text-neutral-700 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-600' : 'text-neutral-500'}`} />
            {t('downloadNode.refresh')}
          </button>
          <button
            type="button"
            disabled={busy || !settings}
            onClick={() => {
              setInput(blank());
              setEditing(false);
              setOpen(true);
              setError('');
            }}
            className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('downloadNode.add')}
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Context info banner */}
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200/80 text-xs text-neutral-600 leading-relaxed">
          <Info className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
          <div>
            {t('downloadNode.banner')}
          </div>
        </div>

        {/* Alerts & Notifications */}
        {error && (
          <div role="alert" className="p-3.5 rounded-xl border border-rose-200 bg-rose-50 text-xs text-rose-700 flex items-center gap-2 shadow-2xs">
            <XCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}
        {notice && (
          <div role="status" className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 text-xs text-emerald-800 flex items-center gap-2 shadow-2xs">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{notice}</span>
          </div>
        )}

        {/* Global Warnings */}
        {settings?.builtin_fallback && (
          <div className="flex items-center gap-2.5 text-xs text-amber-900 bg-amber-50 border border-amber-200/80 rounded-xl p-3.5 shadow-2xs">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{t('downloadNode.noMirror')}</span>
          </div>
        )}
        {settings && !settings.master_key_configured && (
          <div className="flex items-center gap-2.5 text-xs text-amber-900 bg-amber-50 border border-amber-200/80 rounded-xl p-3.5 shadow-2xs">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{t('downloadNode.noMasterKey')}</span>
          </div>
        )}

        {/* Node Cards List */}
        {loading ? (
          <div className="py-16 text-center text-xs text-neutral-400 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
            <span>{t('downloadNode.loading')}</span>
          </div>
        ) : settings ? (
          <div className="grid grid-cols-1 gap-4">
            {settings.items.map((node) => {
              const isBuiltin = node.type === 'builtin';
              const isCloudreve = node.type === 'cloudreve';
              const isTesting = testingNodeId === node.id;
              const isRetrying = retryingNodeId === node.id;

              return (
                <div
                  key={node.id}
                  className={`rounded-xl border transition-all p-5 ${
                    node.enabled
                      ? 'border-neutral-200/90 bg-white hover:border-neutral-300 hover:shadow-xs'
                      : 'border-neutral-200/60 bg-neutral-50/60 opacity-75'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Left: Metadata */}
                    <div className="space-y-2 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <div
                          className={`p-2 rounded-lg border ${
                            isBuiltin
                              ? 'bg-neutral-100 text-neutral-700 border-neutral-200'
                              : isCloudreve
                              ? 'bg-sky-50 text-sky-700 border-sky-100'
                              : 'bg-indigo-50 text-indigo-700 border-indigo-100'
                          }`}
                        >
                          {isBuiltin ? <HardDrive className="w-4 h-4" /> : isCloudreve ? <Cloud className="w-4 h-4" /> : <Server className="w-4 h-4" />}
                        </div>
                        <h3 className="text-sm font-bold text-neutral-900 truncate">
                          {node.name}
                        </h3>
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 border border-neutral-200/60">
                          {isBuiltin
                            ? t('downloadNode.builtin')
                            : isCloudreve
                            ? t('downloadNode.cloudreve')
                            : t('downloadNode.githubRelay')}
                        </span>
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 border ${
                            node.enabled
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200/60'
                              : 'bg-neutral-100 text-neutral-500 border-neutral-200'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${node.enabled ? 'bg-emerald-600' : 'bg-neutral-400'}`} />
                          {node.enabled ? t('downloadNode.enabled') : t('downloadNode.disabled')}
                        </span>
                        <span className="text-[11px] text-neutral-500 font-mono">
                          {t('downloadNode.weight', { weight: node.weight })}
                        </span>
                      </div>

                      {/* Status Badges & Mirror Stats */}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-600 pt-0.5">
                        <div className="flex items-center gap-1.5">
                          {node.status === 'available' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> {t('downloadNode.statusAvailable')}
                            </span>
                          ) : node.status === 'failed' ? (
                            <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                              <XCircle className="w-3.5 h-3.5 text-rose-600" /> {t('downloadNode.statusFailed')}
                            </span>
                          ) : isBuiltin ? (
                            <span className="inline-flex items-center gap-1 text-neutral-600">
                              <CheckCircle2 className="w-3.5 h-3.5 text-neutral-400" /> {t('downloadNode.statusAlways')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-neutral-400">
                              <Activity className="w-3.5 h-3.5" /> {t('downloadNode.statusUnknown')}
                            </span>
                          )}
                        </div>

                        {node.credential_configured && (
                          <span className="text-[11px] font-mono text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded border border-neutral-200/50">
                            {t('downloadNode.credentialConfigured')}
                          </span>
                        )}

                        {node.last_checked_at && (
                          <span className="text-[11px] text-neutral-400">
                            {t('downloadNode.lastChecked', { time: new Date(node.last_checked_at).toLocaleTimeString() })}
                          </span>
                        )}
                      </div>

                      {/* Mirror Progress Counters */}
                      {node.mirror_states && (
                        <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                          <span className="text-neutral-500 font-medium">{t('downloadNode.mirrorCache')}</span>
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-mono border border-emerald-200/60">
                            {t('downloadNode.cacheReady', { count: node.mirror_states.ready || 0 })}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 font-mono border border-amber-200/60">
                            {t('downloadNode.cacheUploading', { count: node.mirror_states.uploading || 0 })}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-600 font-mono border border-neutral-200/60">
                            {t('downloadNode.cachePending', { count: node.mirror_states.pending || 0 })}
                          </span>
                          {(node.mirror_states.failed || 0) > 0 && (
                            <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-mono font-bold border border-rose-200/60">
                              {t('downloadNode.cacheFailed', { count: node.mirror_states.failed || 0 })}
                            </span>
                          )}
                        </div>
                      )}

                      {/* App update asset cache, kept separate from mod archives */}
                      {node.app_asset_states && (
                        <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                          <span className="text-neutral-500 font-medium">{t('downloadNode.appAssetCache')}</span>
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-mono border border-emerald-200/60">
                            {t('downloadNode.cacheReady', { count: node.app_asset_states.ready || 0 })}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 font-mono border border-amber-200/60">
                            {t('downloadNode.cacheUploading', { count: node.app_asset_states.uploading || 0 })}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-600 font-mono border border-neutral-200/60">
                            {t('downloadNode.cachePending', { count: node.app_asset_states.pending || 0 })}
                          </span>
                          {(node.app_asset_states.failed || 0) > 0 && (
                            <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-mono font-bold border border-rose-200/60">
                              {t('downloadNode.cacheFailed', { count: node.app_asset_states.failed || 0 })}
                            </span>
                          )}
                        </div>
                      )}

                      {node.error_code && (
                        <p className="text-xs text-rose-700 pt-1 font-mono flex items-center gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>{failure(new Error(node.error_code))}</span>
                        </p>
                      )}
                    </div>

                    {/* Right: Actions Buttons */}
                    {!isBuiltin && (
                      <div className="flex flex-wrap items-center gap-2 lg:self-center shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-neutral-100">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void test(node)}
                          className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-40 text-neutral-700 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                        >
                          {isTesting ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-neutral-500" />
                          ) : (
                            <Activity className="w-3.5 h-3.5 text-neutral-500" />
                          )}
                          {isTesting ? t('downloadNode.testing') : t('downloadNode.test')}
                        </button>

                        {!!node.mirror_states?.failed && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void retry(node)}
                            className="px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50/70 hover:bg-amber-100 disabled:opacity-40 text-amber-900 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                          >
                            {isRetrying ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-700" />
                            ) : (
                              <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
                            )}
                            {isRetrying ? t('downloadNode.retrying') : t('downloadNode.retryMirrors')}
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => edit(node)}
                          className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 hover:border-neutral-300 disabled:opacity-40 text-neutral-700 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-neutral-500" />
                          {t('common.edit')}
                          <span className="sr-only">{node.name}</span>
                        </button>

                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setDeleteID(node.id)}
                          className="px-3 py-1.5 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 disabled:opacity-40 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                          {t('common.delete')}
                          <span className="sr-only">{node.name}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Delete confirmation banner */}
        {deleteID && (
          <div
            role="alert"
            className="rounded-2xl border border-rose-200 bg-rose-50/80 p-5 space-y-3.5 text-xs text-rose-950 shadow-sm"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="font-bold text-sm text-rose-900">{t('downloadNode.deleteTitle')}</h4>
                <p className="text-neutral-600 leading-relaxed">{t('downloadNode.deleteBody')}</p>
              </div>
            </div>
            <div className="flex gap-2.5 pt-1 pl-7">
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove()}
                className="px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-800 disabled:opacity-40 text-white font-semibold transition-colors shadow-2xs cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                {busy ? t('downloadNode.deleting') : t('downloadNode.confirmDelete')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDeleteID('')}
                className="px-4 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-40 text-neutral-700 font-medium transition-colors cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* Form: Add or Edit Node */}
        <AnimatePresence initial={false}>
        {open && (
          <m.form
            onSubmit={save}
            variants={panelVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-6 space-y-6 shadow-xs"
          >
            <div className="flex items-center justify-between border-b border-neutral-200/80 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-emerald-100 text-emerald-800">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-neutral-900">
                    {editing ? t('downloadNode.editTitle') : t('downloadNode.addTitle')}
                  </h3>
                  <p className="text-xs text-neutral-500">{t('downloadNode.formSubtitle')}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setInput(blank());
                  setOpen(false);
                }}
                className="text-xs text-neutral-400 hover:text-neutral-700 p-1 cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                {t('downloadNode.close')}
              </button>
            </div>

            <fieldset disabled={busy} className="grid grid-cols-1 sm:grid-cols-2 gap-5 disabled:opacity-60">
              <label className="text-xs font-semibold text-neutral-800 space-y-1.5">
                <span>{t('downloadNode.idLabel')}</span>
                <input
                  required
                  pattern="[a-zA-Z0-9_-]{1,64}"
                  placeholder={t('downloadNode.idPlaceholder')}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs font-mono text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/15"
                  value={input.id}
                  disabled={editing}
                  onChange={(e) => setInput({ ...input, id: e.target.value })}
                />
              </label>

              <label className="text-xs font-semibold text-neutral-800 space-y-1.5">
                <span>{t('downloadNode.nameLabel')}</span>
                <input
                  required
                  maxLength={128}
                  placeholder={t('downloadNode.namePlaceholder')}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/15"
                  value={input.name}
                  onChange={(e) => setInput({ ...input, name: e.target.value })}
                />
              </label>

              <label className="text-xs font-semibold text-neutral-800 space-y-1.5">
                <span>{t('downloadNode.typeLabel')}</span>
                <select
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/15"
                  value={input.type}
                  disabled={editing}
                  onChange={(e) => {
                    const type = e.target.value as DownloadNodeInput['type'];
                    setInput({
                      ...input,
                      type,
                      capabilities: [type === 'cloudreve' ? 'cloudreve' : 'github'],
                      password: '',
                    });
                  }}
                >
                  <option value="cloudreve">{t('downloadNode.typeCloudreve')}</option>
                  <option value="github_relay">{t('downloadNode.typeGithub')}</option>
                </select>
              </label>

              <label className="text-xs font-semibold text-neutral-800 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span>{t('downloadNode.weightLabel')}</span>
                  <span className="font-mono text-neutral-400 font-normal">{t('downloadNode.weightCurrent', { weight: input.weight })}</span>
                </div>
                <input
                  type="number"
                  min={1}
                  max={100}
                  required
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs font-mono text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/15"
                  value={input.weight}
                  onChange={(e) => setInput({ ...input, weight: Number(e.target.value) })}
                />
              </label>

              {input.type === 'cloudreve' ? (
                <>
                  <label className="text-xs font-semibold text-neutral-800 space-y-1.5 sm:col-span-2">
                    <span>{t('downloadNode.apiBaseLabel')}</span>
                    <input
                      type="url"
                      required
                      placeholder="https://disk.example.com/api/v3"
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs font-mono text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/15"
                      value={input.api_base_url || ''}
                      onChange={(e) => setInput({ ...input, api_base_url: e.target.value })}
                    />
                  </label>

                  <label className="text-xs font-semibold text-neutral-800 space-y-1.5">
                    <span>{t('downloadNode.usernameLabel')}</span>
                    <input
                      required
                      autoComplete="off"
                      placeholder="admin@example.com"
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/15"
                      value={input.username || ''}
                      onChange={(e) => setInput({ ...input, username: e.target.value })}
                    />
                  </label>

                  <label className="text-xs font-semibold text-neutral-800 space-y-1.5">
                    <span>{t('downloadNode.directoryLabel')}</span>
                    <input
                      required
                      placeholder="/SubmodHub"
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs font-mono text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/15"
                      value={input.directory || ''}
                      onChange={(e) => setInput({ ...input, directory: e.target.value })}
                    />
                    <span className="block text-[11px] text-neutral-500 font-normal">{t('downloadNode.directoryHint')}</span>
                  </label>

                  <label className="text-xs font-semibold text-neutral-800 space-y-1.5 sm:col-span-2">
                    <span>{t('downloadNode.originsLabel')}</span>
                    <textarea
                      required
                      rows={3}
                      placeholder="https://storage1.example.com:29991&#10;https://storage2.example.com:29991"
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs font-mono text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/15 leading-relaxed"
                      value={(input.allowed_download_origins || []).join('\n')}
                      onChange={(e) =>
                        setInput({
                          ...input,
                          allowed_download_origins: e.target.value.split('\n').filter(Boolean),
                        })
                      }
                    />
                  </label>
                </>
              ) : (
                <label className="text-xs font-semibold text-neutral-800 space-y-1.5 sm:col-span-2">
                  <span>{t('downloadNode.relayBaseLabel')}</span>
                  <input
                    type="url"
                    required
                    placeholder="https://relay.example.com"
                    className="w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs font-mono text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/15"
                    value={input.base_url || ''}
                    onChange={(e) => setInput({ ...input, base_url: e.target.value })}
                  />
                </label>
              )}

              <label className="text-xs font-semibold text-neutral-800 space-y-1.5 sm:col-span-2">
                <span>{input.type === 'cloudreve' ? t('downloadNode.passwordCloudreve') : t('downloadNode.passwordRelay')}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required={!editing}
                  placeholder={editing ? t('downloadNode.passwordKeep') : t('downloadNode.passwordEnter')}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs font-mono text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/15"
                  value={input.password}
                  onChange={(e) => setInput({ ...input, password: e.target.value })}
                />
                <span className="block text-[11px] text-neutral-500 font-normal">
                  {editing ? t('downloadNode.passwordHintEdit') : t('downloadNode.passwordHintNew')}
                </span>
              </label>

              <div className="sm:col-span-2 flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={input.enabled}
                    onChange={(e) => setInput({ ...input, enabled: e.target.checked })}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 accent-emerald-600"
                  />
                  <span className="text-xs font-semibold text-neutral-800">{t('downloadNode.enableLabel')}</span>
                </label>
                <span className="text-[11px] text-neutral-500">
                  {t('downloadNode.capability', { value: input.type === 'cloudreve' ? t('downloadNode.capabilityCloudreve') : t('downloadNode.capabilityGithub') })}
                </span>
              </div>
            </fieldset>

            <div className="flex items-center justify-between pt-4 border-t border-neutral-200">
              <span className="text-[11px] text-neutral-500">{t('downloadNode.footerHint')}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setInput(blank());
                    setOpen(false);
                  }}
                  className="px-4 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-700 text-xs font-medium transition-colors cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={busy || (!settings?.master_key_configured && (!editing || input.password !== ''))}
                  className="px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                >
                  {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                  {busy ? t('downloadNode.busy') : editing ? t('downloadNode.saveChanges') : t('downloadNode.confirmAdd')}
                </button>
              </div>
            </div>
          </m.form>
        )}
          </AnimatePresence>
      </div>
    </section>
  );
}
