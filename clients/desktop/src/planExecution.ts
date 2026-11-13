import type { InstalledItem, PlanKind } from './types/client';

export function getPlanActionText(kind: PlanKind, t: (key: string, vars?: Record<string, string | number>) => string): string {
  switch (kind) {
    case 'repair':
      return t('planAction.repair');
    case 'uninstall':
      return t('planAction.uninstall');
    case 'update':
      return t('planAction.update');
    case 'install':
      return t('planAction.install');
    case 'adopt':
      return t('planAction.adopt');
    default:
      return t('planAction.operation');
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
export function describeExecutionError(error: Error, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const message = error?.message || String(error);
  if (message.includes('cache_cleanup_failed')) {
    return t('planAction.cacheCleanupFailed', { error: message });
  }
  return message;
}
