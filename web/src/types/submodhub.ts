/**
 * RezeHub 前端功能与接口契约 TypeScript 类型定义
 * 依据: docs/aegis/specs/2026-09-25-submodhub-design.md
 */

export type UserRole = 'user' | 'author' | 'reviewer' | 'admin';

export interface User {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
  roles: UserRole[];
}

export type ModCategory = 'submod' | 'spritepack';

export type ModSourceType = 'local' | 'github_releases';

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
  author_display_name?: string;
  category: ModCategory;
  tags: string[];
  supported_platforms: Platform[];
  mas_version_range: string; // e.g. ">=0.12.14"
  recommended_priority: number;
  latest_version_id: string;
  downloads_count: number;
  client_reported_downloads?: number;
  download_attempts?: number;
  updated_at: string;
  created_at: string;
  thumbnail?: string;
  detail_images?: string[];
  is_published: boolean;
  source_type?: ModSourceType;
  github_owner?: string;
  github_repo?: string;
  github_asset_regex?: string;
  github_source_code?: boolean;
  github_manifest?: boolean;
  github_manifest_digest?: string;
  github_last_sync_at?: string;
  github_last_sync_error?: string;
  github_last_release_id?: number;
  github_backoff_until?: string;
  // Author workspace state derived from every version of the mod, so upload and
  // delete affordances never depend on the versions visible on the current page.
  // `has_published_version` and `has_archived_version` are independent facts: a
  // mod can serve one version while an older one is retired.
  has_published_version?: boolean;
  has_archived_version?: boolean;
  has_pending_review?: boolean;
  candidate_version_id?: string;
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
  linked_mod_ids?: string[];
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
  sprite_sets?: Array<{ id: string; name: string; items: Array<{ display_name: string; preview_source?: string }> }>;
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

export interface DownloadDescriptor {
  url: string;
  expires_at: string;
  sha256: string;
  size_bytes: number;
  filename: string;
}
