import React, { useEffect, useState } from 'react';
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
import { fetchSettings, testGitHubProxy, updateSettings, type ProxyTestResponse } from '../../../ui/settings-api';
import { useApp } from '../context/AppContext';
import { DownloadNodeSettings } from './DownloadNodeSettings';

export const AdminPanel: React.FC = () => {
  const { hasRole, showToast } = useApp();

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

  const apiBase = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;

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
        <h2 className="text-base font-bold text-neutral-900 mb-1">访问受限</h2>
        <p className="text-xs text-neutral-500 max-w-sm mx-auto">
          设置面板仅向具备系统管理员（Admin）角色的用户开放。
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
        showToast('success', '代理测试通过：API 与下载均正常。');
      } else {
        showToast('error', '代理测试未通过，请查看卡片详细结果。');
      }
    } catch (err) {
      showToast('error', `代理测试失败：${err instanceof Error ? err.message : 'unknown_error'}`);
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
      showToast('success', templateToSave.trim() ? 'GitHub 代理已保存并生效。' : 'GitHub 代理已清空并恢复直连。');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown_error';
      if (msg.includes('conflict') || msg.includes('409')) {
        setConflictError(true);
        showToast('error', '设置已被其他管理员修改，请重新加载后再试。');
      } else {
        showToast('error', `保存设置失败：${msg}`);
      }
    } finally {
      setSavingSettings(false);
    }
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
            ? 'GitHub 令牌已加密保存并生效。'
            : 'GitHub 令牌已保存并生效（未配置主密钥，明文存储）。'
          : 'GitHub 令牌已清除，回落到匿名配额。'
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown_error';
      if (msg.includes('conflict') || msg.includes('409')) {
        setTokenConflictError(true);
        showToast('error', '设置已被其他管理员修改，请重新加载后再试。');
      } else {
        showToast('error', `保存令牌失败：${msg}`);
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
          ? '已关闭自动刷新，仅保留手动「立即同步」。'
          : `刷新窗口已生效：超过 ${updated.github_sync_max_age} 未检查的 GitHub 源会自动回源。`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown_error';
      if (msg.includes('conflict') || msg.includes('409')) {
        setSyncMaxAgeConflictError(true);
        showToast('error', '设置已被其他管理员修改，请重新加载后再试。');
      } else {
        showToast('error', `保存刷新窗口失败：${msg}`);
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
      showToast('success', '角色授权已保存。');
    } catch (error) {
      showToast('error', `角色设置失败：${error instanceof Error ? error.message : 'unknown_error'}`);
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
      showToast('error', `获取角色失败：${error instanceof Error ? error.message : 'unknown_error'}`);
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
              <ShieldCheck className="w-3.5 h-3.5" /> 系统管理与配置
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              系统设置
            </h1>
            <p className="text-xs sm:text-sm text-neutral-400 max-w-2xl leading-relaxed">
              集中管理分发网络节点、GitHub 代理转发链路及社区用户的权限授权。
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-center">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 backdrop-blur-xs text-xs font-mono text-neutral-300 border border-white/10">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              配置版本 #{revision}
            </span>
          </div>
        </div>
      </div>

      {/* Main Download Delivery Nodes Section */}
      <DownloadNodeSettings apiBase={apiBase} />

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
                  <h2 className="text-sm font-semibold text-neutral-900">GitHub 全链路网络代理</h2>
                  <p className="text-xs text-neutral-500">API 探测、Releases 同步与安装包中转</p>
                </div>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-neutral-100 text-neutral-600">
                rev {revision}
              </span>
            </div>

            <p className="text-xs text-neutral-600 leading-relaxed">
              配置后，服务端对 GitHub 的 API 请求、分页拉取、版本同步以及客户端的模组 ZIP 下载中转均通过该代理访问。留空表示直连 GitHub 官方网络。
            </p>

            {loadSettingsError ? (
              <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>读取配置失败：{loadSettingsError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => void loadSettings()}
                  className="px-2.5 py-1 rounded bg-rose-100 text-rose-800 hover:bg-rose-200 font-medium transition-colors"
                >
                  重试
                </button>
              </div>
            ) : loadingSettings ? (
              <div className="py-12 text-center text-xs text-neutral-400 flex flex-col items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-neutral-400" />
                <span>正在加载配置...</span>
              </div>
            ) : (
              <div className="space-y-4 pt-1">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="proxy-template-input" className="text-xs font-semibold text-neutral-800">
                      GitHub 代理地址
                    </label>
                    {isProxyDirty && (
                      <span className="text-[11px] font-medium text-amber-600 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        未保存修改
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
                      placeholder="例如 100.106.239.85:7890 或 https://proxy.example/{url}"
                      className="w-full rounded-lg border border-neutral-300 bg-neutral-50/40 px-3.5 py-2.5 text-xs text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-500/15 font-mono transition-all"
                    />
                  </div>
                  <span className="block text-[11px] text-neutral-400 leading-normal">
                    支持正向 HTTP 代理（<code>host:port</code>）或 URL 重写反向代理（<code>https://proxy.example/&#123;url&#125;</code>）。
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
                          已生效：<span className="font-mono font-medium text-emerald-800">{savedTemplate}</span>
                        </>
                      ) : (
                        '当前状态：直连 GitHub（未配置代理）'
                      )}
                    </span>
                  </div>
                </div>

                {/* Conflict Error Notice */}
                {conflictError && (
                  <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>设置已被其他管理员更新，版本发生冲突。</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadSettings()}
                      className="px-2.5 py-1 rounded bg-amber-200/80 hover:bg-amber-300 text-amber-900 font-medium shrink-0 ml-2 transition-colors"
                    >
                      刷新获取最新
                    </button>
                  </div>
                )}

                {/* Test Results Card */}
                {testResult && (
                  <div className="p-3.5 rounded-lg bg-neutral-50/80 border border-neutral-200 space-y-2 text-xs">
                    <div className="font-semibold text-neutral-700 flex items-center gap-1.5 pb-1 border-b border-neutral-200/60">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                      代理连通性测试报告
                    </div>
                    <div className="flex items-center justify-between py-0.5">
                      <span className="flex items-center gap-2 text-neutral-700">
                        {testResult.api.ok ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                        )}
                        GitHub REST API 接口
                      </span>
                      <span className={`font-mono ${testResult.api.ok ? 'text-emerald-700 font-medium' : 'text-rose-600'}`}>
                        {testResult.api.ok ? `${testResult.api.elapsed_ms} ms` : `失败 (${testResult.api.error_code || 'error'})`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-0.5">
                      <span className="flex items-center gap-2 text-neutral-700">
                        {testResult.asset.ok ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : (
                          <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
                        )}
                        Release ZIP 资产下载链路
                      </span>
                      <span className={`font-mono ${testResult.asset.ok ? 'text-emerald-700 font-medium' : 'text-rose-600'}`}>
                        {testResult.asset.ok ? `${testResult.asset.elapsed_ms} ms` : `失败 (${testResult.asset.error_code || 'error'})`}
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
                className="px-3.5 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-40 text-neutral-700 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
              >
                {testingProxy ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-neutral-500" />
                ) : (
                  <Globe className="w-3.5 h-3.5 text-neutral-500" />
                )}
                {testingProxy ? '正在测试...' : '测试代理连通性'}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveSettings('')}
                  disabled={savingSettings || testingProxy || (!proxyTemplate && !savedTemplate)}
                  className="px-3 py-2 rounded-lg border border-neutral-200 text-neutral-600 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50/50 disabled:opacity-40 text-xs font-medium transition-colors cursor-pointer"
                >
                  清空直连
                </button>

                <button
                  type="button"
                  onClick={() => void handleSaveSettings(proxyTemplate)}
                  disabled={savingSettings || testingProxy}
                  className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {savingSettings ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {savingSettings ? '保存中...' : '保存代理配置'}
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
                  <h2 className="text-sm font-semibold text-neutral-900">GitHub API 令牌</h2>
                  <p className="text-xs text-neutral-500">提升 API 配额并避免速率限制</p>
                </div>
              </div>
              <span
                className={`text-[11px] px-2 py-0.5 rounded font-medium border ${
                  tokenConfigured
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200/60'
                    : 'bg-amber-50 text-amber-800 border-amber-200/60'
                }`}
              >
                {tokenConfigured ? '已配置' : '匿名配额'}
              </span>
            </div>

            <p className="text-xs text-neutral-600 leading-relaxed">
              未配置令牌时，所有 GitHub API 请求共用匿名配额（<strong>60 次/小时/IP</strong>），托管模组稍多就会触发速率限制退避。填入 Personal Access Token 后提升至 <strong>5000 次/小时</strong>。
            </p>

            {loadSettingsError ? (
              <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                <span>读取配置失败：{loadSettingsError}（可在上方代理卡片点「重试」）</span>
              </div>
            ) : loadingSettings ? (
              <div className="py-12 text-center text-xs text-neutral-400 flex flex-col items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-neutral-400" />
                <span>正在加载配置...</span>
              </div>
            ) : (
              <div className="space-y-4 pt-1">
                <div className="space-y-1.5">
                  <label htmlFor="github-token-input" className="text-xs font-semibold text-neutral-800">
                    {tokenConfigured ? '替换令牌（留空则不修改）' : 'Personal Access Token'}
                  </label>
                  <input
                    id="github-token-input"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder={tokenConfigured ? '输入新令牌以覆盖现有配置' : 'ghp_... 或 github_pat_...'}
                    className="w-full rounded-lg border border-neutral-300 bg-neutral-50/40 px-3.5 py-2.5 text-xs text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-500/15 font-mono transition-all"
                  />
                  <div className="space-y-1 text-[11px] text-neutral-400 leading-normal">
                    <div>
                      <span className="font-medium text-neutral-500">Fine-grained</span>：Repository access 选{' '}
                      <code>Public repositories (read-only)</code>，Permissions 可全部留空（公开仓库只读能力已内置）。
                    </div>
                    <div>
                      <span className="font-medium text-neutral-500">Classic</span>：<strong>不勾任何 scope</strong>——空 scope 同样享有 5000 次/小时，且能读所有公开仓库。
                    </div>
                    <div>仅当仓库是私有的，才需要额外给 <code>Contents: read</code>。令牌不会回显，保存后仅显示末四位，保存或清除后立即生效。</div>
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
                          当前令牌：<span className="font-mono font-medium text-neutral-900">••••••••{tokenHint}</span>
                          <span className="ml-2 text-neutral-400">
                            {tokenEncrypted ? '已加密存储' : '未加密存储'}
                          </span>
                        </>
                      ) : (
                        '当前状态：使用匿名配额（60 次/小时/IP）'
                      )}
                    </span>
                  </div>
                  {tokenConfigured && !tokenEncrypted && (
                    <div className="flex items-start gap-1.5 pt-1 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>
                        当前令牌以明文保存在站点数据中。部署层配置 <code>SUBMODHUB_DELIVERY_MASTER_KEY</code> 后重新保存即可改为加密存储。
                      </span>
                    </div>
                  )}
                  {!masterKeyConfigured && !tokenConfigured && (
                    <div className="text-[11px] text-neutral-500 pt-0.5">
                      未配置 <code>SUBMODHUB_DELIVERY_MASTER_KEY</code>：令牌将明文存储。
                    </div>
                  )}
                </div>

                {tokenConflictError && (
                  <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>设置已被其他管理员更新，版本发生冲突。</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadSettings()}
                      className="px-2.5 py-1 rounded bg-amber-200/80 hover:bg-amber-300 text-amber-900 font-medium shrink-0 ml-2 transition-colors"
                    >
                      刷新获取最新
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
                className="px-3 py-2 rounded-lg border border-neutral-200 text-neutral-600 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50/50 disabled:opacity-40 text-xs font-medium transition-colors cursor-pointer"
              >
                清除令牌
              </button>
              <button
                type="button"
                onClick={() => void handleSaveToken(tokenInput)}
                disabled={savingToken || !tokenInput.trim()}
                className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                {savingToken ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {savingToken ? '保存中...' : '保存令牌'}
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
                  <h2 className="text-sm font-semibold text-neutral-900">GitHub 源检查更新窗口</h2>
                  <p className="text-xs text-neutral-500">超过该时间仍未检查过的源会自动回源</p>
                </div>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-neutral-100 text-neutral-600">
                {savedSyncMaxAge === '0s' ? '已关闭' : savedSyncMaxAge || '默认'}
              </span>
            </div>

            <p className="text-xs text-neutral-600 leading-relaxed">
              {syncMaxAgeLocked ? '此窗口由部署环境变量 GITHUB_SYNC_MAX_AGE 固定；修改环境变量并重启服务后生效。当前生效：' : '以模组的「最近同步时间」为基准：距上次检查超过该窗口的 GitHub 源，会在有人打开该模组时立即补抓，长时间无人访问时由后台巡检兜底。当前生效：'}<strong>{savedSyncMaxAge === '0s' ? '已关闭' : savedSyncMaxAge || '1h0m0s'}</strong>。
            </p>

            {loadSettingsError ? (
              <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                <span>读取配置失败：{loadSettingsError}（可在上方代理卡片点「重试」）</span>
              </div>
            ) : loadingSettings ? (
              <div className="py-8 text-center text-xs text-neutral-400 flex flex-col items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-neutral-400" />
                <span>正在加载配置...</span>
              </div>
            ) : (
              <div className="space-y-4 pt-1">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="sync-max-age-input" className="text-xs font-semibold text-neutral-800">
                      检查窗口
                    </label>
                    {isSyncMaxAgeDirty && (
                      <span className="text-[11px] font-medium text-amber-600 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        未保存修改
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
                        }`}
                      >
                        {preset === '30m' ? '30 分钟' : preset === '60m' ? '60 分钟' : preset === '6h' ? '6 小时' : '24 小时'}
                      </button>
                    ))}
                  </div>
                  <span className="block text-[11px] text-neutral-400 leading-normal">
                    填写 Go 时长格式，例如 <code>60m</code>、<code>4h30m</code>、<code>24h</code>；留空恢复默认 60 分钟，填 <code>0</code> 关闭自动刷新。
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
                        '当前状态：自动刷新已关闭，仅手动「立即同步」会回源'
                      ) : (
                        <>
                          已生效：超过 <span className="font-mono font-medium text-emerald-800">{savedSyncMaxAge || '1h0m0s'}</span> 未检查的源会自动回源
                        </>
                      )}
                    </span>
                  </div>
                </div>

                {syncMaxAgeConflictError && (
                  <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>设置已被其他管理员更新，版本发生冲突。</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadSettings()}
                      className="px-2.5 py-1 rounded bg-amber-200/80 hover:bg-amber-300 text-amber-900 font-medium shrink-0 ml-2 transition-colors"
                    >
                      刷新获取最新
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
                className="px-3 py-2 rounded-lg border border-neutral-200 text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 disabled:opacity-40 text-xs font-medium transition-colors cursor-pointer"
              >
                恢复默认 60 分钟
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveSyncMaxAge('0')}
                  disabled={syncMaxAgeLocked || savingSyncMaxAge || savedSyncMaxAge === '0s'}
                  className="px-3 py-2 rounded-lg border border-neutral-200 text-neutral-600 hover:text-rose-700 hover:border-rose-200 hover:bg-rose-50/50 disabled:opacity-40 text-xs font-medium transition-colors cursor-pointer"
                >
                  关闭自动刷新
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveSyncMaxAge(syncMaxAge)}
                  disabled={syncMaxAgeLocked || savingSyncMaxAge || !isSyncMaxAgeDirty}
                  className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {savingSyncMaxAge ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {savingSyncMaxAge ? '保存中...' : '保存刷新窗口'}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* User Role Authorization Card — spans both columns, its form is wide */}
        <section className="lg:col-span-2 bg-white border border-neutral-200/90 rounded-xl shadow-xs hover:shadow-sm transition-shadow p-6 flex flex-col justify-between space-y-6">
          <form onSubmit={(event) => void submitRoles(event)} className="space-y-5">
            <div className="flex items-start justify-between border-b border-neutral-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-neutral-100 text-neutral-800 border border-neutral-200/80">
                  <UserRoundCog className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">Flarum 用户角色授权</h2>
                  <p className="text-xs text-neutral-500">作者与审核员权限精细分配</p>
                </div>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-medium border border-emerald-200/60">
                权限管理
              </span>
            </div>

            <p className="text-xs text-neutral-600 leading-relaxed">
              输入社区论坛用户 ID 查询并调整指定账号的系统特权。普通用户仅需登录即可提交模组；作者和审核员可赋予额外工作台权限。
            </p>

            <div className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-neutral-800">Flarum 论坛用户 ID</span>
                <div className="flex gap-2">
                  <input
                    value={userID}
                    onChange={(event) => setUserID(event.target.value)}
                    inputMode="numeric"
                    pattern="[1-9][0-9]*"
                    required
                    placeholder="输入正整数数字 ID"
                    className="flex-1 rounded-lg border border-neutral-300 bg-neutral-50/40 px-3.5 py-2 text-xs text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:bg-white focus:ring-2 focus:ring-emerald-500/15 font-mono transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => void loadUserRoles()}
                    disabled={loadingRoles || !/^[1-9]\d*$/.test(userID.trim())}
                    className="px-3.5 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-40 text-neutral-700 text-xs font-medium flex items-center gap-1.5 transition-colors shadow-2xs shrink-0 cursor-pointer"
                  >
                    {loadingRoles ? <RefreshCw className="w-3 h-3 animate-spin text-neutral-500" /> : <KeyRound className="w-3.5 h-3.5 text-neutral-500" />}
                    {loadingRoles ? '查询中...' : '查询角色'}
                  </button>
                </div>
              </label>

              {/* Roles selection boxes */}
              <div className="pt-2">
                <span className="text-xs font-semibold text-neutral-800 block mb-2">分配角色权限</span>
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
                      <span className="text-xs font-semibold text-neutral-900 block">作者 (Author)</span>
                      <span className="text-[11px] text-neutral-500 block">允许提交与管理模组版本</span>
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
                      <span className="text-xs font-semibold text-neutral-900 block">审核员 (Reviewer)</span>
                      <span className="text-[11px] text-neutral-500 block">审阅静态扫描与批准发布</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="rounded-lg bg-neutral-50 border border-neutral-200/80 p-3 text-[11px] text-neutral-500 flex items-start gap-2 leading-relaxed">
                <Info className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
                <span>
                  若取消所有选中项并保存，将移除该用户的作者与审核员角色。注意：管理员权限仅能由服务器在 Flarum 数据库与配置文件中管理。
                </span>
              </div>

              {lastSavedRoles && (
                <div className="p-3 rounded-lg bg-emerald-50/80 border border-emerald-200/80 text-xs text-emerald-900 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-mono">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>用户 #{lastSavedRoles.id}：</span>
                  </div>
                  <span className="font-semibold">
                    {lastSavedRoles.roles.length ? lastSavedRoles.roles.join('、') : '已清空附加角色'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end pt-4 border-t border-neutral-100">
              <button
                type="submit"
                disabled={savingRoles || !userID.trim()}
                className="px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                {savingRoles ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {savingRoles ? '正在保存...' : '保存授权设定'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
};
