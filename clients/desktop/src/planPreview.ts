import type { Plan, PlanChange } from './types/client';
import type { PreviewArchive } from './wails';

export function mapPlanPreview(preview: Awaited<ReturnType<typeof PreviewArchive>>, metadata: Plan): Plan {
  return {
    ...metadata,
    plan_id: preview.plan_id,
    kind: preview.kind as Plan['kind'],
    priority: (preview as { priority?: number }).priority !== undefined
      ? (preview as { priority?: number }).priority
      : metadata.priority,
    changes: (preview.actions || []).map((action) => ({
      target_path: action.path,
      action: action.action as PlanChange['action'],
      previous_owner: action.current_source,
      next_owner: action.target_source,
      previous_hash: action.current_hash,
      next_hash: action.target_hash,
      reason: action.reason,
      backup_required: action.backup_required,
    })),
    backups_required: (preview.actions || []).filter((action) => action.backup_required).length,
    blockers: preview.blockers || [],
    risks: preview.risks || [],
    summary: preview.summary,
  };
}
