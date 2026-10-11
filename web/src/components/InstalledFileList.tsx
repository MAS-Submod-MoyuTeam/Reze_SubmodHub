import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  InstalledMod,
  InstalledFileList as InstalledFileListDTO,
} from '../types/submodhub';
import { formatVersionLabel } from './versionHistory';
import {
  X,
  Search,
  Copy,
  Check,
  AlertTriangle,
  FileCode,
  RefreshCw,
  FolderOpen,
  Info,
} from 'lucide-react';

export interface InstalledFileListProps {
  mod: InstalledMod | null;
  onClose: () => void;
  initialData?: InstalledFileListDTO | null;
  initialError?: { message: string; code?: string } | null;
  installationId?: string;
}

export type StatusFilter = 'all' | 'active' | 'overridden' | 'drifted';

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1);
  return `${val} ${units[i]}`;
}

export function getFileExtension(path: string): string {
  const parts = path.split('.');
  return parts.length > 1 ? '.' + parts[parts.length - 1] : '';
}

export const InstalledFileList: React.FC<InstalledFileListProps> = ({
  mod,
  onClose,
  initialData = null,
  initialError = null,
  installationId,
}) => {
  let getInstalledModFiles: ((id: string, bypassCache?: boolean) => Promise<InstalledFileListDTO>) | undefined;
  let activeInstallationId: string | undefined;
  try {
    const app = useApp();
    getInstalledModFiles = app.getInstalledModFiles;
    activeInstallationId = app.activeInstallationId;
  } catch {
    // Allows standalone rendering in test/isolation environments
  }
  const currentInstallationId = installationId ?? activeInstallationId;

  const [data, setData] = useState<InstalledFileListDTO | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(initialError);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const fetchFiles = useCallback(async (bypassCache = false) => {
    if (!mod || !getInstalledModFiles || initialData || initialError) return;
    const currentRequestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await getInstalledModFiles(mod.mod_id, bypassCache);
      if (currentRequestId !== requestIdRef.current) return;
      setData(result);
    } catch (err: any) {
      if (currentRequestId !== requestIdRef.current) return;
      const code = err?.code;
      let msg = err?.message || '加载文件清单失败';
      if (code === 'not_found' || msg.includes('not_found')) {
        msg = '未找到模组安装记录或清单文件不存在';
      } else if (code === 'permission_lost' || msg.includes('permission_lost')) {
        msg = 'MAS 根目录访问权限已失效，请重新授权存储目录';
      } else if (code === 'manifest_corrupt' || msg.includes('manifest_corrupt')) {
        msg = '安装清单文件已损坏或不完整，请尝试重新扫描或修复';
      } else if (code === 'invalid_mas_root' || msg.includes('invalid_mas_root')) {
        msg = 'MAS 游戏安装目录无效或不可访问';
      }
      setError({ message: msg, code });
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [mod?.id, mod?.mod_id, currentInstallationId, getInstalledModFiles, initialData, initialError]);

  useEffect(() => {
    setData(initialData);
    setError(initialError);
    // Re-verify against disk on panel open or when target mod/instance changes
    fetchFiles(true);
    return () => {
      // Invalidate in-flight requests when instance/mod changes or on unmount
      requestIdRef.current += 1;
    };
  }, [fetchFiles, initialData, initialError]);

  const handleCopy = useCallback(async (text: string, key: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 1500);
    } catch {
      // Ignore
    }
  }, []);

  const filteredFiles = useMemo(() => {
    if (!data?.files) return [];
    return data.files.filter((file) => {
      if (statusFilter === 'active' && !file.active) return false;
      if (statusFilter === 'overridden' && file.active) return false;
      if (statusFilter === 'drifted' && !file.drifted) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const pathMatches = file.path.toLowerCase().includes(q);
        const canonMatches = file.canonical_path.toLowerCase().includes(q);
        if (!pathMatches && !canonMatches) return false;
      }

      return true;
    });
  }, [data?.files, statusFilter, searchQuery]);

  if (!mod) return null;

  const counts = {
    all: data?.files?.length || 0,
    active: data?.files?.filter((f) => f.active).length || 0,
    overridden: data?.files?.filter((f) => !f.active).length || 0,
    drifted: data?.files?.filter((f) => f.drifted).length || 0,
  };

  return (
    <div
      className="fixed inset-0 bg-neutral-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="file-list-title"
    >
      <div className="bg-white rounded-xl shadow-2xl border border-neutral-200 max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between bg-neutral-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-100/70 text-emerald-800 flex items-center justify-center border border-emerald-200">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 id="file-list-title" className="text-base font-bold text-neutral-900">
                  {data?.title || mod.title}
                </h3>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-neutral-200/70 text-neutral-700 font-medium">
                  {formatVersionLabel(data?.version || mod.version)}
                </span>
                {mod.is_managed ? (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                    SubmodHub 托管
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                    未托管检测文件
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-500 mt-0.5 flex items-center gap-2">
                <span>
                  模组标识: <code className="font-mono text-neutral-700">{mod.mod_id}</code>
                </span>
                {data?.installed_at && (
                  <span>• 安装时间: {new Date(data.installed_at).toLocaleString()}</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchFiles(true)}
              disabled={loading}
              className="text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/60 p-2 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-medium"
              title="重新检查磁盘文件与哈希漂移"
              aria-label="刷新校验"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-600' : ''}`} />
              <span className="hidden sm:inline">刷新校验</span>
            </button>
            <button
              onClick={onClose}
              className="text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/60 p-2 rounded-lg transition-colors"
              aria-label="关闭"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading && (
            <div className="py-16 text-center space-y-3">
              <RefreshCw className="w-8 h-8 mx-auto text-emerald-600 animate-spin" />
              <p className="text-sm text-neutral-600">正在读取已安装文件清单并校验磁盘哈希...</p>
            </div>
          )}

          {!loading && error && (
            <div className="p-5 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 space-y-3">
              <div className="flex items-center gap-2 font-bold text-sm text-rose-800">
                <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0" />
                <span>查询失败: {error.message}</span>
              </div>
              <div className="text-xs text-rose-700 flex items-center gap-2">
                {error.code && (
                  <span>
                    错误码: <code className="font-mono bg-rose-100 px-1 py-0.5 rounded">{error.code}</code>
                  </span>
                )}
                <span>本视图为只读模式，未对游戏目录进行任何更改。</span>
              </div>
              <button
                onClick={() => fetchFiles(true)}
                className="px-3 py-1.5 bg-white border border-rose-300 text-rose-800 text-xs font-semibold rounded-md hover:bg-rose-100 transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                重试加载
              </button>
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* Summary Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 text-center">
                  <span className="text-[11px] text-neutral-500 font-medium block">登记文件总数</span>
                  <span className="text-lg font-bold font-mono text-neutral-800">
                    {data.summary.total_files}
                  </span>
                </div>
                <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-lg p-3 text-center">
                  <span className="text-[11px] text-emerald-700 font-medium block">当前生效中</span>
                  <span className="text-lg font-bold font-mono text-emerald-800">
                    {data.summary.active_files}
                  </span>
                </div>
                <div className="bg-amber-50/60 border border-amber-200/80 rounded-lg p-3 text-center">
                  <span className="text-[11px] text-amber-700 font-medium block">被高优先级覆盖</span>
                  <span className="text-lg font-bold font-mono text-amber-800">
                    {data.summary.overridden_files}
                  </span>
                </div>
                <div
                  className={
                    'border rounded-lg p-3 text-center ' +
                    (data.summary.drifted_files > 0
                      ? 'bg-rose-50 border-rose-300 text-rose-900'
                      : 'bg-neutral-50 border-neutral-200 text-neutral-700')
                  }
                >
                  <span
                    className={
                      'text-[11px] font-medium block ' +
                      (data.summary.drifted_files > 0 ? 'text-rose-700' : 'text-neutral-500')
                    }
                  >
                    外部修改 (漂移)
                  </span>
                  <span
                    className={
                      'text-lg font-bold font-mono ' +
                      (data.summary.drifted_files > 0 ? 'text-rose-700' : 'text-neutral-800')
                    }
                  >
                    {data.summary.drifted_files}
                  </span>
                </div>
                <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-3 text-center col-span-2 sm:col-span-1">
                  <span className="text-[11px] text-neutral-500 font-medium block">总登记占用</span>
                  <span className="text-lg font-bold font-mono text-neutral-800">
                    {formatBytes(data.summary.total_size_bytes)}
                  </span>
                </div>
              </div>

              {/* Drift Warning Banner */}
              {data.summary.drifted_files > 0 && (
                <div className="p-4 bg-amber-50/90 border border-amber-300 rounded-lg flex items-start gap-3 text-amber-900 text-xs">
                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold text-amber-950">
                      安全提示：检测到 {data.summary.drifted_files} 个文件存在外部哈希漂移
                    </p>
                    <p className="text-amber-800 leading-relaxed">
                      这些文件在 MAS 目录中已被外部修改，当前只读清单反映了磁盘差异。SubmodHub 已激活安全保护，不会在未确认的情况下覆盖此修改。若需恢复原始版本，请使用重新安装计划恢复流程。
                    </p>
                  </div>
                </div>
              )}

              {/* Controls: Search and Status Filters */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索文件路径或关键字..."
                    className="w-full pl-9 pr-8 py-1.5 bg-neutral-50 border border-neutral-200 rounded-lg text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-400 focus:bg-white"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                      aria-label="清空搜索"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap text-xs">
                  <button
                    onClick={() => setStatusFilter('all')}
                    className={`px-2.5 py-1 rounded transition-colors ${
                      statusFilter === 'all'
                        ? 'bg-neutral-900 text-white font-medium'
                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }`}
                  >
                    全部 ({counts.all})
                  </button>
                  <button
                    onClick={() => setStatusFilter('active')}
                    className={`px-2.5 py-1 rounded transition-colors ${
                      statusFilter === 'active'
                        ? 'bg-emerald-800 text-white font-medium'
                        : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                    }`}
                  >
                    仅生效 ({counts.active})
                  </button>
                  <button
                    onClick={() => setStatusFilter('overridden')}
                    className={`px-2.5 py-1 rounded transition-colors ${
                      statusFilter === 'overridden'
                        ? 'bg-amber-800 text-white font-medium'
                        : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                    }`}
                  >
                    被覆盖 ({counts.overridden})
                  </button>
                  {counts.drifted > 0 && (
                    <button
                      onClick={() => setStatusFilter('drifted')}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        statusFilter === 'drifted'
                          ? 'bg-rose-700 text-white font-medium'
                          : 'bg-rose-50 text-rose-800 hover:bg-rose-100'
                      }`}
                    >
                      外部修改 ({counts.drifted})
                    </button>
                  )}
                </div>
              </div>

              {/* Table / List */}
              {filteredFiles.length === 0 ? (
                <div className="py-12 text-center text-neutral-400 space-y-1 bg-neutral-50/50 rounded-lg border border-neutral-100">
                  <FileCode className="w-7 h-7 mx-auto text-neutral-300" />
                  <p className="text-xs font-medium text-neutral-600">
                    {data.files.length === 0 ? '该模组未登记任何文件' : '没有匹配的筛选结果'}
                  </p>
                  {data.files.length > 0 && (
                    <p className="text-[11px] text-neutral-400">可尝试清空搜索关键字或切换筛选标签</p>
                  )}
                </div>
              ) : (
                <div className="border border-neutral-200 rounded-lg overflow-hidden bg-white shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-neutral-50 text-neutral-600 font-semibold border-b border-neutral-200">
                        <tr>
                          <th className="py-2.5 px-3">文件路径</th>
                          <th className="py-2.5 px-3 w-16">类型</th>
                          <th className="py-2.5 px-3 w-24 text-right">大小</th>
                          <th className="py-2.5 px-3 w-20 text-center">生效层级</th>
                          <th className="py-2.5 px-3 w-24 text-center">状态</th>
                          <th className="py-2.5 px-3 w-32 font-mono">SHA-256 校验值</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {filteredFiles.map((file) => {
                          const ext = getFileExtension(file.path);
                          const pathCopied = copiedKey === 'path:' + file.path;
                          const hashCopied = copiedKey === 'hash:' + file.path;
                          return (
                            <tr
                              key={file.path}
                              className="hover:bg-neutral-50/80 transition-colors group"
                            >
                              <td className="py-2.5 px-3 font-mono text-neutral-800 text-[11px]">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="truncate max-w-[280px] sm:max-w-md cursor-pointer hover:text-emerald-700"
                                    title={file.path}
                                    onClick={() => handleCopy(file.path, 'path:' + file.path)}
                                  >
                                    {file.path}
                                  </span>
                                  <button
                                    onClick={() => handleCopy(file.path, 'path:' + file.path)}
                                    className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-neutral-700 p-0.5 transition-opacity"
                                    title="复制完整路径"
                                    aria-label="复制路径"
                                  >
                                    {pathCopied ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 font-mono text-neutral-500 text-[10px]">
                                {ext ? (
                                  <span className="px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700 border border-neutral-200">
                                    {ext}
                                  </span>
                                ) : (
                                  <span className="text-neutral-300">-</span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-right text-neutral-600 text-[11px]">
                                {formatBytes(file.size_bytes)}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-center text-neutral-600 text-[11px]">
                                <span title={'生效优先级：' + file.layer_order}>
                                  {file.layer_order}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                {file.drifted ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                                    <AlertTriangle className="w-2.5 h-2.5" />
                                    外部修改
                                  </span>
                                ) : file.active ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200">
                                    <Check className="w-2.5 h-2.5 text-emerald-600" />
                                    生效中
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600 border border-neutral-200">
                                    被覆盖
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 font-mono text-neutral-500 text-[10px]">
                                <div className="flex items-center gap-1">
                                  <span
                                    className="cursor-pointer hover:text-neutral-800"
                                    title={'完整 SHA-256: ' + file.sha256}
                                    onClick={() => handleCopy(file.sha256, 'hash:' + file.path)}
                                  >
                                    {file.sha256.substring(0, 10)}...
                                  </span>
                                  <button
                                    onClick={() => handleCopy(file.sha256, 'hash:' + file.path)}
                                    className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-neutral-700 p-0.5 transition-opacity"
                                    title="复制完整哈希"
                                    aria-label="复制哈希"
                                  >
                                    {hashCopied ? (
                                      <Check className="w-3 h-3 text-emerald-600" />
                                    ) : (
                                      <Copy className="w-3 h-3" />
                                    )}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-neutral-200 bg-neutral-50/80 flex items-center justify-between text-xs text-neutral-500">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-neutral-400 flex-shrink-0" />
            <span>只读文件清单：仅用于查看文件归属与磁盘状态，不直接执行写入或删除操作。</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-neutral-200/80 hover:bg-neutral-300/80 text-neutral-800 font-medium rounded-md transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
