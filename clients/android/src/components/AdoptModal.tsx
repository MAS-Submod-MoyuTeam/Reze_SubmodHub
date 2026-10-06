import React, { useState } from 'react';
import { InstalledMod } from '../types/submodhub';
import { FolderOpen, X, Check, ShieldCheck, FileCheck } from 'lucide-react';

interface AdoptModalProps {
  unmanagedMod: InstalledMod;
  onClose: () => void;
  onConfirmAdopt: (modId: string, title: string, priority: number) => void;
}

export const AdoptModal: React.FC<AdoptModalProps> = ({
  unmanagedMod,
  onClose,
  onConfirmAdopt,
}) => {
  const [title, setTitle] = useState(
    unmanagedMod.title.replace('未托管模组：', '').replace(/ \(.*\)/, '')
  );
  const [priority, setPriority] = useState(10);

  return (
    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-750 rounded-3xl p-5 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                显式收养未托管模组
              </h3>
              <span className="font-mono text-[10px] text-slate-400">
                Explicit Adoption Workflow
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

        <p className="text-xs text-slate-300 leading-relaxed">
          将检测到的本地散落脚本纳入 SubmodHub 的受管索引，生成哈希快照基线以支持后续的优先级调序与安全更新检测。
        </p>

        {/* Input fields */}
        <div className="space-y-3 text-xs">
          <div>
            <label className="block text-slate-400 mb-1">注册管理名称:</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-10 px-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-100 focus:outline-none focus:border-rose-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">
              设定加载优先级 (Priority): <span className="text-rose-400 font-mono font-bold">{priority}</span>
            </label>
            <input
              type="range"
              min="0"
              max="50"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="w-full accent-rose-500"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>0 (普通)</span>
              <span>25 (较高)</span>
              <span>50 (优先覆盖)</span>
            </div>
          </div>

          {/* Files to adopt */}
          <div>
            <span className="text-slate-400">纳入管理的文件清单 ({unmanagedMod.file_count}):</span>
            <div className="mt-1 p-2.5 bg-slate-950 rounded-xl border border-slate-850 font-mono text-[10px] text-slate-400 space-y-1 max-h-28 overflow-y-auto">
              {unmanagedMod.unmanaged_detected_files?.map((f, i) => (
                <div key={i} className="truncate">
                  ✓ {f}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-2 flex items-center gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-750 text-slate-300 text-xs font-medium hover:bg-slate-800 transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => onConfirmAdopt(unmanagedMod.mod_id, title, priority)}
            className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-md transition-all active:scale-95"
          >
            <Check className="w-4 h-4" />
            <span>完成显式收养</span>
          </button>
        </div>
      </div>
    </div>
  );
};
