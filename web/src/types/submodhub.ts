/**
 * SubmodHub 前端功能与接口契约 TypeScript 类型定义
 * 依据: docs/aegis/specs/2026-09-25-submodhub-design.md
 */

export type UserRole = 'user' | 'author' | 'reviewer' | 'admin';

export interface User {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  roles: UserRole[];
  linked_accounts: {
    flarum?: string;
    github?: string;
  };
}

export type ModCategory = 'submod' | 'spritepack';

export type Platform = 'windows' | 'android' | 'linux' | 'macos';

export interface ModSummary {
  id: string; // e.g. "mod_extra_everything"
  title: string;
  summary: string;
  description: string;
  author: {
    id: string;
    display_name: string;
    avatar?: string;
  };
  category: ModCategory;
  tags: string[];
  supported_platforms: Platform[];
  mas_version_range: string; // e.g. ">=0.12.14"
  recommended_priority: number;
  latest_version_id: string;
  downloads_count: number;
  updated_at: string;
  created_at: string;
  thumbnail?: string;
  is_published: boolean;
}

export type VersionState =
  | 'draft'
  | 'uploaded'
  | 'scanning'
  | 'ready_for_review'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'unpublished';

export interface ModDependency {
  mod_id: string;
  mod_title?: string;
  linked_mod_id?: string;
  version_range: string;
  required: boolean;
}

export interface ModVersion {
  id: string; // e.g. "ver_101"
  mod_id: string;
  version: string; // e.g. "1.2.0"
  state: VersionState;
  size_bytes: number;
  sha256: string; // 64 hex characters
  release_notes: string;
  dependencies: ModDependency[];
  scan_report_id?: string;
  created_at: string;
  published_at?: string;
  unpublish_reason?: string;
  deprecated?: boolean;
  deprecation_reason?: string;
  is_immutable?: boolean;
}

export type ScanStatus = 'pending' | 'running' | 'ready' | 'failed';

export type FileKind =
  | 'script' // .rpy, .rpyc
  | 'sprite' // .png, .webp
  | 'audio' // .ogg, .mp3
  | 'font' // .ttf, .otf
  | 'text' // .txt, .json
  | 'binary' // .dll, .so, .exe
  | 'unknown';

export interface ScannedFile {
  source_path: string;
  target_path: string;
  size_bytes: number;
  sha256: string;
  kind: FileKind;
  warnings?: string[];
}

export interface SubmodRegistration {
  submod_id: string;
  source_path?: string;
  name: string;
  version: string;
  author: string;
  confidence: 'known' | 'unknown'; // Unknown static parsing results must NOT be shown as safe!
}

export interface SpriteIdentity {
  category: string;
  name: string;
  giftname: string;
  poses: string[];
  has_conflict?: boolean;
  conflict_with?: string;
}

export interface ScanReport {
  id: string;
  version_id: string;
  status: ScanStatus;
  files: ScannedFile[];
  unsupported_paths: string[];
  registrations: SubmodRegistration[];
  sprite_identities: SpriteIdentity[];
  derived_gifts: string[];
  blockers: string[];
  warnings: string[];
  resource_stats: {
    total_files: number;
    scripts_count: number;
    sprites_count: number;
    audio_count: number;
    total_size_bytes: number;
    binary_flag: boolean;
  };
  scanned_at: string;
}

export interface Submission {
  id: string;
  mod_id: string;
  version_id: string;
  scan_report_id?: string;
  mod_title: string;
  version_str: string;
  category: ModCategory;
  author_id: string;
  author_name: string;
  submitted_at: string;
  state: 'ready_for_review' | 'under_review' | 'approved' | 'rejected' | 'published';
  mark_latest?: boolean;
  reviewer_id?: string;
  reviewer_name?: string;
  decision_reason?: string;
  decided_at?: string;
  published_at?: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  actor_id: string;
  actor_name: string;
  actor_role: string;
  action:
    | 'submission_approve'
    | 'submission_reject'
    | 'version_publish'
    | 'version_unpublish'
    | 'role_grant'
    | 'role_revoke';
  target_type: 'submission' | 'version' | 'user';
  target_id: string;
  target_label: string;
  reason: string;
  details?: Record<string, unknown>;
}

export interface DownloadDescriptor {
  url: string;
  expires_at: string;
  sha256: string;
  size_bytes: number;
  filename: string;
}

// 客户端 Go 绑定相关类型 (Section 4)
export interface Installation {
  id: string;
  label: string;
  platform: Platform;
  path_hint: string;
  permission_state: 'granted' | 'revoked' | 'needs_reauth' | 'invalid_root';
  mas_version: string;
  is_running?: boolean;
}

export interface PlanChange {
  target_path: string;
  action: 'create' | 'overwrite' | 'delete' | 'backup';
  previous_owner?: string;
  next_owner?: string;
  previous_hash?: string;
  next_hash?: string;
  reason: string;
}

export interface InstallationPlan {
  plan_id: string;
  kind: 'install' | 'update' | 'uninstall' | 'priority_reorder';
  installation_id: string;
  mod_id: string;
  version_id: string;
  expires_at: string;
  dependency_blockers: string[];
  semantic_blockers: string[];
  changes: PlanChange[];
  backups_required: string[];
  bytes_required: number;
  warnings: string[];
  is_ready_to_apply: boolean;
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
  | 'rolled_back';

export interface OperationLog {
  operation_id: string;
  installation_id: string;
  mod_title: string;
  version: string;
  state: OperationState;
  progress_percent: number;
  current_file?: string;
  error_code?: string;
  error_message?: string;
  external_change_details?: {
    path: string;
    expected_hash: string;
    actual_hash: string;
  };
  created_at: string;
  updated_at: string;
}

export interface InstalledMod {
  id: string;
  mod_id: string;
  title: string;
  version: string;
  category: ModCategory;
  is_managed: boolean; // Managed vs Unmanaged detected
  priority: number;
  installed_at: string;
  has_update?: boolean;
  update_version?: string;
}

// 契约错误码定义 (Section 5)
export type ContractErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'validation_failed'
  | 'invalid_archive'
  | 'unsupported_path'
  | 'scan_limit_exceeded'
  | 'invalid_transition'
  | 'idempotency_conflict'
  | 'dependency_missing'
  | 'version_incompatible'
  | 'semantic_conflict'
  | 'permission_lost'
  | 'invalid_mas_root'
  | 'game_running'
  | 'insufficient_space'
  | 'external_change'
  | 'operation_recoverable'
  | 'backup_missing'
  | 'offline'
  | 'download_hash_mismatch';

export interface ErrorDisplayConfig {
  code: ContractErrorCode;
  title: string;
  description: string;
  category: 'auth' | 'upload_scan' | 'lifecycle' | 'client_guard' | 'recovery';
  frontend_action: string;
  sample_details?: Record<string, string | number | boolean | string[]>;
}
