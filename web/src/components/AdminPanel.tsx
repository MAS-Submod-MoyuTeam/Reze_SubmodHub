import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Globe, RefreshCw, ShieldCheck, UserRoundCog, XCircle } from 'lucide-react';
import { getFlarumUserRoles, readSession, setFlarumUserRoles } from '../../../ui/auth-api';
import { fetchSettings, testGitHubProxy, updateSettings, type ProxyTestResponse } from '../../../ui/settings-api';
import { useApp } from '../context/AppContext';

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

  const apiBase = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;

  const loadSettings = async () => {
    setLoadingSettings(true);
    setLoadSettingsError(null);
    setConflictError(false);
    try {
      const data = await fetchSettings(apiBase);
      setProxyTemplate(data.github_proxy_template || '');
      setSavedTemplate(data.github_proxy_template || '');
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
    return <div className="max-w-4xl mx-auto px-4 py-16 text-sm text-neutral-600">需要管理员权限。</div>;
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
      const updated = await updateSettings(templateToSave.trim(), revision, session.csrf_token, apiBase);
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="border-b border-neutral-200 pb-4">
        <div className="flex items-center gap-2 text-emerald-700 text-xs font-semibold">
          <ShieldCheck className="w-4 h-4" /> 管理员
        </div>
        <h1 className="text-lg font-bold text-neutral-900 mt-1">设置</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* GitHub Proxy Settings Card */}
        <div className="bg-white border border-neutral-200 rounded-lg p-5 space-y-5">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-emerald-700" />
              <h2 className="text-sm font-semibold text-neutral-900">GitHub 全链路代理</h2>
            </div>
            <span className="text-xs text-neutral-500">版本 #{revision}</span>
          </div>

          <p className="text-xs text-neutral-600 leading-relaxed">
            配置后，服务端对 GitHub 的 API 请求、分页拉取、版本同步以及客户端的模组 ZIP 下载中转均通过该代理访问。留空表示直连。
          </p>

          {loadSettingsError ? (
            <div className="p-3 rounded bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between">
              <span>读取设置失败：{loadSettingsError}</span>
              <button
                type="button"
                onClick={() => void loadSettings()}
                className="underline hover:text-red-900 font-medium"
              >
                重试
              </button>
            </div>
          ) : loadingSettings ? (
            <div className="py-8 text-center text-xs text-neutral-500">正在加载设置...</div>
          ) : (
            <div className="space-y-4">
              <label className="block space-y-1.5 text-xs font-medium text-neutral-700">
                <span>代理模板 URL</span>
                <input
                  type="text"
                  value={proxyTemplate}
                  onChange={(e) => {
                    setProxyTemplate(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="https://proxy.example/{url}"
                  className="w-full rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:border-emerald-600 font-mono"
                />
                <span className="block text-xs text-neutral-400">
                  支持单一占位符：&#123;url&#125;（原始地址）或 &#123;url_encoded&#125;（编码地址）。例如：https://gh.proxy.site/&#123;url&#125;
                </span>
              </label>

              {/* Status Indicator */}
              <div className="text-xs">
                {savedTemplate ? (
                  <span className="text-emerald-700 font-medium">当前已生效代理：{savedTemplate}</span>
                ) : (
                  <span className="text-neutral-500">当前状态：直连 GitHub（未配置代理）</span>
                )}
                {isProxyDirty && (
                  <span className="ml-2 text-amber-600 font-medium">（有未保存修改）</span>
                )}
              </div>

              {/* Conflict Error Notice */}
              {conflictError && (
                <div className="p-3 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>设置已被其他管理员更新，版本发生冲突。</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadSettings()}
                    className="underline hover:text-amber-950 font-medium shrink-0 ml-2"
                  >
                    刷新获取最新设置
                  </button>
                </div>
              )}

              {/* Test Results */}
              {testResult && (
                <div className="p-3 rounded bg-neutral-50 border border-neutral-200 space-y-2 text-xs">
                  <div className="font-semibold text-neutral-700">连接测试结果：</div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-neutral-700">
                      {testResult.api.ok ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-red-600" />
                      )}
                      GitHub API 接口
                    </span>
                    <span className={testResult.api.ok ? 'text-neutral-500' : 'text-red-600'}>
                      {testResult.api.ok ? `${testResult.api.elapsed_ms} ms` : `失败 (${testResult.api.error_code || 'error'})`}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-neutral-700">
                      {testResult.asset.ok ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-red-600" />
                      )}
                      Release ZIP 归档下载
                    </span>
                    <span className={testResult.asset.ok ? 'text-neutral-500' : 'text-red-600'}>
                      {testResult.asset.ok ? `${testResult.asset.elapsed_ms} ms` : `失败 (${testResult.asset.error_code || 'error'})`}
                    </span>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() => void handleTestProxy()}
                  disabled={testingProxy || savingSettings || !proxyTemplate.trim()}
                  className="px-3 py-1.5 rounded border border-neutral-300 hover:bg-neutral-50 disabled:opacity-50 text-neutral-700 text-xs font-semibold flex items-center gap-1"
                >
                  {testingProxy && <RefreshCw className="w-3 h-3 animate-spin" />}
                  {testingProxy ? '测试中...' : '测试连接'}
                </button>

                <button
                  type="button"
                  onClick={() => void handleSaveSettings(proxyTemplate)}
                  disabled={savingSettings || testingProxy}
                  className="px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-semibold"
                >
                  {savingSettings ? '保存中...' : '保存修改'}
                </button>

                <button
                  type="button"
                  onClick={() => void handleSaveSettings('')}
                  disabled={savingSettings || testingProxy || (!proxyTemplate && !savedTemplate)}
                  className="px-3 py-1.5 rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50 text-xs font-semibold"
                >
                  清空并禁用
                </button>
              </div>
            </div>
          )}
        </div>

        {/* User Role Authorization Card (Retained) */}
        <form onSubmit={(event) => void submitRoles(event)} className="bg-white border border-neutral-200 rounded-lg p-5 space-y-5">
          <div className="flex items-center gap-2 border-b border-neutral-100 pb-3">
            <UserRoundCog className="w-4 h-4 text-neutral-600" />
            <h2 className="text-sm font-semibold text-neutral-900">Flarum 用户角色授权</h2>
          </div>
          <label className="block space-y-1.5 text-xs font-medium text-neutral-700">
            <span>Flarum 论坛用户 ID</span>
            <input
              value={userID}
              onChange={(event) => setUserID(event.target.value)}
              inputMode="numeric"
              pattern="[1-9][0-9]*"
              required
              className="w-full rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:border-emerald-600"
            />
            <button
              type="button"
              onClick={() => void loadUserRoles()}
              disabled={loadingRoles || !/^[1-9]\d*$/.test(userID.trim())}
              className="text-xs text-emerald-700 disabled:text-neutral-400"
            >
              {loadingRoles ? '获取中...' : '获取现有角色'}
            </button>
          </label>
          <div className="space-y-2 text-sm text-neutral-800">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={author}
                onChange={(event) => setAuthor(event.target.checked)}
                className="accent-emerald-700"
              />
              作者
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={reviewer}
                onChange={(event) => setReviewer(event.target.checked)}
                className="accent-emerald-700"
              />
              审核员
            </label>
          </div>
          <p className="text-xs text-neutral-500">
            若取消选中任何角色并保存，将移除该用户的所有作者和审核员授权。管理员权限仅能由服务器配置的 Flarum 组管理。
          </p>
          <button
            disabled={savingRoles}
            className="px-4 py-2 rounded bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-semibold"
          >
            {savingRoles ? '保存中...' : '保存角色'}
          </button>
          {lastSavedRoles && (
            <p className="text-xs text-emerald-800" role="status">
              {lastSavedRoles.id}：{lastSavedRoles.roles.length ? lastSavedRoles.roles.join('、') : '无附加角色'}
            </p>
          )}
        </form>
      </div>
    </div>
  );
};
