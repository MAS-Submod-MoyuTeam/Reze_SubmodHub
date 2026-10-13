import type { CatalogVersion, SpriteSet } from '../../../ui/catalog-api';
import type { ModSummary } from './types/client';

export type LoadReason = 'initial' | 'retry' | 'conflict';

export interface ModDetailToken {
  instanceId: string;
  modId: string;
  generation: number;
}

export interface ModDetailTracker {
  setContext: (instanceId: string | null, modId: string | null) => void;
  setMod: (modId: string | null) => void;
  setInstanceId: (instanceId: string | null) => void;
  getInstanceId: () => string | null;
  getModId: () => string | null;
  getGeneration: () => number;
  beginLoad: (expectedModId?: string, expectedInstanceId?: string) => ModDetailToken | null;
  isValid: (token: ModDetailToken | null | undefined) => boolean;
  invalidate: () => void;
}

export function createModDetailTracker(
  initialModId: string | null = null,
  initialInstanceId: string | null = null
): ModDetailTracker {
  let activeModId: string | null = initialModId;
  let activeInstanceId: string | null = initialInstanceId;
  let generation = 0;

  return {
    setContext(instanceId: string | null, modId: string | null) {
      if (activeInstanceId !== instanceId || activeModId !== modId) {
        activeInstanceId = instanceId;
        activeModId = modId;
        generation++;
      }
    },
    setMod(modId: string | null) {
      if (activeModId !== modId) {
        activeModId = modId;
        generation++;
      }
    },
    setInstanceId(instanceId: string | null) {
      if (activeInstanceId !== instanceId) {
        activeInstanceId = instanceId;
        generation++;
      }
    },
    getInstanceId() {
      return activeInstanceId;
    },
    getModId() {
      return activeModId;
    },
    getGeneration() {
      return generation;
    },
    beginLoad(expectedModId?: string, expectedInstanceId?: string) {
      if (expectedModId && expectedModId !== activeModId) {
        return null;
      }
      if (expectedInstanceId !== undefined && expectedInstanceId !== activeInstanceId) {
        return null;
      }
      generation++;
      return {
        instanceId: activeInstanceId ?? '',
        modId: activeModId ?? '',
        generation,
      };
    },
    isValid(token: ModDetailToken | null | undefined) {
      if (!token) return false;
      return (
        token.instanceId === (activeInstanceId ?? '') &&
        token.modId === (activeModId ?? '') &&
        token.generation === generation
      );
    },
    invalidate() {
      generation++;
    },
  };
}

export interface SpriteManifestLike {
  sets: SpriteSet[];
  version_id?: string;
}

export interface ModDetailFetchers {
  fetchSpriteManifest: (modId: string) => Promise<SpriteManifestLike>;
  fetchModVersion: (modId: string, versionId: string) => Promise<CatalogVersion | null>;
  fetchPublishedVersions: (modId: string) => Promise<CatalogVersion[]>;
  fetchModImages: (modId: string) => Promise<string[]>;
}

export interface ModDetailLoadHandlers {
  onStart: (reason: LoadReason, targetMod: ModSummary) => void;
  onSpritepackSuccess: (
    manifest: SpriteManifestLike,
    version: CatalogVersion | null,
    reason: LoadReason
  ) => void;
  onSubmodSuccess: (versions: CatalogVersion[], images: string[]) => void;
  onError: (errorMsg: string, reason: LoadReason) => void;
  onFinally: () => void;
}

/**
 * Unified detail loading execution engine with request generation and mod/instance identity guards.
 * All state mutations (start, success, error, finally) are strictly guarded against stale responses.
 */
export async function executeDetailLoad(
  tracker: ModDetailTracker,
  targetMod: ModSummary,
  reason: LoadReason,
  fetchers: ModDetailFetchers,
  handlers: ModDetailLoadHandlers,
  targetInstanceId?: string
): Promise<boolean> {
  const token = tracker.beginLoad(targetMod.id, targetInstanceId);
  if (!token) {
    return false;
  }

  handlers.onStart(reason, targetMod);

  try {
    if (targetMod.category === 'spritepack') {
      const manifest = await fetchers.fetchSpriteManifest(targetMod.id);
      const versionId = manifest.version_id || targetMod.latest_version_id;
      let ver: CatalogVersion | null = null;
      if (versionId) {
        ver = await fetchers.fetchModVersion(targetMod.id, versionId);
      }

      if (!tracker.isValid(token)) {
        return false;
      }

      handlers.onSpritepackSuccess(manifest, ver, reason);
      return true;
    } else {
      const [items, pics] = await Promise.all([
        fetchers.fetchPublishedVersions(targetMod.id),
        fetchers.fetchModImages(targetMod.id),
      ]);

      if (!tracker.isValid(token)) {
        return false;
      }

      handlers.onSubmodSuccess(
        items.filter((item) => item.state === 'published'),
        pics
      );
      return true;
    }
  } catch (cause) {
    if (!tracker.isValid(token)) {
      return false;
    }

    const msg = cause instanceof Error ? cause.message : String(cause);
    handlers.onError(msg, reason);
    return false;
  } finally {
    if (tracker.isValid(token)) {
      handlers.onFinally();
    }
  }
}
