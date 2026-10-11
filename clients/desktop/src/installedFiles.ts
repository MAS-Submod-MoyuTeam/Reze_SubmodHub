import type { InstalledItem } from './types/client';

export interface InspectedFile {
  path: string;
  size_bytes: number;
  sha256: string;
  status: 'intact' | 'modified' | 'overridden' | 'unmanaged';
}

interface FileSources {
  list: (installationID: string, modID: string) => Promise<{ files: Array<{
    path: string; size_bytes: number; sha256: string; active: boolean; drifted: boolean;
  }> | null } | null>;
  scan: () => Promise<Array<{ directory: string; files: Array<{ path: string; size: number; sha256: string }> | null }> | null>;
}

export async function loadInstalledFiles(item: InstalledItem, sources: FileSources): Promise<InspectedFile[]> {
  if (item.is_managed) {
    const result = await sources.list(item.managed_operation_id || '', item.mod_id);
    if (!result) throw new Error('未找到模组安装文件清单');
    return (result.files || []).map((file) => ({
      path: file.path, size_bytes: file.size_bytes, sha256: file.sha256,
      status: !file.active ? 'overridden' : file.drifted ? 'modified' : 'intact',
    }));
  }
  const submods = await sources.scan();
  const submod = (submods || []).find((candidate) => candidate.directory === (item.submod_dir_name || item.mod_id.replace(/^local:/, '')));
  if (!submod) throw new Error('未找到模组目录，请刷新已安装模组列表');
  return (submod.files || []).map((file) => ({
    path: file.path, size_bytes: file.size, sha256: file.sha256, status: 'unmanaged',
  }));
}
