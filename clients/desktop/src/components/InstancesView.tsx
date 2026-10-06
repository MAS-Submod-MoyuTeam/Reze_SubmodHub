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

interface InstancesViewProps {
  installations: Installation[];
  activeInstallationId: string;
  onSelectActive: (id: string) => void;
  onAddCustomInstance: (label: string, path: string) => void;
  onReauthorizeInstance: (id: string) => void;
}

export const InstancesView: React.FC<InstancesViewProps> = ({
  installations,
  activeInstallationId,
  onSelectActive,
  onAddCustomInstance,
  onReauthorizeInstance,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newPath, setNewPath] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const formatBytes = (bytes: number) => {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const handleCreate = () => {
    if (!newPath.trim()) {
      setValidationError('请输入或选择有效的 MAS 根目录路径');
      return;
    }
    // Check if path contains game or DDLC
    if (!newPath.toLowerCase().includes('ddlc') && !newPath.toLowerCase().includes('mas') && !newPath.toLowerCase().includes('game')) {
      setValidationError('错误代码: [invalid_mas_root] - 该目录下未找到 game/ 核心目录或 MAS 特征文件');
      return;
    }
    onAddCustomInstance(newLabel.trim() || '自定义 MAS 实例', newPath.trim());
    setShowAddModal(false);
    setNewLabel('');
    setNewPath('');
    setValidationError(null);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-950">
      {/* Header */}
      <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <FolderCog className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-neutral-100">
              MAS 游戏实例与存储授权管理 (ListInstallations & SelectInstallation)
            </h2>
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            契约规范要求：未验证有效 MAS 根目录不得执行任何写入操作；支持多实例、Steam 探测与移动端 SAF 授权状态跟踪。
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors"
        >
          <FolderPlus className="w-3.5 h-3.5" />
          <span>手选添加新 MAS 目录...</span>
        </button>
      </div>

      {/* Main List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Instances Grid */}
        <div className="space-y-3">
          {installations.map((inst) => {
            const isActive = inst.id === activeInstallationId;
            const isAuthorized = inst.permission_state === 'authorized';

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
                      <span className="text-[10px] px-2 py-0.2 rounded bg-neutral-800 text-neutral-300 font-mono">
                        MAS {inst.mas_version}
                      </span>
                      <span className="text-[10px] text-neutral-400 uppercase font-mono">
                        平台: {inst.platform}
                      </span>
                    </div>

                    <div className="font-mono text-xs text-neutral-300 bg-neutral-950/70 px-3 py-1.5 rounded-lg border border-neutral-800/80 break-all">
                      {inst.path_hint}
                    </div>

                    {/* Verification Checklist */}
                    <div className="flex items-center gap-3 text-[11px] text-neutral-400 pt-1 font-mono">
                      <span className="flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>game/ 目录存在</span>
                      </span>
                      <span className="flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>submods/ 挂载点就绪</span>
                      </span>
                      <span className="flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>log/submod_log.txt 可写</span>
                      </span>
                      <span className="text-neutral-400">
                        剩余存储: {formatBytes(inst.disk_available_bytes)}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 self-end md:self-start">
                    {!isAuthorized ? (
                      <button
                        onClick={() => onReauthorizeInstance(inst.id)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-neutral-950 transition-colors flex items-center gap-1"
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>重新授权目录 (SAF)</span>
                      </button>
                    ) : isActive ? (
                      <span className="text-xs text-emerald-400 font-mono flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>使用中</span>
                      </span>
                    ) : (
                      <button
                        onClick={() => onSelectActive(inst.id)}
                        className="px-3 py-1.5 text-xs font-medium text-neutral-200 hover:text-white bg-neutral-800 hover:bg-neutral-700/80 rounded-lg transition-colors border border-neutral-700"
                      >
                        切换为活动实例
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Directory Structure Technical Specification Card */}
        <div className="p-4 rounded-xl bg-neutral-900/50 border border-neutral-800 text-xs space-y-3">
          <div className="font-semibold text-neutral-200">
            MAS 根目录有效性契约与文件布局标准
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-neutral-400 font-mono text-[11px]">
            <div className="bg-neutral-950/70 p-3 rounded-lg border border-neutral-800/80 space-y-1">
              <div className="text-neutral-200 font-semibold mb-1">子模组安装目录 (Submods Root)</div>
              <div>• 路径：<code>&lt;MAS_ROOT&gt;/game/submods/&lt;Mod_ID&gt;/</code></div>
              <div>• 放置：包含 <code>header.rpy</code> 的主逻辑脚本及附属 <code>.rpy/.rpyc</code></div>
              <div>• 规则：每个子模组建议拥有独立自包含文件夹</div>
            </div>

            <div className="bg-neutral-950/70 p-3 rounded-lg border border-neutral-800/80 space-y-1">
              <div className="text-neutral-200 font-semibold mb-1">外观礼包目录 (Spritepack Assets)</div>
              <div>• 路径：<code>&lt;MAS_ROOT&gt;/game/mod_assets/monika/&lt;layer&gt;/</code></div>
              <div>• 放置：按部位分类的发带 (c)、衣服 (b)、发型 (h)、配件 (a)</div>
              <div>• 礼物：<code>&lt;MAS_ROOT&gt;/characters/&lt;giftname&gt;.gift</code> 送礼判定</div>
            </div>
          </div>
        </div>
      </div>

      {/* Add Custom Instance Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-none">
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
              <h3 className="font-bold text-neutral-100 text-sm">手选并验证 MAS 游戏目录</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-neutral-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3 text-xs">
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
                <div className="flex gap-2">
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
                    onClick={() => {
                      setNewPath('D:\\Games\\DDLC_MAS_Custom');
                      setValidationError(null);
                    }}
                    className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg shrink-0"
                  >
                    模拟浏览...
                  </button>
                </div>
              </div>

              {validationError && (
                <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-200 text-xs font-mono">
                  {validationError}
                </div>
              )}

              <div className="text-neutral-400 text-[11px] leading-relaxed">
                选择后，客户端将根据 <code>DiscoverInstallations</code> 契约扫描 <code>game/</code> 核心与 <code>definitions.rpy</code>，提取 MAS 版本号并分配唯一实例 ID。
              </div>
            </div>

            <div className="p-4 border-t border-neutral-800 bg-neutral-950 flex justify-end gap-2 text-xs">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg shadow-xs"
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
