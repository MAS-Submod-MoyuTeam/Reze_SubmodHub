import React, { useState } from 'react';
import {
  X,
  FileCheck2,
  ShieldCheck,
  CheckCircle2,
  FolderGit2,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { InstalledItem } from '../types/client';

interface AdoptModalProps {
  item: InstalledItem | null;
  onClose: () => void;
  onConfirmAdopt: (adoptedItem: InstalledItem) => void;
}

export const AdoptModal: React.FC<AdoptModalProps> = ({
  item,
  onClose,
  onConfirmAdopt,
}) => {
  const [modTitle, setModTitle] = useState(item?.title || '');
  const [modId, setModId] = useState(item?.mod_id || '');
  const [versionStr, setVersionStr] = useState('1.0.0-adopted');
  const [authorName, setAuthorName] = useState(item?.author_name === '未知作者 (本地检测)' ? '本地自制/导入' : item?.author_name || '');
  const [priority, setPriority] = useState(item?.priority || 50);

  if (!item) return null;

  const handleAdopt = () => {
    const updated: InstalledItem = {
      ...item,
      title: modTitle.trim() || item.title,
      mod_id: modId.trim() || item.mod_id,
      installed_version: versionStr.trim() || '1.0.0',
      author_name: authorName.trim() || '本地导入',
      priority,
      is_managed: true,
      integrity_status: 'intact',
    };
    onConfirmAdopt(updated);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-none">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/90">
          <div className="flex items-center gap-2">
            <FolderGit2 className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-neutral-100 text-sm">
              显式收养为托管模组向导 (Adopt Unmanaged Mod)
            </h3>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs">
          <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 text-neutral-300 leading-relaxed">
            将当前散落于 MAS 目录内的未托管脚本/素材封包并纳入 SubmodHub 的持久化 Ledger。收养后该模组将受版本控制、支持冲突计算与图层优先级调节。
          </div>

          {/* Form fields */}
          <div className="space-y-3">
            <div>
              <label className="text-neutral-300 font-medium block mb-1">
                模组识别名称 (Title)
              </label>
              <input
                type="text"
                value={modTitle}
                onChange={(e) => setModTitle(e.target.value)}
                className="w-full px-3 py-1.5 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-200 focus:outline-hidden focus:border-neutral-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  唯一标识符 ID (mod_id)
                </label>
                <input
                  type="text"
                  value={modId}
                  onChange={(e) => setModId(e.target.value)}
                  className="w-full px-3 py-1.5 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-200 font-mono focus:outline-hidden focus:border-neutral-500"
                />
              </div>

              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  登记基线版本号
                </label>
                <input
                  type="text"
                  value={versionStr}
                  onChange={(e) => setVersionStr(e.target.value)}
                  className="w-full px-3 py-1.5 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-200 font-mono focus:outline-hidden focus:border-neutral-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  作者/归属声明
                </label>
                <input
                  type="text"
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-200 focus:outline-hidden focus:border-neutral-500"
                />
              </div>

              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  初始图层优先级 (Layer 0~100)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={priority}
                  onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-200 font-mono focus:outline-hidden focus:border-neutral-500"
                />
              </div>
            </div>
          </div>

          {/* Scanned files summary */}
          <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800 space-y-1.5 font-mono text-[11px]">
            <div className="text-neutral-400">将纳入托管追踪的物理文件清单 ({item.unmanaged_paths?.length || 0}):</div>
            {item.unmanaged_paths?.map((p) => (
              <div key={p} className="text-neutral-300 truncate">
                ✓ {p}
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-neutral-800 bg-neutral-950/80 flex justify-end gap-2 text-xs">
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg"
          >
            取消
          </button>
          <button
            onClick={handleAdopt}
            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg shadow-xs flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>确认收养并写入 Ledger</span>
          </button>
        </div>
      </div>
    </div>
  );
};
