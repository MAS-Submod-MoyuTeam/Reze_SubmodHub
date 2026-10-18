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

/**
 * Turn a backend execution error into an actionable message. The backend rolls
 * back the whole transaction when generated cache cleanup fails, so source files
 * and the installation record remain intact and the user can fix the cause and
 * retry instead of being left with a half-uninstalled mod.
 */
export function describeExecutionError(error: Error): string {
  const message = error?.message || String(error);
  if (message.includes('cache_cleanup_failed')) {
    return `清理 Ren'Py 编译缓存失败，本次操作未提交并已触发回滚。请完全关闭游戏，清除目标缓存文件的只读属性或解除占用后重试；若提示需要手动恢复，请先按操作页指引处理。原始错误：${message}`;
  }
  return message;
}
