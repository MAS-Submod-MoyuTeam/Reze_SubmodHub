import React, { useState } from 'react';
import {
  FolderCog,
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  FolderPlus,
  ShieldCheck,
  RefreshCw,
  FolderOpen,
  Smartphone,
  Monitor,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import { Installation } from '../types/client';

export interface AndroidDiagnosticInfo {
  summary: string;
  detail: string;
  isPermissionIssue: boolean;
}

export function getAndroidDiagnosticInfo(diagnostic?: string, detail?: string): AndroidDiagnosticInfo {
  if (!diagnostic) {
    return {
      summary: '目录检查未通过',
      detail: '目录检查未通过，暂无详细原因。',
      isPermissionIssue: false,
    };
  }

  switch (diagnostic) {
    case 'storage_provider_unavailable':
      return {
        summary: '存储权限服务未就绪',
        detail: 'Android 存储权限服务未初始化，尚未执行目录检查。',
        isPermissionIssue: true,
      };
    case 'storage_access_query_failed':
      return {
        summary: '存储权限查询失败',
        detail: detail
          ? `查询存储权限状态时发生错误（${detail}），尚未执行目录检查。`
          : '查询存储权限状态时发生错误，尚未执行目录检查。',
        isPermissionIssue: true,
      };
    case 'storage_access_denied':
      return {
        summary: '存储访问权限未授予',
        detail: '应用尚未获得 Android 存储访问权限，尚未执行目录检查。请授予存储访问权限后再试。',
        isPermissionIssue: true,
      };
    case 'storage_access_unsupported':
      return {
        summary: '当前环境不支持存储访问',
        detail: '当前设备环境不支持此存储访问方式，尚未执行目录检查。',
        isPermissionIssue: true,
      };
    case 'storage_access_error':
      return {
        summary: '存储权限检查异常',
        detail: detail
          ? `系统返回存储权限错误（${detail}），尚未执行目录检查。`
          : '系统返回存储权限错误，尚未执行目录检查。',
        isPermissionIssue: true,
      };
    case 'mas_root_missing':
      return {
        summary: 'MAS 根目录不存在',
        detail: '未检测到 MAS 根目录。请确认手机内部存储中是否存在 MAS 文件夹。',
        isPermissionIssue: false,
      };
    case 'mas_root_not_directory':
      return {
        summary: 'MAS 根路径不是目录',
        detail: 'MAS 根路径已被同名文件占用，而非文件夹。',
        isPermissionIssue: false,
      };
    case 'mas_root_unreadable':
      return {
        summary: 'MAS 根目录无法访问',
        detail: detail
          ? `访问 MAS 根目录时发生读取或权限错误（${detail}）。`
          : '访问 MAS 根目录时发生读取或权限错误。',
        isPermissionIssue: false,
      };
    case 'game_directory_missing':
      return {
        summary: '未找到 game/ 目录',
        detail: 'MAS 根目录已就绪，但未找到 game/ 子目录。请先在手机上启动一次 MAS 游戏以生成 game 目录。',
        isPermissionIssue: false,
      };
    case 'game_path_not_directory':
      return {
        summary: 'game 路径不是目录',
        detail: 'MAS 根目录下的 game 是文件而非目录。',
        isPermissionIssue: false,
      };
    case 'game_directory_unreadable':
      return {
        summary: 'game/ 目录无法访问',
        detail: detail
          ? `访问 game/ 目录时发生读取或权限错误（${detail}）。`
          : '访问 game/ 目录时发生读取或权限错误。',
        isPermissionIssue: false,
      };
    case 'game_directory_verified':
      return {
        summary: 'game/ 目录已验证',
        detail: 'MAS 游戏目录已就绪并验证通过。',
        isPermissionIssue: false,
      };
    default:
      return {
        summary: `目录检查未通过（${diagnostic}）`,
        detail: detail
          ? `目录检查未通过，错误码：${diagnostic}（${detail}）。`
          : `目录检查未通过，错误码：${diagnostic}。`,
        isPermissionIssue: false,
      };
  }
}

interface InstancesViewProps {
  installations: Installation[];
  activeInstallationId: string;
  onSelectActive: (id: string) => Promise<void>;
  onAddCustomInstance: (label: string, path: string) => Promise<void>;
  onRemoveInstance: (id: string) => Promise<void>;
  onRefreshInstances: () => Promise<void>;
  onBrowseDirectory: () => Promise<string>;
  isAndroid?: boolean;
}

export const InstancesView: React.FC<InstancesViewProps> = ({
  installations,
  activeInstallationId,
  onSelectActive,
  onAddCustomInstance,
  onRemoveInstance,
  onRefreshInstances,
  onBrowseDirectory,
  isAndroid = false,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newPath, setNewPath] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const formatBytes = (bytes: number) => {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const handleCreate = async () => {
    if (!newPath.trim()) {
      setValidationError('请输入或选择有效的 MAS 根目录路径');
      return;
    }
    setIsAdding(true);
    try {
      await onAddCustomInstance(newLabel.trim(), newPath.trim());
      setShowAddModal(false);
      setNewLabel('');
      setNewPath('');
      setValidationError(null);
    } catch (error) {
      setValidationError(`目录验证失败：${String(error)}`);
    } finally { setIsAdding(false); }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-950">
      {/* Header */}
      <div className="p-3 sm:p-4 border-b border-neutral-800 bg-neutral-900/50 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <FolderCog className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-neutral-100">
              MAS 游戏实例
            </h2>
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            {isAndroid
              ? 'Android 客户端采用固定的 MAS 根目录；请确保游戏目录已就绪。'
              : '添加本机 MAS 目录，选择当前实例；路径失效时请重新检查。'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isAndroid && (
            <button
              onClick={() => setShowAddModal(true)}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>手选添加新 MAS 目录...</span>
            </button>
          )}
          <button onClick={() => void onRefreshInstances()} className="px-3 py-1.5 text-xs text-neutral-300 hover:text-white flex items-center gap-1 cursor-pointer" title="重新检查目录"><RefreshCw className="w-3.5 h-3.5" />重新检查</button>
        </div>
      </div>

      {/* Main List */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
        {/* Instances Grid */}
        <div className="space-y-3">
          {installations.map((inst) => {
            const isActive = inst.id === activeInstallationId;
            const isAuthorized = inst.permission_state === 'authorized';
            const isAndroidInstance = inst.platform === 'android' || isAndroid;
            const diagInfo = isAndroidInstance ? getAndroidDiagnosticInfo(inst.diagnostic, inst.diagnostic_detail) : null;

            return (
              <div
                key={inst.id}
                className={`p-4 rounded-xl border transition-all ${
                  isActive
                    ? 'bg-neutral-900 border-emerald-500/80 shadow-xs'
                    : 'bg-neutral-900/70 border-neutral-800 hover:border-neutral-700'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-neutral-100 text-sm">{inst.label}</span>
                      {isActive && (
                        <span className="text-[10px] px-2 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
                          当前生效
                        </span>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded ${inst.is_valid ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'}`}>{inst.is_valid ? '目录有效' : '目录失效'}</span>
                    </div>

                    <div className="font-mono text-xs text-neutral-300 bg-neutral-950/70 px-3 py-1.5 rounded-lg border border-neutral-800/80 break-all">
                      {inst.path_hint}
                    </div>

                    <div className="text-[11px] text-neutral-500">
                      {isAndroidInstance
                        ? (inst.is_valid ? 'game/ 目录已验证' : diagInfo?.summary)
                        : (inst.is_valid ? 'game/ 目录已验证' : '找不到 game/ 目录')}
                    </div>
                    {isAndroidInstance && !inst.is_valid && diagInfo && (
                      <div className="mt-2 text-xs text-amber-300/90 bg-amber-950/40 border border-amber-800/40 rounded p-2">
                        {diagInfo.detail}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 self-end md:self-start">
                    {isActive ? (
                      <span className="text-xs text-emerald-400 font-mono flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>使用中</span>
                      </span>
                    ) : (
                      <button disabled={!isAuthorized} onClick={() => void onSelectActive(inst.id)}
                        className="px-3 py-1.5 text-xs font-medium text-neutral-200 hover:text-white bg-neutral-800 hover:bg-neutral-700/80 rounded-lg transition-colors border border-neutral-700"
                      >
                        切换为活动实例
                      </button>
                    )}
                    {inst.id !== 'unverified' && !isAndroid && <button onClick={() => void onRemoveInstance(inst.id)} className="px-2 py-1.5 text-xs text-rose-300 hover:text-rose-200" title="移除实例记录">移除</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

      </div>

      {/* Add Custom Instance Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-xs select-none">
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-lg max-h-[92dvh] sm:max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-3 sm:p-4 border-b border-neutral-800 flex items-center justify-between shrink-0">
              <h3 className="font-bold text-neutral-100 text-sm">手选并验证 MAS 游戏目录</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-3 sm:p-4 space-y-3 text-xs overflow-y-auto grow">
              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  实例显示标签 (Label)
                </label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="例如: MAS 0.12 便携测试版"
                  className="w-full px-3 py-2 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-200 focus:outline-hidden focus:border-neutral-500"
                />
              </div>

              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  根目录绝对路径 (Root Path Hint)
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={newPath}
                    onChange={(e) => {
                      setNewPath(e.target.value);
                      setValidationError(null);
                    }}
                    placeholder="例如: D:\Games\DDLC_MAS_0.12"
                    className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-200 font-mono focus:outline-hidden focus:border-neutral-500"
                  />
                  <button
                    onClick={() => void onBrowseDirectory().then((path) => { if (path) { setNewPath(path); setValidationError(null); } }).catch((error) => setValidationError(String(error)))}
                    className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg shrink-0 cursor-pointer text-center"
                  >
                    浏览...
                  </button>
                </div>
              </div>

              {validationError && (
                <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-200 text-xs font-mono break-all">
                  {validationError}
                </div>
              )}

              <div className="text-neutral-400 text-[11px]">所选目录需要包含 game/ 子目录。</div>
            </div>

            <div className="p-3 sm:p-4 border-t border-neutral-800 bg-neutral-950 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 text-xs shrink-0">
              <button
                onClick={() => setShowAddModal(false)}
                className="min-h-[38px] sm:min-h-0 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg cursor-pointer text-center"
              >
                取消
              </button>
              <button
                onClick={() => void handleCreate()}
                disabled={isAdding}
                className="min-h-[38px] sm:min-h-0 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg shadow-xs cursor-pointer text-center"
              >
                验证并添加实例
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
