import type { Plan, PlanChange } from './types/client';
import type { PreviewArchive } from './wails';

export function mapPlanPreview(preview: Awaited<ReturnType<typeof PreviewArchive>>, metadata: Plan): Plan {
  return {
    ...metadata,
    plan_id: preview.plan_id,
    backend_operation_id: (preview as { operation_id?: string }).operation_id || metadata.backend_operation_id,
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
    sprite_set_ids: (preview as { sprite_set_ids?: string[] }).sprite_set_ids || metadata.sprite_set_ids,
    sprite_selection_hash: (preview as { sprite_selection_hash?: string }).sprite_selection_hash || metadata.sprite_selection_hash,
    selected_sprite_set_count: (preview as { selected_sprite_set_count?: number }).selected_sprite_set_count ?? metadata.selected_sprite_set_count,
  };
}
