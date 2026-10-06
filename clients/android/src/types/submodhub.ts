export type Category = 'submod' | 'spritepack';

export type Platform = 'android' | 'windows';

export type VersionState =
  | 'draft'
  | 'uploaded'
  | 'scanning'
  | 'ready_for_review'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'unpublished';

export interface Author {
  id: string;
  display_name: string;
  avatar_url?: string;
}

export interface Dependency {
  mod_id: string;
  mod_name: string;
  version_range: string;
  required: boolean;
  installed_version?: string;
  is_satisfied?: boolean;
}

export interface ScanReport {
  status: 'pending' | 'running' | 'ready' | 'failed';
  files_count: number;
  unsupported_paths: string[];
  registrations: Array<{
    name: string;
    confidence: 'known' | 'unknown';
  }>;
  sprite_identities: string[];
  derived_gifts: string[];
  blockers: string[];
  warnings: string[];
  security_summary: string;
}

export interface ModVersion {
  id: string;
  mod_id: string;
  version: string;
  state: VersionState;
  size_bytes: number;
  sha256: string;
  release_notes: string;
  dependencies: Dependency[];
  scan_report_id: string;
  scan_report?: ScanReport;
  created_at: string;
}

export interface Mod {
  id: string;
  title: string;
  summary: string;
  description: string;
  author: Author;
  category: Category;
  tags: string[];
  supported_platforms: Platform[];
  mas_version_range: string;
  recommended_priority: number;
  latest_version_id: string;
  latest_version: string;
  size_bytes: number;
  downloads_count: number;
  updated_at: string;
  versions: ModVersion[];
  cover_gradient?: string;
}

export type PermissionState = 'granted' | 'revoked' | 'unverified';

export interface Installation {
  id: string;
  label: string;
  platform: Platform;
  path_hint: string;
  saf_tree_uri: string;
  permission_state: PermissionState;
  mas_version: string;
  is_running: boolean;
  free_space_bytes: number;
  installed_mods_count: number;
  last_verified_at: string;
}

export interface PlanChange {
  target_path: string;
  action: 'write' | 'backup' | 'replace' | 'delete';
  previous_owner?: string;
  next_owner: string;
  previous_hash?: string;
  next_hash: string;
  reason: string;
}

export interface Plan {
  plan_id: string;
  kind: 'install' | 'update' | 'uninstall' | 'priority_change';
  installation_id: string;
  mod_id: string;
  version_id: string;
  expires_at: string;
  dependency_blockers: string[];
  semantic_blockers: string[];
  changes: PlanChange[];
  backups_required: number;
  bytes_required: number;
  warnings: string[];
  target_priority?: number;
}

export type OperationStage =
  | 'planned'
  | 'downloading'
  | 'scanning'
  | 'backed_up'
  | 'writing'
  | 'committed';

export type OperationStatus =
  | 'in_progress'
  | 'completed'
  | 'blocked'
  | 'recoverable'
  | 'rolling_back'
  | 'rolled_back';

export interface OperationDriftDetail {
  file_path: string;
  expected_hash: string;
  actual_hash: string;
  detected_at: string;
}

export interface Operation {
  operation_id: string;
  installation_id: string;
  plan_id: string;
  mod_title: string;
  mod_id: string;
  version: string;
  kind: 'install' | 'update' | 'uninstall' | 'priority';
  stage: OperationStage;
  status: OperationStatus;
  progress_percent: number;
  current_file?: string;
  failure_reason?: string;
  drift_detail?: OperationDriftDetail;
  started_at: string;
  updated_at: string;
  log_lines?: string[];
}

export interface InstalledMod {
  mod_id: string;
  title: string;
  author_name: string;
  category: Category;
  current_version: string;
  latest_available_version?: string;
  has_update: boolean;
  priority: number;
  managed: boolean;
  installed_at: string;
  file_count: number;
  unmanaged_detected_files?: string[];
}
