import React from 'react';
import { X, FileCode2, ShieldCheck, HardDrive, CheckCircle2 } from 'lucide-react';
import { InstalledItem } from '../types/client';

interface FileInspectModalProps {
  item: InstalledItem | null;
  onClose: () => void;
}

export const FileInspectModal: React.FC<FileInspectModalProps> = ({ item, onClose }) => {
  if (!item) return null;

  // Generate simulated file list based on item
  const files = item.unmanaged_paths
    ? item.unmanaged_paths.map((p) => ({
        path: p,
        size_bytes: 18400,
        sha256: item.sha256,
        status: 'intact',
      }))
    : [
        {
          path: `game/submods/${item.submod_dir_name || item.mod_id}/header.rpy`,
          size_bytes: 28400,
          sha256: '9a87d46e38b3a0f18835b8df838520cf8126b4859a4bb38ca094f31c771fa109',
          status: 'intact',
        },
        {
          path: `game/submods/${item.submod_dir_name || item.mod_id}/main.rpy`,
          size_bytes: 142000,
          sha256: '38a902bf8910a8b901fc883901af88290192c39281a8902ef8910acb88301893',
          status: item.integrity_status === 'modified' ? 'modified' : 'intact',
        },
        {
          path: `game/submods/${item.submod_dir_name || item.mod_id}/assets/manifest.json`,
          size_bytes: 3200,
          sha256: '8830189338a902bf8910a8b901fc883901fa88290192c39281a8902ef8910acb',
          status: 'intact',
        },
      ];

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-none">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-950/80">
          <div>
            <div className="flex items-center gap-2">
              <FileCode2 className="w-4 h-4 text-emerald-400" />
              <h3 className="font-bold text-neutral-100 text-sm">{item.title}</h3>
              <span className="text-xs font-mono text-neutral-400">
                ({item.is_managed ? '已托管' : '未托管'})
              </span>
            </div>
            <div className="text-xs text-neutral-400 mt-0.5 font-mono">
              安装版本: v{item.installed_version} · 记录散列: {item.sha256.substring(0, 16)}...
            </div>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs">
          <div className="text-neutral-400 font-sans text-xs mb-2">
            当前 MAS 实例硬盘中属于该模组的物理文件清单及哈希：
          </div>

          <div className="border border-neutral-800 rounded-lg overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-neutral-950 text-neutral-400 text-[11px] border-b border-neutral-800">
                <tr>
                  <th className="py-2 px-3">文件相对路径</th>
                  <th className="py-2 px-3 text-right">大小</th>
                  <th className="py-2 px-3">SHA-256 散列</th>
                  <th className="py-2 px-3">校验状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60 bg-neutral-900/40">
                {files.map((f, i) => (
                  <tr key={i} className="hover:bg-neutral-800/30">
                    <td className="py-2 px-3 text-neutral-200 truncate max-w-sm" title={f.path}>
                      {f.path}
                    </td>
                    <td className="py-2 px-3 text-right text-neutral-300 tabular-nums">
                      {formatBytes(f.size_bytes)}
                    </td>
                    <td className="py-2 px-3 text-neutral-400 text-[10px]">
                      {f.sha256.substring(0, 16)}...
                    </td>
                    <td className="py-2 px-3">
                      {f.status === 'intact' ? (
                        <span className="text-emerald-400 text-[11px] flex items-center gap-1 font-sans">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>匹配</span>
                        </span>
                      ) : (
                        <span className="text-amber-400 text-[11px] flex items-center gap-1 font-sans">
                          <span>已篡改</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="p-3 border-t border-neutral-800 bg-neutral-950 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
