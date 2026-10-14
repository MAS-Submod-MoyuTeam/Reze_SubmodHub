import type { InstalledItem, PlanKind } from './types/client';

export function getPlanActionText(kind: PlanKind): string {
  switch (kind) {
    case 'repair':
      return '修复';
    case 'uninstall':
      return '卸载';
    case 'update':
      return '更新';
    case 'install':
      return '安装';
    case 'adopt':
      return '收养';
    default:
      return '操作';
  }
}

export function resolveModInstallationId(item: {
  installation_id?: string;
  managed_operation_id?: string;
  mod_id: string;
}): string {
  return item.installation_id || item.managed_operation_id || item.mod_id;
}
