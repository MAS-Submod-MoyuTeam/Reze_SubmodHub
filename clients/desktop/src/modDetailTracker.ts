import type { CatalogVersion, SpriteSet } from '../../../ui/catalog-api';
import type { ModSummary } from './types/client';

export type LoadReason = 'initial' | 'retry' | 'conflict';

export interface ModDetailToken {
  modId: string;
  generation: number;
}

export interface ModDetailTracker {
  setMod: (modId: string | null) => void;
  getModId: () => string | null;
  getGeneration: () => number;
  beginLoad: (expectedModId?: string) => ModDetailToken | null;
  isValid: (token: ModDetailToken | null | undefined) => boolean;
  invalidate: () => void;
}

export function createModDetailTracker(initialModId: string | null = null): ModDetailTracker {
  let activeModId: string | null = initialModId;
  let generation = 0;

  return {
    setMod(modId: string | null) {
      if (activeModId !== modId) {
        activeModId = modId;
        generation++;
      }
    },
    getModId() {
      return activeModId;
    },
    getGeneration() {
      return generation;
    },
    beginLoad(expectedModId?: string) {
      if (expectedModId && expectedModId !== activeModId) {
        return null;
      }
      generation++;
      return {
        modId: activeModId ?? '',
        generation,
      };
    },
    isValid(token: ModDetailToken | null | undefined) {
      if (!token) return false;
      return token.modId === activeModId && token.generation === generation;
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
 * Unified detail loading execution engine with request generation and mod identity guards.
 * All state mutations (start, success, error, finally) are strictly guarded against stale responses.
 */
export async function executeDetailLoad(
  tracker: ModDetailTracker,
  targetMod: ModSummary,
  reason: LoadReason,
  fetchers: ModDetailFetchers,
  handlers: ModDetailLoadHandlers
): Promise<boolean> {
  const token = tracker.beginLoad(targetMod.id);
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
