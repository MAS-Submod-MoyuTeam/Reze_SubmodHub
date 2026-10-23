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

const failure = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('conflict')) return '设置已被其他管理员修改。请刷新节点列表后重试，表单内容已保留。';
  if (message.includes('authentication')) return '认证失败，请检查网页登录用户名与密码。';
  if (message.includes('timeout')) return '连接超时，请检查节点网络状态后重试。';
  if (message.includes('master_key')) return '服务端尚未配置有效主密钥，暂时无法保存新凭据。';
  if (message.includes('forbidden')) return '权限不足，请重新登录并确认管理员权限。';
  return '操作失败，请检查配置参数或稍后重试。';
};

export function DownloadNodeSettings({ apiBase }: { apiBase: string }) {
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
  }, [load]);

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
      setNotice('节点配置已保存。分发镜像将在后台排队补齐。');
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
      setNotice('节点配置已成功删除，网盘对象不受影响。');
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
      setNotice(`已重新排队 ${result.retried} 个失败镜像。`);
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
        setNotice(`节点连通性测试通过（耗时 ${result.elapsed_ms} ms）。认证与根目录元数据均正常。`);
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
              下载交付与镜像网络
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Cloudreve 网盘存储直链 · GitHub 资产代理转发 · 主服务器备用兜底
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => void load()}
            className="px-3.5 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-40 text-neutral-700 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-600' : 'text-neutral-500'}`} />
            刷新列表
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
            className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            添加交付节点
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Context info banner */}
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200/80 text-xs text-neutral-600 leading-relaxed">
          <Info className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
          <div>
            普通模组 ZIP 安装包优先通过已完成哈希校验的外部镜像分发交付；主服务器始终保留兜底能力。复杂精灵包（Spritepacks）继续由主服务器流水线统一交付。
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
            <span>当前没有处于可用状态的外部镜像节点，全站所有下载流量将由主服务器承担。建议配置 Cloudreve 节点分担带宽。</span>
          </div>
        )}
        {settings && !settings.master_key_configured && (
          <div className="flex items-center gap-2.5 text-xs text-amber-900 bg-amber-50 border border-amber-200/80 rounded-xl p-3.5 shadow-2xs">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
            <span>服务端尚未配置凭据主密钥（Master Key），无法保存新节点的鉴权密码或授权密钥。请联系系统运维人员。</span>
          </div>
        )}

        {/* Node Cards List */}
        {loading ? (
          <div className="py-16 text-center text-xs text-neutral-400 flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
            <span>正在加载交付节点状态...</span>
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
                            ? '内置兜底'
                            : isCloudreve
                            ? 'Cloudreve 直链'
                            : 'GitHub 转发'}
                        </span>
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 border ${
                            node.enabled
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200/60'
                              : 'bg-neutral-100 text-neutral-500 border-neutral-200'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${node.enabled ? 'bg-emerald-600' : 'bg-neutral-400'}`} />
                          {node.enabled ? '已启用' : '已停用'}
                        </span>
                        <span className="text-[11px] text-neutral-500 font-mono">
                          权重: {node.weight}
                        </span>
                      </div>

                      {/* Status Badges & Mirror Stats */}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-600 pt-0.5">
                        <div className="flex items-center gap-1.5">
                          {node.status === 'available' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> 连接正常
                            </span>
                          ) : node.status === 'failed' ? (
                            <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                              <XCircle className="w-3.5 h-3.5 text-rose-600" /> 检测失败
                            </span>
                          ) : isBuiltin ? (
                            <span className="inline-flex items-center gap-1 text-neutral-600">
                              <CheckCircle2 className="w-3.5 h-3.5 text-neutral-400" /> 始终可用
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-neutral-400">
                              <Activity className="w-3.5 h-3.5" /> 尚未检测
                            </span>
                          )}
                        </div>

                        {node.credential_configured && (
                          <span className="text-[11px] font-mono text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded border border-neutral-200/50">
                            凭据已安全配置
                          </span>
                        )}

                        {node.last_checked_at && (
                          <span className="text-[11px] text-neutral-400">
                            最近检测：{new Date(node.last_checked_at).toLocaleTimeString()}
                          </span>
                        )}
                      </div>

                      {/* Mirror Progress Counters */}
                      {node.mirror_states && (
                        <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                          <span className="text-neutral-500 font-medium">镜像缓存：</span>
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-mono border border-emerald-200/60">
                            就绪 {node.mirror_states.ready || 0}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 font-mono border border-amber-200/60">
                            上传中 {node.mirror_states.uploading || 0}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-600 font-mono border border-neutral-200/60">
                            等待中 {node.mirror_states.pending || 0}
                          </span>
                          {(node.mirror_states.failed || 0) > 0 && (
                            <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-mono font-bold border border-rose-200/60">
                              失败 {node.mirror_states.failed}
                            </span>
                          )}
                        </div>
                      )}

                      {/* App update asset cache, kept separate from mod archives */}
                      {node.app_asset_states && (
                        <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                          <span className="text-neutral-500 font-medium">软件更新缓存：</span>
                          <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-mono border border-emerald-200/60">
                            就绪 {node.app_asset_states.ready || 0}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 font-mono border border-amber-200/60">
                            上传中 {node.app_asset_states.uploading || 0}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-600 font-mono border border-neutral-200/60">
                            等待中 {node.app_asset_states.pending || 0}
                          </span>
                          {(node.app_asset_states.failed || 0) > 0 && (
                            <span className="px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-mono font-bold border border-rose-200/60">
                              失败 {node.app_asset_states.failed}
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
                          className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-40 text-neutral-700 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                        >
                          {isTesting ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-neutral-500" />
                          ) : (
                            <Activity className="w-3.5 h-3.5 text-neutral-500" />
                          )}
                          {isTesting ? '测试中...' : '测试连接'}
                        </button>

                        {!!node.mirror_states?.failed && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void retry(node)}
                            className="px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50/70 hover:bg-amber-100 disabled:opacity-40 text-amber-900 text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                          >
                            {isRetrying ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-700" />
                            ) : (
                              <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
                            )}
                            {isRetrying ? '正在重试...' : '重试失败镜像'}
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => edit(node)}
                          className="px-3 py-1.5 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 hover:border-neutral-300 disabled:opacity-40 text-neutral-700 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-neutral-500" />
                          编辑
                          <span className="sr-only">{node.name}</span>
                        </button>

                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setDeleteID(node.id)}
                          className="px-3 py-1.5 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 disabled:opacity-40 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                          删除
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
                <h4 className="font-bold text-sm text-rose-900">确定要删除该交付节点配置吗？</h4>
                <p className="text-neutral-600 leading-relaxed">
                  删除后系统将移除对应的分发凭据和路由规则，网盘端已上传的文件对象将保留。若删除最后一个外部镜像节点，所有流量将即刻回落至主服务器。
                </p>
              </div>
            </div>
            <div className="flex gap-2.5 pt-1 pl-7">
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove()}
                className="px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-800 disabled:opacity-40 text-white font-semibold transition-colors shadow-2xs cursor-pointer"
              >
                {busy ? '正在删除...' : '确认永久删除'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDeleteID('')}
                className="px-4 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-40 text-neutral-700 font-medium transition-colors cursor-pointer"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* Form: Add or Edit Node */}
        {open && (
          <form
            onSubmit={save}
            className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-6 space-y-6 shadow-xs animate-in fade-in"
          >
            <div className="flex items-center justify-between border-b border-neutral-200/80 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-emerald-100 text-emerald-800">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-neutral-900">
                    {editing ? '编辑交付节点配置' : '添加外部交付节点'}
                  </h3>
                  <p className="text-xs text-neutral-500">
                    配置直链网盘或加速服务，实现普通安装包就近多源分流
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setInput(blank());
                  setOpen(false);
                }}
                className="text-xs text-neutral-400 hover:text-neutral-700 p-1 cursor-pointer"
              >
                关闭
              </button>
            </div>

            <fieldset disabled={busy} className="grid grid-cols-1 sm:grid-cols-2 gap-5 disabled:opacity-60">
              <label className="text-xs font-semibold text-neutral-800 space-y-1.5">
                <span>节点标识 ID（英数字符）</span>
                <input
                  required
                  pattern="[a-zA-Z0-9_-]{1,64}"
                  placeholder="如 node-beijing-cloudreve"
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs font-mono text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/15"
                  value={input.id}
                  disabled={editing}
                  onChange={(e) => setInput({ ...input, id: e.target.value })}
                />
              </label>

              <label className="text-xs font-semibold text-neutral-800 space-y-1.5">
                <span>节点显示名称</span>
                <input
                  required
                  maxLength={128}
                  placeholder="如 华北加速节点 (Cloudreve)"
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/15"
                  value={input.name}
                  onChange={(e) => setInput({ ...input, name: e.target.value })}
                />
              </label>

              <label className="text-xs font-semibold text-neutral-800 space-y-1.5">
                <span>节点架构类型</span>
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
                  <option value="cloudreve">Cloudreve 存储与直链（推荐）</option>
                  <option value="github_relay">GitHub 转发代理</option>
                </select>
              </label>

              <label className="text-xs font-semibold text-neutral-800 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span>分发选择权重 (1 - 100)</span>
                  <span className="font-mono text-neutral-400 font-normal">当前: {input.weight}</span>
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
                    <span>Cloudreve REST API 根地址</span>
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
                    <span>网页登录用户名 / 邮箱</span>
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
                    <span>项目在网盘上的存储专用目录</span>
                    <input
                      required
                      placeholder="/SubmodHub"
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs font-mono text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/15"
                      value={input.directory || ''}
                      onChange={(e) => setInput({ ...input, directory: e.target.value })}
                    />
                    <span className="block text-[11px] text-neutral-500 font-normal">
                      测试连接或上传时，若目录不存在服务端将自动创建。
                    </span>
                  </label>

                  <label className="text-xs font-semibold text-neutral-800 space-y-1.5 sm:col-span-2">
                    <span>下载与上传从机允许的 HTTPS Origin（每行一个）</span>
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
                  <span>节点 HTTPS 服务基础地址</span>
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
                <span>{input.type === 'cloudreve' ? '网盘登录密码' : '节点授权密钥（至少 32 字节）'}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required={!editing}
                  placeholder={editing ? '留空表示保持原有密钥不变' : '请输入密码或密钥'}
                  className="w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs font-mono text-neutral-900 focus:outline-hidden focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/15"
                  value={input.password}
                  onChange={(e) => setInput({ ...input, password: e.target.value })}
                />
                <span className="block text-[11px] text-neutral-500 font-normal">
                  {editing
                    ? '留空保留原凭据；输入新值将即刻替换。'
                    : '密钥仅在保存时发送至服务端并以 AES 加密存储。'}
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
                  <span className="text-xs font-semibold text-neutral-800">启用此节点接入分发调度</span>
                </label>
                <span className="text-[11px] text-neutral-500">
                  能力：{input.type === 'cloudreve' ? 'Cloudreve 存储与直链' : 'GitHub 转发'}
                </span>
              </div>
            </fieldset>

            <div className="flex items-center justify-between pt-4 border-t border-neutral-200">
              <span className="text-[11px] text-neutral-500">
                保存后可立即在列表点击「测试连接」验证节点连通性。
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setInput(blank());
                    setOpen(false);
                  }}
                  className="px-4 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-700 text-xs font-medium transition-colors cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={busy || (!settings?.master_key_configured && (!editing || input.password !== ''))}
                  className="px-5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 disabled:opacity-40 text-white text-xs font-semibold transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
                  {busy ? '正在处理...' : editing ? '保存修改' : '确认添加'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
