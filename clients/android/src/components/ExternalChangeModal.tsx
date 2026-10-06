import React from 'react';
import { Operation } from '../types/submodhub';
import { AlertTriangle, X, ShieldAlert, FileDiff, Check, RotateCcw } from 'lucide-react';

interface ExternalChangeModalProps {
  operation: Operation;
  onClose: () => void;
  onResolve: (action: 'backup_and_overwrite' | 'abort' | 'force_overwrite') => void;
}

export const ExternalChangeModal: React.FC<ExternalChangeModalProps> = ({
  operation,
  onClose,
  onResolve,
}) => {
  const drift = operation.drift_detail;

  return (
    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-sm bg-slate-900 border border-amber-600/70 rounded-3xl p-5 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                文件哈希漂移拦截
              </h3>
              <span className="font-mono text-[10px] text-amber-400">
                external_change 暂停保护
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Contract Warning Description */}
        <p className="text-xs text-slate-300 leading-relaxed">
          SubmodHub 在准备写入前执行了原子哈希核验，检测到目标文件已被外部文本编辑器或第三方修改：
        </p>

        {drift && (
          <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 space-y-2 text-xs font-mono">
            <div className="text-slate-400 break-all">
              路径: <span className="text-amber-200">{drift.file_path}</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>基线预期:</span>
              <span className="text-slate-300">#{drift.expected_hash.slice(0, 16)}</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>当前实测:</span>
              <span className="text-rose-400 font-bold">#{drift.actual_hash.slice(0, 16)}</span>
            </div>
          </div>
        )}

        <div className="p-2.5 rounded-xl bg-slate-950 text-[11px] text-slate-400">
          <strong>协议原则：</strong>
          客户端严格遵循非破坏性原则，禁止未经允许直接覆写用户改动。
        </div>

        {/* Resolution Options */}
        <div className="space-y-2 pt-1">
          <button
            onClick={() => onResolve('backup_and_overwrite')}
            className="w-full py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-md transition-all active:scale-95"
          >
            <Check className="w-4 h-4" />
            <span>自动备份当前本地修改，并继续升级</span>
          </button>

          <button
            onClick={() => onResolve('abort')}
            className="w-full py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 font-medium text-xs flex items-center justify-center gap-1.5 border border-slate-700 transition-all"
          >
            <RotateCcw className="w-4 h-4 text-rose-400" />
            <span>放弃本次升级，完整保留本地改动</span>
          </button>

          <button
            onClick={() => onResolve('force_overwrite')}
            className="w-full py-2 px-3 rounded-xl text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            丢弃本地修改，强制覆盖为官方版本
          </button>
        </div>
      </div>
    </div>
  );
};
