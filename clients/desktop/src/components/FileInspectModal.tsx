import React, { useEffect, useState } from 'react';
import { X, FileCode2, ShieldCheck, HardDrive, CheckCircle2 } from 'lucide-react';
import { InstalledItem } from '../types/client';
import { ListInstalledModFiles, ScanLocalSubmods } from '../wails';
import { loadInstalledFiles, type InspectedFile } from '../installedFiles';

interface FileInspectModalProps {
  item: InstalledItem | null;
  onClose: () => void;
}

export const FileInspectModal: React.FC<FileInspectModalProps> = ({ item, onClose }) => {
  const [files, setFiles] = useState<InspectedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setFiles([]);
    setError('');
    setLoading(true);
    if (item) {
      loadInstalledFiles(item, { list: ListInstalledModFiles, scan: ScanLocalSubmods })
        .then((result) => { if (!cancelled) setFiles(result); })
        .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }
    return () => { cancelled = true; };
  }, [item]);

  if (!item) return null;

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
              安装版本: {item.installed_version} · 记录散列: {item.sha256.substring(0, 16)}...
            </div>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-xs">
          <div className="text-neutral-400 font-sans text-xs mb-2">
            {item.is_managed ? '当前 MAS 实例安装清单及记录哈希（状态已与磁盘核对）：' : '当前 MAS 实例磁盘扫描结果（未托管文件无安装基线）：'}
          </div>

          {loading && <div role="status" className="text-neutral-400">正在读取真实文件清单…</div>}
          {error && <div role="alert" className="text-amber-400">加载文件清单失败：{error}</div>}
          {!loading && !error && files.length === 0 && <div className="text-neutral-400">该模组没有文件记录</div>}

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
                {files.map((f) => (
                  <tr key={f.path} className="hover:bg-neutral-800/30">
                    <td className="py-2 px-3 text-neutral-200 truncate max-w-sm" title={f.path}>
                      {f.path}
                    </td>
                    <td className="py-2 px-3 text-right text-neutral-300 tabular-nums">
                      {formatBytes(f.size_bytes)}
                    </td>
                    <td className="py-2 px-3 text-neutral-400 text-[10px]" title={f.sha256}>
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
                          <span>{f.status === 'overridden' ? '被覆盖' : f.status === 'unmanaged' ? '未托管' : '已修改或缺失'}</span>
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
