import type { FileKind, ScanReport } from '../types/submodhub';

export interface ServerScanReport {
  files?: { source: string; target: string; size: number; sha256: string; class: string }[];
  unsupported?: string[];
  warnings?: string[];
  submods?: { source?: string; author?: string; name?: string; version?: string; unknown?: boolean; Source?: string; Author?: string; Name?: string; Version?: string; Unknown?: boolean }[];
  sprites?: { source?: string; identity?: string; giftName?: string; giftGroup?: string; unknown?: boolean; Source?: string; Identity?: string; GiftName?: string; GiftGroup?: string; Unknown?: boolean }[];
  sprite_sets?: Array<{ id: string; name: string; items: Array<{ display_name: string; preview_source?: string }> }>;
  derived?: { source?: string; target?: string; Source?: string; Target?: string }[];
  conflicts?: { kind?: string; value?: string; first?: string; second?: string; Kind?: string; Value?: string; First?: string; Second?: string }[];
}

export function mapServerScanReport(versionId: string, source: ServerScanReport): ScanReport {
  const files = source.files || [];
  const conflicts = source.conflicts || [];
  const kind = (value: string): FileKind => {
    if (value === 'sprite_json') return 'sprite';
    if (value === 'python_package') return 'script';
    return ['script', 'sprite', 'audio', 'font', 'text', 'binary'].includes(value) ? value as FileKind : 'unknown';
  };
  return {
    id: `scan_${versionId}`, version_id: versionId,
    status: 'ready',
    files: files.map((file) => ({
      source_path: file.source, target_path: file.target, size_bytes: file.size, sha256: file.sha256, kind: kind(file.class),
      warnings: kind(file.class) === 'binary' ? ['检测到二进制文件；仅提示，未自动阻断'] : [],
    })),
    unsupported_paths: source.unsupported || [],
    registrations: (source.submods || []).map((item) => {
      const sourcePath = item.source || item.Source || '';
      const name = item.name || item.Name || '';
      return { submod_id: name || sourcePath, source_path: sourcePath, name: name || sourcePath, version: item.version || item.Version || '', author: item.author || item.Author || '', confidence: (item.unknown ?? item.Unknown) ? 'unknown' : 'known' };
    }),
    sprite_identities: (source.sprites || []).map((item) => ({ category: item.giftGroup || item.GiftGroup || '', name: item.identity || item.Identity || item.source || item.Source || '', giftname: item.giftName || item.GiftName || '', poses: [] })),
    sprite_sets: source.sprite_sets || [],
    derived_gifts: (source.derived || []).map((item) => item.target || item.Target || ''),
    blockers: conflicts.map((item) => `${item.kind || item.Kind || '冲突'}: ${item.value || item.Value || ''} (${item.first || item.First || ''}, ${item.second || item.Second || ''})`),
    warnings: source.warnings || [],
    resource_stats: {
      total_files: files.length, scripts_count: files.filter((file) => kind(file.class) === 'script').length,
      sprites_count: files.filter((file) => kind(file.class) === 'sprite').length,
      audio_count: files.filter((file) => kind(file.class) === 'audio').length,
      total_size_bytes: files.reduce((sum, file) => sum + file.size, 0),
      binary_flag: files.some((file) => kind(file.class) === 'binary'),
    },
    scanned_at: new Date().toISOString(),
  };
}
