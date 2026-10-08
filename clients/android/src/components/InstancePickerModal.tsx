import React from 'react';
import { Installation } from '../types/submodhub';
import { formatBytes } from '../utils/formatters';
import { X, HardDrive, ShieldCheck, AlertTriangle, Check, Plus, RefreshCw } from 'lucide-react';

interface InstancePickerModalProps {
  isOpen: boolean;
  installations: Installation[];
  currentInstallationId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  onDiscover: () => void;
  onReauthorize: (id: string) => void;
}

export const InstancePickerModal: React.FC<InstancePickerModalProps> = ({
  isOpen,
  installations,
  currentInstallationId,
  onClose,
  onSelect,
  onDiscover,
  onReauthorize,
}) => {
  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-750 rounded-3xl p-5 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">选择 MAS 游戏实例</h3>
              <p className="text-[10px] text-slate-400">跨存储与分身实例隔离管理</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          {installations.map((inst) => {
            const isSelected = inst.id === currentInstallationId;
            const isOk = inst.permission_state === 'granted';

            return (
              <div
                key={inst.id}
                onClick={() => {
                  onSelect(inst.id);
                  onClose();
                }}
                className={`p-3 rounded-2xl border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-rose-500/10 border-rose-500/50 shadow-md ring-1 ring-rose-500/30'
                    : 'bg-slate-950/70 border-slate-800 hover:bg-slate-850'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-200 truncate">
                        {inst.label}
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-rose-400" />}
                    </div>
                    <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
                      {inst.path_hint}
                    </p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1">
                      <span>MAS {inst.mas_version}</span>
                      <span>·</span>
                      <span>{formatBytes(inst.free_space_bytes)} 可用</span>
                    </div>
                  </div>

                  <div className="shrink-0 ml-2">
                    {isOk ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" /> 授权正常
                      </span>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onReauthorize(inst.id);
                        }}
                        className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-mono border border-amber-500/40 hover:bg-amber-500/30"
                      >
                        需重授权
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-2 flex items-center gap-2">
          <button
            onClick={() => {
              onDiscover();
            }}
            className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-medium border border-slate-700 flex items-center justify-center gap-1.5 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5 text-rose-400" />
            <span>自动扫描新目录</span>
          </button>
        </div>
      </div>
    </div>
  );
};
