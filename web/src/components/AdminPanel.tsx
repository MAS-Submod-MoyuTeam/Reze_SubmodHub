import React, { useEffect, useState } from 'react';
import { apiBase as apiBaseURL } from '../apiBase';
import {
  AlertCircle,
  CheckCircle2,
  Globe,
  RefreshCw,
  ShieldCheck,
  UserRoundCog,
  XCircle,
  Server,
  KeyRound,
  Sparkles,
  ExternalLink,
  Info,
  Check,
  ShieldAlert,
  Timer,
} from 'lucide-react';
import { getFlarumUserRoles, readSession, setFlarumUserRoles } from '../../../ui/auth-api';
import { fetchSettings, testGitHubProxy, updateSettings, type ProxyTestResponse, type SiteSettings } from '../../../ui/settings-api';
import type { TagGroup } from '../../../ui/tags-api';
import { useApp } from '../context/AppContext';
import { DownloadNodeSettings } from './DownloadNodeSettings';
import { SettingsTransferCard } from './SettingsTransferCard';
import { TagCatalogSettings } from './TagCatalogSettings';
import { useI18n } from '../i18n';

export const AdminPanel: React.FC = () => {
  const { hasRole, showToast, reloadCatalog } = useApp();
  const { t } = useI18n();

  // Role Management State
  const [userID, setUserID] = useState('');
  const [author, setAuthor] = useState(false);
  const [reviewer, setReviewer] = useState(false);
  const [savingRoles, setSavingRoles] = useState(false);
  const [lastSavedRoles, setLastSavedRoles] = useState<{ id: string; roles: string[] } | null>(null);
  const [loadingRoles, setLoadingRoles] = useState(false);

  // Settings State
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [loadSettingsError, setLoadSettingsError] = useState<string | null>(null);
  const [proxyTemplate, setProxyTemplate] = useState('');
  const [savedTemplate, setSavedTemplate] = useState('');
  const [revision, setRevision] = useState(0);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingProxy, setTestingProxy] = useState(false);
  const [testResult, setTestResult] = useState<ProxyTestResponse | null>(null);
  const [conflictError, setConflictError] = useState(false);

  // GitHub API token state. The token itself is write-only: the server reports
  // whether one exists, how it is stored, and its last four characters.
  const [tokenInput, setTokenInput] = useState('');
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [tokenEncrypted, setTokenEncrypted] = useState(false);
  const [tokenHint, setTokenHint] = useState('');
  const [masterKeyConfigured, setMasterKeyConfigured] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [tokenConflictError, setTokenConflictError] = useState(false);

  // Refresh window state: the server reports the effective value, so the field
  // always shows what the poller and the page views actually use.
  const [syncMaxAge, setSyncMaxAge] = useState('');
  const [savedSyncMaxAge, setSavedSyncMaxAge] = useState('');
  const [savingSyncMaxAge, setSavingSyncMaxAge] = useState(false);
  const [syncMaxAgeConflictError, setSyncMaxAgeConflictError] = useState(false);
  const [syncMaxAgeLocked, setSyncMaxAgeLocked] = useState(false);

  // Tag catalog: the authoritative list authors pick from. Editing it also prunes
  // tags that no longer exist from the mods that referenced them.
  const [tagCatalog, setTagCatalog] = useState<TagGroup[]>([]);
  const [tagCatalogConflict, setTagCatalogConflict] = useState(false);

  // Bumped after a settings import so the node card re-reads its own list; it
  // owns that state and cannot be refreshed from the import response alone.
  const [nodeReloadSignal, setNodeReloadSignal] = useState(0);

  const apiBase = apiBaseURL();

  const loadSettings = async () => {
    setLoadingSettings(true);
    setLoadSettingsError(null);
    setConflictError(false);
    setTokenConflictError(false);
    try {
      const data = await fetchSettings(apiBase);
      setProxyTemplate(data.github_proxy_template || '');
      setSavedTemplate(data.github_proxy_template || '');
      setTokenConfigured(Boolean(data.github_token_configured));
      setTokenEncrypted(Boolean(data.github_token_encrypted));
      setTokenHint(data.github_token_hint || '');
      setMasterKeyConfigured(Boolean(data.master_key_configured));
      setSyncMaxAge(data.github_sync_max_age || '');
      setSavedSyncMaxAge(data.github_sync_max_age || '');
      setSyncMaxAgeLocked(Boolean(data.github_sync_max_age_locked));
      setTagCatalog(data.tag_catalog || []);
      setTagCatalogConflict(false);
      setRevision(data.revision || 0);
    } catch (err) {
      setLoadSettingsError(err instanceof Error ? err.message : 'failed_to_load_settings');
    } finally {
      setLoadingSettings(false);
    }
  };

  useEffect(() => {
    if (hasRole('admin')) {
      void loadSettings();
    }
  }, []);

  if (!hasRole('admin')) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20 text-center">
        <div className="inline-flex p-4 rounded-2xl bg-amber-50 border border-amber-200/60 mb-4 shadow-sm">
          <ShieldAlert className="w-8 h-8 text-amber-600" />
        </div>
        <h2 className="text-base font-bold text-neutral-900 mb-1">{t('admin.noAccessTitle')}</h2>
        <p className="text-xs text-neutral-500 max-w-sm mx-auto">
          {t('admin.noAccessBody')}
        </p>
      </div>
    );
  }

  // Handle Testing Proxy
  const handleTestProxy = async () => {
    if (testingProxy || !proxyTemplate.trim()) return;
    setTestingProxy(true);
    try {
      const session = await readSession(apiBase);
      const res = await testGitHubProxy(proxyTemplate.trim(), session.csrf_token, apiBase);
      setTestResult(res);
      if (res.api.ok && res.asset.ok) {
        showToast('success', t('admin.proxyTestOk'));
      } else {
        showToast('error', t('admin.proxyTestFailed'));
      }
    } catch (err) {
      showToast('error', t('admin.proxyTestError', { error: err instanceof Error ? err.message : 'unknown_error' }));
    } finally {
      setTestingProxy(false);
    }
  };

  // Handle Saving Settings
  const handleSaveSettings = async (templateToSave: string) => {
    if (savingSettings) return;
    setSavingSettings(true);
    setConflictError(false);
    try {
      const session = await readSession(apiBase);
      const updated = await updateSettings({ github_proxy_template: templateToSave.trim() }, revision, session.csrf_token, apiBase);
      setProxyTemplate(updated.github_proxy_template || '');
      setSavedTemplate(updated.github_proxy_template || '');
      setRevision(updated.revision);
      showToast('success', templateToSave.trim() ? t('admin.proxySaved') : t('admin.proxyCleared'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown_error';
      if (msg.includes('conflict') || msg.includes('409')) {
        setConflictError(true);
        showToast('error', t('admin.settingsConflict'));
      } else {
        showToast('error', t('admin.saveFailed', { error: msg }));
      }
    } finally {
      setSavingSettings(false);
    }
  };

  // Keep the cached revision in step with a catalog save so the next card save
  // does not fail with a stale revision conflict. Saving the catalog also prunes
  // tags off mods server-side, so the catalog cache has to be re-read too.
  const handleTagCatalogSaved = (updated: SiteSettings) => {
    setTagCatalog(updated.tag_catalog || []);
    setRevision(updated.revision);
    setTagCatalogConflict(false);
    void reloadCatalog();
  };

  /**
   * An import replaces every card on this page at once, so the cached revision,
   * proxy, token flags, refresh window and tag catalog all have to be re-read
   * from the response — otherwise the next card save fires with a stale revision
   * and fails with a conflict it just caused itself.
   */
  const handleSettingsImported = (updated: SiteSettings) => {
    setProxyTemplate(updated.github_proxy_template || '');
    setSavedTemplate(updated.github_proxy_template || '');
    setTokenConfigured(Boolean(updated.github_token_configured));
    setTokenEncrypted(Boolean(updated.github_token_encrypted));
    setTokenHint(updated.github_token_hint || '');
    setMasterKeyConfigured(Boolean(updated.master_key_configured));
    setSyncMaxAge(updated.github_sync_max_age || '');
    setSavedSyncMaxAge(updated.github_sync_max_age || '');
    setSyncMaxAgeLocked(Boolean(updated.github_sync_max_age_locked));
    setTagCatalog(updated.tag_catalog || []);
    setTagCatalogConflict(false);
    setRevision(updated.revision);
    setTokenInput('');
    setNodeReloadSignal((current) => current + 1);
    // Importing prunes tags off mods whose catalog entry disappeared, so the
    // public catalog cache must be fetched again as well.
    void reloadCatalog();
  };

  // Handle Saving / Clearing the GitHub API token
  const handleSaveToken = async (tokenToSave: string) => {
    if (savingToken) return;
    setSavingToken(true);
    setTokenConflictError(false);
    try {
      const session = await readSession(apiBase);
      const updated = await updateSettings({ github_token: tokenToSave.trim() }, revision, session.csrf_token, apiBase);
      setTokenConfigured(Boolean(updated.github_token_configured));
      setTokenEncrypted(Boolean(updated.github_token_encrypted));
      setTokenHint(updated.github_token_hint || '');
      setMasterKeyConfigured(Boolean(updated.master_key_configured));
      setRevision(updated.revision);
      setTokenInput('');
      showToast(
        'success',
        tokenToSave.trim()
          ? updated.github_token_encrypted
            ? t('admin.tokenSavedEncrypted')
            : t('admin.tokenSavedPlain')
          : t('admin.tokenCleared')
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown_error';
      if (msg.includes('conflict') || msg.includes('409')) {
        setTokenConflictError(true);
        showToast('error', t('admin.settingsConflict'));
      } else {
        showToast('error', t('admin.tokenSaveFailed', { error: msg }));
      }
    } finally {
      setSavingToken(false);
    }
  };

  // Handle Saving the refresh window
  const handleSaveSyncMaxAge = async (valueToSave: string) => {
    if (savingSyncMaxAge || syncMaxAgeLocked) return;
    setSavingSyncMaxAge(true);
    setSyncMaxAgeConflictError(false);
    try {
      const session = await readSession(apiBase);
      const updated = await updateSettings({ github_sync_max_age: valueToSave.trim() }, revision, session.csrf_token, apiBase);
      setSyncMaxAge(updated.github_sync_max_age || '');
      setSavedSyncMaxAge(updated.github_sync_max_age || '');
      setRevision(updated.revision);
      showToast(
        'success',
        updated.github_sync_max_age === '0s'
          ? t('admin.syncDisabledToast')
          : t('admin.syncApplied', { window: updated.github_sync_max_age })
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown_error';
      if (msg.includes('conflict') || msg.includes('409')) {
        setSyncMaxAgeConflictError(true);
        showToast('error', t('admin.settingsConflict'));
      } else {
        showToast('error', t('admin.saveSyncFailed', { error: msg }));
      }
    } finally {
      setSavingSyncMaxAge(false);
    }
  };

  // Role Submit
  const submitRoles = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRoles) return;
    setSavingRoles(true);
    try {
      const session = await readSession(apiBase);
      if (!session.roles.includes('admin')) throw new Error('forbidden');
      const roles: Array<'author' | 'reviewer'> = [];
      if (author) roles.push('author');
      if (reviewer) roles.push('reviewer');
      const result = await setFlarumUserRoles(userID.trim(), roles, session.csrf_token, apiBase);
      setLastSavedRoles({ id: result.user_id, roles: result.roles });
      showToast('success', t('admin.rolesSaved'));
    } catch (error) {
      showToast('error', t('admin.rolesSaveFailed', { error: error instanceof Error ? error.message : 'unknown_error' }));
    } finally {
      setSavingRoles(false);
    }
  };

  // Role Load
  const loadUserRoles = async () => {
    if (loadingRoles || !/^[1-9]\d*$/.test(userID.trim())) return;
    setLoadingRoles(true);
    try {
      const session = await readSession(apiBase);
      if (!session.roles.includes('admin')) throw new Error('forbidden');
      const result = await getFlarumUserRoles(userID.trim(), apiBase);
      setAuthor(result.roles.includes('author'));
      setReviewer(result.roles.includes('reviewer'));
      setLastSavedRoles({ id: result.user_id, roles: result.roles });
    } catch (error) {
      showToast('error', t('admin.rolesLoadFailed', { error: error instanceof Error ? error.message : 'unknown_error' }));
    } finally {
      setLoadingRoles(false);
    }
  };

  const isProxyDirty = proxyTemplate.trim() !== savedTemplate.trim();
  const isSyncMaxAgeDirty = syncMaxAge.trim() !== savedSyncMaxAge.trim();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Page Header with modern subtle gradient & badges */}
      <div className="relative overflow-hidden rounded-2xl bg-linear-to-r from-neutral-900 via-neutral-800 to-neutral-950 p-6 sm:p-8 text-white shadow-md border border-neutral-800">
        <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-xs font-medium">
              <ShieldCheck className="w-3.5 h-3.5" /> {t('admin.heroBadge')}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              {t('admin.heroTitle')}
            </h1>
            <p className="text-xs sm:text-sm text-neutral-400 max-w-2xl leading-relaxed">
              {t('admin.heroBody')}
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-center">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 backdrop-blur-xs text-xs font-mono text-neutral-300 border border-white/10">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              {t('admin.revision', { revision })}
            </span>
          </div>
        </div>
      </div>

      {/* Main Download Delivery Nodes Section */}
      <DownloadNodeSettings apiBase={apiBase} reloadSignal={nodeReloadSignal} />

      {/* Tag Catalog: the only place tags can be created, renamed or removed */}
      {tagCatalogConflict ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 flex flex-wrap items-center justify-between gap-2">
          <span>{t('admin.tagCatalogConflict')}</span>
          <button type="button" onClick={() => void loadSettings()} className="rounded px-1 py-0.5 transition-colors underline font-medium hover:bg-neutral-100 active:bg-neutral-200 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">{t('admin.reload')}</button>
        </div>
      ) : null}
      <TagCatalogSettings
        apiBase={apiBase}
        groups={tagCatalog}
        revision={revision}
        onSaved={handleTagCatalogSaved}
        onConflict={() => setTagCatalogConflict(true)}
        onToast={showToast}
      />

      {/* Grid of Secondary Settings: GitHub Proxy & API Token */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* GitHub Proxy Settings Card */}
        <section className="bg-white border border-neutral-200/90 rounded-xl shadow-xs hover:shadow-sm transition-shadow p-6 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="flex items-start justify-between border-b border-neutral-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-100/80">
                  <Globe className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">{t('admin.proxyTitle')}</h2>
                  <p className="text-xs text-neutral-500">{t('admin.proxySubtitle')}</p>
                </div>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-neutral-100 text-neutral-600">
                rev {revision}
              </span>
            </div>

            <p className="text-xs text-neutral-600 leading-relaxed">
              {t('admin.proxyBody')}
            </p>

            {loadSettingsError ? (
              <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{t('admin.loadFailed', { error: loadSettingsError })}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void loadSettings()}
                  className="px-2.5 py-1 rounded bg-rose-100 text-rose-800 hover:bg-rose-200 font-medium transition-colors active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                >
                  {t('common.retry')}
                </button>
              </div>
            ) : loadingSettings ? (
              <div className="py-12 text-center text-xs text-neutral-400 flex flex-col items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-neutral-400" />
                <span>{t('admin.loading')}</span>
              </div>
            ) : (
              <div className="space-y-4 pt-1">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="proxy-template-input" className="text-xs font-semibold text-neutral-800">
                      {t('admin.proxyLabel')}
                    </label>
                    {isProxyDirty && (
                      <span className="text-[11px] font-medium text-amber-600 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        {t('admin.unsavedChanges')}
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      id="proxy-template-input"
                      type="text"
                      value={proxyTemplate}
                      onChange={(e) => {
                        setProxyTemplate(e.target.value);
                        setTestResult(null);
                      }}
                      placeholder={t('admin.proxyPlaceholder')}
                      className="w-full rounded-lg border border-neutral-300 bg-neutral-50/40 px-3.5 py-2.5 text-xs text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-500/15 font-mono transition-all"
                    />
                  </div>
                  <span className="block text-[11px] text-neutral-400 leading-normal">
                    {t('admin.proxyHint')}
                  </span>
                </div>

                {/* Status Indicator Bar */}
                <div className="rounded-lg p-3 bg-neutral-50 border border-neutral-200/80 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        savedTemplate ? 'bg-emerald-500 ring-2 ring-emerald-200' : 'bg-neutral-400'
                      }`}
                    />
                    <span className="text-neutral-600">
                      {savedTemplate ? (
                        <>
                          {t('admin.proxyActive')}<span className="font-mono font-medium text-emerald-800">{savedTemplate}</span>
                        </>
                      ) : (
                        t('admin.proxyDirect')
                      )}
                    </span>
                  </div>
                </div>

                {/* Conflict Error Notice */}
                {conflictError && (
                  <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>{t('admin.conflict')}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadSettings()}
                      className="px-2.5 py-1 rounded bg-amber-200/80 hover:bg-amber-300 text-amber-900 font-medium shrink-0 ml-2 transition-colors active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                    >
                      {t('admin.takeLatest')}
                    </button>
                  </div>
                )}

                {/* Test Results Card */}
                {testResult && (
                  <div className="p-3.5 rounded-lg bg-neutral-50/80 border border-neutral-200 space-y-2 text-xs">
                    <div className="font-semibold text-neutral-700 flex items-center gap-1.5 pb-1 border-b border-neutral-200/60">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                      {t('admin.testReport')}
                    </div>
                    <div className="flex items-center justify-between py-0.5">
                      <span className="flex items-center gap-2 text-neutral-700">
                        {testResult.api.ok ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                        )}
                        {t('admin.apiEndpoint')}
                      </span>
                      <span className={`font-mono ${testResult.api.ok ? 'text-emerald-700 font-medium' : 'text-rose-600'}`}>
                        {testResult.api.ok ? `${testResult.api.elapsed_ms} ms` : t('admin.testFailed', { code: testResult.api.error_code || 'error' })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-0.5">
                      <span className="flex items-center gap-2 text-neutral-700">
                        {testResult.asset.ok ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                        )}
                        {t('admin.assetEndpoint')}
                      </span>
                      <span className={`font-mono ${testResult.asset.ok ? 'text-emerald-700 font-medium' : 'text-rose-600'}`}>
                        {testResult.asset.ok ? `${testResult.asset.elapsed_ms} ms` : t('admin.testFailed', { code: testResult.asset.error_code || 'error' })}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          {!loadingSettings && !loadSettingsError && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => void handleTestProxy()}
                disabled={testingProxy || savingSettings || !proxyTemplate.trim()}
                className="px-3.5 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-40 text-neutral-700 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                {testingProxy ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-neutral-500" />
                ) : (
                  <Globe className="w-3.5 h-3.5 text-neutral-500" />
                )}
                {testingProxy ? t('admin.testing') : t('admin.testProxy')}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveSettings('')}
                  disabled={savingSettings || testingProxy || (!proxyTemplate && !savedTemplate)}
                  className="px-3 py-2 rounded-lg border border-neutral-200 text-neutral-600 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50/50 disabled:opacity-40 text-xs font-medium transition-colors cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                >
                  {t('admin.clearDirect')}
                </button>

                <button
                  type="button"
                  onClick={() => void handleSaveSettings(proxyTemplate)}
                  disabled={savingSettings || testingProxy}
                  className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                >
                  {savingSettings ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {savingSettings ? t('admin.saving') : t('admin.saveProxy')}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* GitHub API Token Card */}
        <section className="bg-white border border-neutral-200/90 rounded-xl shadow-xs hover:shadow-sm transition-shadow p-6 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="flex items-start justify-between border-b border-neutral-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-neutral-900 text-white border border-neutral-800">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">{t('admin.tokenTitle')}</h2>
                  <p className="text-xs text-neutral-500">{t('admin.tokenSubtitle')}</p>
                </div>
              </div>
              <span
                className={`text-[11px] px-2 py-0.5 rounded font-medium border ${
                  tokenConfigured
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200/60'
                    : 'bg-amber-50 text-amber-800 border-amber-200/60'
                }`}
              >
                {tokenConfigured ? t('admin.tokenConfigured') : t('admin.tokenAnonymous')}
              </span>
            </div>

            <p className="text-xs text-neutral-600 leading-relaxed">
              {t('admin.tokenIntro')}
            </p>

            {loadSettingsError ? (
              <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                <span>{t('admin.loadFailedProxyHint', { error: loadSettingsError })}</span>
              </div>
            ) : loadingSettings ? (
              <div className="py-12 text-center text-xs text-neutral-400 flex flex-col items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-neutral-400" />
                <span>{t('admin.loading')}</span>
              </div>
            ) : (
              <div className="space-y-4 pt-1">
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label htmlFor="github-token-input" className="text-xs font-semibold text-neutral-800">
                      {tokenConfigured ? t('admin.tokenReplaceLabel') : t('admin.tokenLabel')}
                    </label>
                    <a
                      href="https://github.com/settings/tokens"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 hover:text-emerald-800 hover:underline active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                    >
                      {t('admin.tokenCreateLink')}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <input
                    id="github-token-input"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder={tokenConfigured ? t('admin.tokenPlaceholderReplace') : 'ghp_... 或 github_pat_...'}
                    className="w-full rounded-lg border border-neutral-300 bg-neutral-50/40 px-3.5 py-2.5 text-xs text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-500/15 font-mono transition-all"
                  />
                  <div className="space-y-1 text-[11px] text-neutral-400 leading-normal">
                    <div>
                      <a
                        href="https://github.com/settings/personal-access-tokens/new"
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-emerald-700 hover:underline active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                      >
                        Fine-grained
                      </a>
                      {t('admin.tokenFineGrainedHint')}
                    </div>
                    <div>
                      <a
                        href="https://github.com/settings/tokens/new"
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-emerald-700 hover:underline active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                      >
                        Classic
                      </a>
                      {t('admin.tokenClassicHint')}
                    </div>
                    <div>{t('admin.tokenPrivateHint')}</div>
                  </div>
                </div>

                <div className="rounded-lg p-3 bg-neutral-50 border border-neutral-200/80 space-y-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        tokenConfigured ? 'bg-emerald-500 ring-2 ring-emerald-200' : 'bg-neutral-400'
                      }`}
                    />
                    <span className="text-neutral-600">
                      {tokenConfigured ? (
                        <>
                          {t('admin.tokenCurrent')}<span className="font-mono font-medium text-neutral-900">••••••••{tokenHint}</span>
                          <span className="ml-2 text-neutral-400">
                            {tokenEncrypted ? t('admin.tokenEncrypted') : t('admin.tokenPlain')}
                          </span>
                        </>
                      ) : (
                        t('admin.tokenAnonymousState')
                      )}
                    </span>
                  </div>
                  {tokenConfigured && !tokenEncrypted && (
                    <div className="flex items-start gap-1.5 pt-1 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>
                        {t('admin.tokenPlainWarning')}
                      </span>
                    </div>
                  )}
                  {!masterKeyConfigured && !tokenConfigured && (
                    <div className="text-[11px] text-neutral-500 pt-0.5">
                      {t('admin.tokenNoMasterKey')}
                    </div>
                  )}
                </div>

                {tokenConflictError && (
                  <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>{t('admin.conflict')}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadSettings()}
                      className="px-2.5 py-1 rounded bg-amber-200/80 hover:bg-amber-300 text-amber-900 font-medium shrink-0 ml-2 transition-colors active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                    >
                      {t('admin.takeLatest')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {!loadingSettings && !loadSettingsError && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => void handleSaveToken('')}
                disabled={savingToken || !tokenConfigured}
                className="px-3 py-2 rounded-lg border border-neutral-200 text-neutral-600 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50/50 disabled:opacity-40 text-xs font-medium transition-colors cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                {t('admin.tokenClear')}
              </button>
              <button
                type="button"
                onClick={() => void handleSaveToken(tokenInput)}
                disabled={savingToken || !tokenInput.trim()}
                className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                {savingToken ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {savingToken ? t('admin.saving') : t('admin.saveToken')}
              </button>
            </div>
          )}
        </section>

        {/* GitHub Refresh Window Card */}
        <section className="lg:col-span-2 bg-white border border-neutral-200/90 rounded-xl shadow-xs hover:shadow-sm transition-shadow p-6 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="flex items-start justify-between border-b border-neutral-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-sky-50 text-sky-700 border border-sky-100/80">
                  <Timer className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">{t('admin.syncTitle')}</h2>
                  <p className="text-xs text-neutral-500">{t('admin.syncSubtitle')}</p>
                </div>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-neutral-100 text-neutral-600">
                {savedSyncMaxAge === '0s' ? t('admin.syncOff') : savedSyncMaxAge || t('admin.syncDefault')}
              </span>
            </div>

            <p className="text-xs text-neutral-600 leading-relaxed">
              {syncMaxAgeLocked ? t('admin.syncLocked') : t('admin.syncBody')}<strong>{savedSyncMaxAge === '0s' ? t('admin.syncOff') : savedSyncMaxAge || '1h0m0s'}</strong>。
            </p>

            {loadSettingsError ? (
              <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                <span>{t('admin.loadFailedProxyHint', { error: loadSettingsError })}</span>
              </div>
            ) : loadingSettings ? (
              <div className="py-8 text-center text-xs text-neutral-400 flex flex-col items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-neutral-400" />
                <span>{t('admin.loading')}</span>
              </div>
            ) : (
              <div className="space-y-4 pt-1">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="sync-max-age-input" className="text-xs font-semibold text-neutral-800">
                      {t('admin.syncPeriod')}
                    </label>
                    {isSyncMaxAgeDirty && (
                      <span className="text-[11px] font-medium text-amber-600 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        {t('admin.unsavedChanges')}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      id="sync-max-age-input"
                      type="text"
                      value={syncMaxAge}
                      onChange={(e) => setSyncMaxAge(e.target.value)}
                      disabled={syncMaxAgeLocked}
                      placeholder="60m"
                      className="flex-1 min-w-[12rem] rounded-lg border border-neutral-300 bg-neutral-50/40 px-3.5 py-2.5 text-xs text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-500/15 font-mono transition-all"
                    />
                    {['30m', '60m', '6h', '24h'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        disabled={syncMaxAgeLocked}
                        onClick={() => setSyncMaxAge(preset)}
                        className={`px-2.5 py-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          syncMaxAge.trim() === preset
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                            : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
                        } active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600`}
                      >
                        {preset === '30m' ? t('admin.syncPreset30m') : preset === '60m' ? t('admin.syncPreset60m') : preset === '6h' ? t('admin.syncPreset6h') : t('admin.syncPreset24h')}
                      </button>
                    ))}
                  </div>
                  <span className="block text-[11px] text-neutral-400 leading-normal">
                    {t('admin.syncHint')}
                  </span>
                </div>

                <div className="rounded-lg p-3 bg-neutral-50 border border-neutral-200/80 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        savedSyncMaxAge === '0s' ? 'bg-neutral-400' : 'bg-emerald-500 ring-2 ring-emerald-200'
                      }`}
                    />
                    <span className="text-neutral-600">
                      {savedSyncMaxAge === '0s' ? (
                        t('admin.syncOffState')
                      ) : (
                        <>
                          {t('admin.syncEffectiveBefore')}<span className="font-mono font-medium text-emerald-800">{savedSyncMaxAge || '1h0m0s'}</span>{t('admin.syncEffectiveAfter')}
                        </>
                      )}
                    </span>
                  </div>
                </div>

                {syncMaxAgeConflictError && (
                  <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>{t('admin.conflict')}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadSettings()}
                      className="px-2.5 py-1 rounded bg-amber-200/80 hover:bg-amber-300 text-amber-900 font-medium shrink-0 ml-2 transition-colors active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                    >
                      {t('admin.takeLatest')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {!loadingSettings && !loadSettingsError && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-neutral-100">
              <button
                type="button"
                onClick={() => void handleSaveSyncMaxAge('')}
                disabled={syncMaxAgeLocked || savingSyncMaxAge || savedSyncMaxAge === '1h0m0s'}
                className="px-3 py-2 rounded-lg border border-neutral-200 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 disabled:opacity-40 text-xs font-medium transition-colors cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                {t('admin.syncReset')}
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveSyncMaxAge('0')}
                  disabled={syncMaxAgeLocked || savingSyncMaxAge || savedSyncMaxAge === '0s'}
                  className="px-3 py-2 rounded-lg border border-neutral-200 text-neutral-600 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50/50 disabled:opacity-40 text-xs font-medium transition-colors cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                >
                  {t('admin.syncDisable')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveSyncMaxAge(syncMaxAge)}
                  disabled={syncMaxAgeLocked || savingSyncMaxAge || !isSyncMaxAgeDirty}
                  className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                >
                  {savingSyncMaxAge ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {savingSyncMaxAge ? t('admin.saving') : t('admin.syncSave')}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Backup & migration: whole-configuration JSON export/import */}
        <div className="lg:col-span-2">
          <SettingsTransferCard
            apiBase={apiBase}
            revision={revision}
            onImported={handleSettingsImported}
            onConflict={() => setTagCatalogConflict(true)}
            onToast={showToast}
          />
        </div>

        {/* User Role Authorization Card — spans both columns, its form is wide */}
        <section className="lg:col-span-2 bg-white border border-neutral-200/90 rounded-xl shadow-xs hover:shadow-sm transition-shadow p-6 flex flex-col justify-between space-y-6">
          <form onSubmit={(event) => void submitRoles(event)} className="space-y-5">
            <div className="flex items-start justify-between border-b border-neutral-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-neutral-100 text-neutral-800 border border-neutral-200/80">
                  <UserRoundCog className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">{t('admin.roleTitle')}</h2>
                  <p className="text-xs text-neutral-500">{t('admin.roleSubtitle')}</p>
                </div>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-medium border border-emerald-200/60">
                {t('admin.roleBadge')}
              </span>
            </div>

            <p className="text-xs text-neutral-600 leading-relaxed">
              {t('admin.roleBody')}
            </p>

            <div className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-neutral-800">{t('admin.roleUserId')}</span>
                <div className="flex gap-2">
                  <input
                    value={userID}
                    onChange={(event) => setUserID(event.target.value)}
                    inputMode="numeric"
                    pattern="[1-9][0-9]*"
                    required
                    placeholder={t('admin.roleUserIdPlaceholder')}
                    className="flex-1 rounded-lg border border-neutral-300 bg-neutral-50/40 px-3.5 py-2 text-xs text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-500/15 font-mono transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => void loadUserRoles()}
                    disabled={loadingRoles || !/^[1-9]\d*$/.test(userID.trim())}
                    className="px-3.5 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-40 text-neutral-700 text-xs font-medium flex items-center gap-1.5 transition-colors shadow-2xs shrink-0 cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                  >
                    {loadingRoles ? <RefreshCw className="w-3 h-3 animate-spin text-neutral-500" /> : <KeyRound className="w-3.5 h-3.5 text-neutral-500" />}
                    {loadingRoles ? t('admin.roleQuerying') : t('admin.roleQuery')}
                  </button>
                </div>
              </label>

              {/* Roles selection boxes */}
              <div className="pt-2">
                <span className="text-xs font-semibold text-neutral-800 block mb-2">{t('admin.roleAssign')}</span>
                <div className="grid grid-cols-2 gap-3">
                  <label
                    className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                      author
                        ? 'border-emerald-500 bg-emerald-50/50 shadow-2xs'
                        : 'border-neutral-200 bg-neutral-50/50 hover:bg-neutral-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={author}
                      onChange={(event) => setAuthor(event.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 accent-emerald-600"
                    />
                    <div className="space-y-0.5">
                      <span className="text-xs font-semibold text-neutral-900 block">{t('admin.roleAuthor')}</span>
                      <span className="text-[11px] text-neutral-500 block">{t('admin.roleAuthorHint')}</span>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                      reviewer
                        ? 'border-emerald-500 bg-emerald-50/50 shadow-2xs'
                        : 'border-neutral-200 bg-neutral-50/50 hover:bg-neutral-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={reviewer}
                      onChange={(event) => setReviewer(event.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 accent-emerald-600"
                    />
                    <div className="space-y-0.5">
                      <span className="text-xs font-semibold text-neutral-900 block">{t('admin.roleReviewer')}</span>
                      <span className="text-[11px] text-neutral-500 block">{t('admin.roleReviewerHint')}</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="rounded-lg bg-neutral-50 border border-neutral-200/80 p-3 text-[11px] text-neutral-500 flex items-start gap-2 leading-relaxed">
                <Info className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
                <span>
                  {t('admin.roleNote')}
                </span>
              </div>

              {lastSavedRoles && (
                <div className="p-3 rounded-lg bg-emerald-50/80 border border-emerald-200/80 text-xs text-emerald-900 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-mono">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>{t('admin.roleSavedUser', { id: lastSavedRoles.id })}</span>
                  </div>
                  <span className="font-semibold">
                    {lastSavedRoles.roles.length ? lastSavedRoles.roles.join(t('common.listSeparator')) : t('admin.roleCleared')}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end pt-4 border-t border-neutral-100">
              <button
                type="submit"
                disabled={savingRoles || !userID.trim()}
                className="px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                {savingRoles ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {savingRoles ? t('admin.rolesSaving') : t('admin.rolesSave')}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
};
