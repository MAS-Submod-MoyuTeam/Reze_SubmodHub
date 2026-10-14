export type ModCategory = 'submod' | 'spritepack';

export type PlatformType = 'windows' | 'android';

export interface Author {
  id: string;
  display_name: string;
  avatar_url?: string;
}

export interface Dependency {
  mod_id: string;
  mod_title?: string;
  version_range: string;
  required: boolean;
}

export interface ScanFileEntry {
  source_path: string;
  target_path: string;
  size_bytes: number;
  sha256: string;
  kind: 'script' | 'image' | 'audio' | 'data' | 'other';
  warnings?: string[];
}

export interface ScanReport {
  id: string;
  status: 'pending' | 'running' | 'ready' | 'failed';
  files: ScanFileEntry[];
  unsupported_paths: string[];
  registrations: Array<{
    name: string;
    type: string;
    confidence: 'known' | 'unknown';
  }>;
  sprite_identities: string[];
  derived_gifts: string[];
  blockers: string[];
  warnings: string[];
  resource_stats: {
    scripts_count: number;
    images_count: number;
    audio_count: number;
    total_bytes: number;
  };
}

export interface ModVersion {
  id: string;
  mod_id: string;
  version: string;
  state: 'draft' | 'uploaded' | 'scanning' | 'ready_for_review' | 'approved' | 'published' | 'rejected' | 'unpublished';
  size_bytes: number;
  sha256: string;
  release_notes: string;
  dependencies: Dependency[];
  scan_report?: ScanReport;
  created_at: string;
}

export interface ModSummary {
  id: string;
  title: string;
  summary: string;
  description?: string;
  author: Author;
  category: ModCategory;
  tags: string[];
  supported_platforms: PlatformType[];
  mas_version_range: string;
  recommended_priority: number;
  latest_version_id: string;
  latest_version: string;
  size_bytes: number;
  sha256: string;
  updated_at: string;
  downloads_count: number;
  banner_color?: string;
  source_type?: string;
}

export interface Installation {
  id: string;
  label: string;
  platform: PlatformType;
  path_hint: string;
  permission_state: 'authorized' | 'revoked' | 'pending';
  mas_version: string;
  is_valid: boolean;
  is_running: boolean;
  disk_available_bytes?: number | null;
  last_validated_at: string;
}

export type PlanKind = 'install' | 'update' | 'uninstall' | 'repair' | 'adopt';

export interface PlanChange {
  target_path: string;
  action: 'CREATE' | 'OVERWRITE' | 'REMOVE' | 'RESTORE' | 'METADATA_ONLY';
  previous_owner?: string | null;
  next_owner?: string | null;
  previous_hash?: string | null;
  next_hash?: string | null;
  reason: string;
  backup_required: boolean;
}

export interface SpriteSelectionPlanContext {
  baseline_ids?: string[];
  final_ids?: string[];
  removed_ids?: string[];
  unavailable_installed_ids?: string[];
  unknown_legacy_selection?: boolean;
}

export interface Plan {
  backend_operation_id?: string;
  target_installation_id?: string;
  archive_sha256?: string;
  category?: 'submod' | 'spritepack';
  plan_id: string;
  kind: PlanKind;
  installation_id: string;
  mod_id: string;
  mod_title: string;
  author_name?: string;
  version_id: string;
  version_str: string;
  priority?: number;
  expires_at: string;
  dependency_blockers: Array<{
    mod_id: string;
    mod_title: string;
    required_range: string;
    current_installed?: string;
    reason: string;
  }>;
  semantic_blockers: Array<{
    type: 'duplicate_id' | 'giftname_conflict' | 'label_collision';
    identifier: string;
    conflicting_with: string;
    details: string;
  }>;
  changes: PlanChange[];
  backups_required: number;
  bytes_required: number;
  warnings: string[];
  summary?: { restores_original: number; restores_layer: number; metadata_only: number; deletes_added: number; writes_new: number };
  blockers?: string[];
  risks?: Array<{ type: string; path?: string; description: string }>;
  sprite_set_ids?: string[];
  sprite_selection_hash?: string;
  selected_sprite_set_count?: number;
  sprite_selection_context?: SpriteSelectionPlanContext;
}

export type OperationState =
  | 'planned'
  | 'downloading'
  | 'scanning'
  | 'backed_up'
  | 'writing'
  | 'committed'
  | 'blocked'
  | 'recoverable'
  | 'rolling_back'
  | 'rolled_back'
  | 'needs_manual_recovery'
  | 'unknown';

export interface Operation {
  operation_id: string;
  installation_id: string;
  target_installation_id?: string;
  mod_id: string;
  mod_title: string;
  version_id: string;
  version_str: string;
  kind: PlanKind;
  state: OperationState;
  phase?: string;
  can_rollback?: boolean;
  conflict_path?: string;
  expected_hash?: string;
  actual_hash?: string;
  sprite_set_ids?: string[];
  sprite_selection_hash?: string;
  selected_sprite_set_count?: number;
  progress: {
    stage: string;
    current_file?: string;
    processed_files: number;
    total_files: number;
    bytes_processed: number;
    total_bytes: number;
    percent: number;
  };
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  backup_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ExecutionSession {
  operation_id: string;
  installation_id: string;
  plan_id: string;
  kind: PlanKind;
  mod_title: string;
  mod_id: string;
  operation: Operation;
  is_finished: boolean;
  error?: string | null;
  communication_error?: string | null;
}

export interface StoreMatchCandidate {
  mod_id: string;
  title: string;
  priority: 'single_registration' | 'multi_registration';
  score: number;
  registrations: string[];
  evidence: string[];
  reason: string;
}

export interface InstalledItem {
  mod_id: string;
  installation_id?: string;
  title: string;
  summary: string;
  author_name: string;
  category: ModCategory;
  installed_version: string;
  installed_version_id: string;
  latest_version: string;
  latest_version_id: string;
  has_update: boolean;
  priority: number;
  is_managed: boolean;
  files_count: number;
  size_bytes: number;
  installed_at: string;
  sha256: string;
  unmanaged_paths?: string[];
  submod_dir_name?: string;
  scan_item_id?: string;
  registrations?: Array<{
    name: string;
    author?: string;
    version?: string;
    source: string;
    unknown: boolean;
  }>;
  match_status?: 'matched' | 'ambiguous' | 'no_match';
  match_candidates?: StoreMatchCandidate[];
  selected_candidate_id?: string;
  selected_candidate_registrations?: string[];
  warnings?: string[];
  incomplete?: boolean;
  integrity_status: 'intact' | 'modified' | 'unknown';
  managed_operation_id?: string;
  sprite_set_ids?: string[];
  sprite_selection_hash?: string;
  selected_sprite_set_count?: number;
}

export interface ExternalChangeDrift {
  id: string;
  path: string;
  expected_hash: string;
  actual_hash: string;
  mod_id: string;
  mod_title: string;
  detected_at: string;
  status: 'paused' | 'resolved';
}
