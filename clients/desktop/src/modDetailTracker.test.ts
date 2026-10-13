import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createModDetailTracker,
  executeDetailLoad,
  type ModDetailFetchers,
  type ModDetailLoadHandlers,
  type SpriteManifestLike,
} from './modDetailTracker';
import type { CatalogVersion } from '../../../ui/catalog-api';
import type { ModSummary } from './types/client';

function makeMockMod(id: string, category: 'spritepack' | 'submod' = 'spritepack'): ModSummary {
  return {
    id,
    title: `Mod ${id}`,
    category,
    summary: `Summary of ${id}`,
    description: `Description of ${id}`,
    author: { id: 'author_1', display_name: 'Author' },
    tags: [],
    supported_platforms: ['windows', 'android'],
    mas_version_range: '>=0.12.0',
    recommended_priority: 100,
    latest_version: '1.0.0',
    latest_version_id: `v_${id}_1`,
    size_bytes: 1000,
    sha256: 'a'.repeat(64),
    downloads_count: 0,
    updated_at: '2026-01-01T00:00:00Z',
  };
}

test('createModDetailTracker: isolates mod identities, increments generation, and invalidates stale tokens', () => {
  const tracker = createModDetailTracker('mod_a');
  assert.equal(tracker.getModId(), 'mod_a');
  assert.equal(tracker.getGeneration(), 0);

  // Initial load token for mod_a
  const tokenA1 = tracker.beginLoad('mod_a');
  assert.ok(tokenA1);
  assert.equal(tokenA1.modId, 'mod_a');
  assert.equal(tokenA1.generation, 1);
  assert.equal(tracker.isValid(tokenA1), true);

  // beginLoad with wrong expectedModId returns null
  assert.equal(tracker.beginLoad('mod_b'), null);

  // New retry token for mod_a invalidates previous token
  const tokenA2 = tracker.beginLoad('mod_a');
  assert.ok(tokenA2);
  assert.equal(tokenA2.generation, 2);
  assert.equal(tracker.isValid(tokenA1), false, 'tokenA1 should be superseded by tokenA2');
  assert.equal(tracker.isValid(tokenA2), true);

  // Switching mod updates activeModId and increments generation
  tracker.setMod('mod_b');
  assert.equal(tracker.getModId(), 'mod_b');
  assert.equal(tracker.isValid(tokenA2), false, 'tokenA2 should be invalid after switching to mod_b');

  // Load for mod_b
  const tokenB1 = tracker.beginLoad('mod_b');
  assert.ok(tokenB1);
  assert.equal(tokenB1.modId, 'mod_b');
  assert.equal(tracker.isValid(tokenB1), true);

  // Invalidate on unmount cancels tokenB1
  tracker.invalidate();
  assert.equal(tracker.isValid(tokenB1), false);
});

test('reproduction: stale retry response from Mod A does not write to Mod B, change selection, or stop loading', async () => {
  const tracker = createModDetailTracker('mod_a');
  const modA = makeMockMod('mod_a', 'spritepack');
  const modB = makeMockMod('mod_b', 'spritepack');

  // Track state as ModDetailModal would
  let currentMod: ModSummary = modA;
  let loading = false;
  let manifestError = '';
  let spriteSets: any[] = [];
  let selectedSets: string[] = [];
  let manifestVersion: CatalogVersion | null = null;

  const createHandlers = (): ModDetailLoadHandlers => ({
    onStart: (reason, targetMod) => {
      loading = true;
      manifestError = '';
      if (reason === 'initial') {
        spriteSets = [];
        selectedSets = [];
        manifestVersion = null;
      }
    },
    onSpritepackSuccess: (manifest, ver) => {
      spriteSets = manifest.sets;
      selectedSets = manifest.sets.map((s) => s.id);
      manifestVersion = ver;
    },
    onSubmodSuccess: () => {},
    onError: (msg) => {
      manifestError = msg;
    },
    onFinally: () => {
      loading = false;
    },
  });

  // Step 1: Mod A initial load failed
  manifestError = 'network error';
  loading = false;

  // Step 2: User clicks retry on Mod A (slow network response)
  let resolveModA!: (manifest: SpriteManifestLike) => void;
  const modAPromise = new Promise<SpriteManifestLike>((res) => {
    resolveModA = res;
  });

  const fetchersA: ModDetailFetchers = {
    fetchSpriteManifest: async () => modAPromise,
    fetchModVersion: async () => ({
      id: 'v_a_1',
      mod_id: 'mod_a',
      version: '1.0.0',
      size_bytes: 1000,
      sha256: 'a'.repeat(64),
      state: 'published',
    }),
    fetchPublishedVersions: async () => [],
    fetchModImages: async () => [],
  };

  const retryPromiseA = executeDetailLoad(tracker, modA, 'retry', fetchersA, createHandlers());

  // At this point, Mod A is loading
  assert.equal(loading, true);
  assert.equal(manifestError, '');

  // Step 3: Before Mod A returns, user switches to Mod B
  tracker.setMod('mod_b');
  currentMod = modB;

  let resolveModB!: (manifest: SpriteManifestLike) => void;
  const modBPromise = new Promise<SpriteManifestLike>((res) => {
    resolveModB = res;
  });

  const fetchersB: ModDetailFetchers = {
    fetchSpriteManifest: async () => modBPromise,
    fetchModVersion: async () => ({
      id: 'v_b_1',
      mod_id: 'mod_b',
      version: '1.0.0',
      size_bytes: 2000,
      sha256: 'b'.repeat(64),
      state: 'published',
    }),
    fetchPublishedVersions: async () => [],
    fetchModImages: async () => [],
  };

  const loadPromiseB = executeDetailLoad(tracker, modB, 'initial', fetchersB, createHandlers());

  // Mod B is now loading with fresh/empty sets
  assert.equal(loading, true);
  assert.equal(spriteSets.length, 0);
  assert.equal(selectedSets.length, 0);

  // Step 4: Mod A's delayed retry response finally returns!
  resolveModA({
    version_id: 'v_a_1',
    sets: [{ id: 'set_a_outfit', name: 'Outfit A', items: [] }],
  });

  const resultA = await retryPromiseA;
  assert.equal(resultA, false, 'Delayed Mod A retry should return false (aborted)');

  // CRITICAL CHECK: Mod A's delayed response MUST NOT overwrite Mod B!
  assert.equal(loading, true, 'Mod B must still be loading, not stopped by Mod A finally');
  assert.equal(spriteSets.length, 0, 'Mod B spriteSets must not contain Mod A sets');
  assert.equal(selectedSets.length, 0, 'Mod B selectedSets must not contain Mod A selection');
  assert.equal(manifestVersion, null, 'Mod B manifestVersion must not be set to Mod A version');

  // Step 5: Mod B's response arrives
  resolveModB({
    version_id: 'v_b_1',
    sets: [{ id: 'set_b_dress', name: 'Dress B', items: [] }],
  });

  const resultB = await loadPromiseB;
  assert.equal(resultB, true, 'Mod B initial load should succeed');
  assert.equal(loading, false);
  assert.equal(spriteSets.length, 1);
  assert.equal(spriteSets[0].id, 'set_b_dress');
  assert.deepEqual(selectedSets, ['set_b_dress']);
  assert.equal((manifestVersion as CatalogVersion | null)?.id, 'v_b_1');
});

test('reproduction: stale retry error from Mod A does not write error to Mod B or stop loading', async () => {
  const tracker = createModDetailTracker('mod_a');
  const modA = makeMockMod('mod_a', 'spritepack');
  const modB = makeMockMod('mod_b', 'spritepack');

  let loading = false;
  let manifestError = '';

  const handlers: ModDetailLoadHandlers = {
    onStart: () => {
      loading = true;
      manifestError = '';
    },
    onSpritepackSuccess: () => {},
    onSubmodSuccess: () => {},
    onError: (msg) => {
      manifestError = msg;
    },
    onFinally: () => {
      loading = false;
    },
  };

  let rejectModA!: (err: Error) => void;
  const modAPromise = new Promise<SpriteManifestLike>((_, rej) => {
    rejectModA = rej;
  });

  const fetchersA: ModDetailFetchers = {
    fetchSpriteManifest: async () => modAPromise,
    fetchModVersion: async () => null,
    fetchPublishedVersions: async () => [],
    fetchModImages: async () => [],
  };

  const retryPromiseA = executeDetailLoad(tracker, modA, 'retry', fetchersA, handlers);
  assert.equal(loading, true);

  // Switch to Mod B
  tracker.setMod('mod_b');

  // Mod A delayed retry fails
  rejectModA(new Error('Mod A server crash'));
  const resultA = await retryPromiseA;

  assert.equal(resultA, false);
  assert.equal(manifestError, '', 'Mod A error must not leak into Mod B');
});

test('version conflict reload: stale conflict reload for Mod A does not overwrite Mod B', async () => {
  const tracker = createModDetailTracker('mod_a');
  const modA = makeMockMod('mod_a', 'spritepack');
  const modB = makeMockMod('mod_b', 'spritepack');

  let loading = false;
  let manifestError = '';
  let downloadError = '';
  let spriteSets: any[] = [{ id: 'set_a_old' }];
  let selectedSets: string[] = ['set_a_old'];

  const handlers: ModDetailLoadHandlers = {
    onStart: (reason) => {
      loading = true;
      manifestError = '';
      if (reason === 'conflict') {
        downloadError = '精灵包版本已更新，正在重新加载最新清单…';
      }
    },
    onSpritepackSuccess: (manifest, _, reason) => {
      spriteSets = manifest.sets;
      if (reason === 'conflict') {
        selectedSets = [];
        downloadError = '精灵包版本已更新，已刷新至最新版本，请重新选择套装。';
      }
    },
    onSubmodSuccess: () => {},
    onError: (msg, reason) => {
      if (reason === 'conflict') {
        manifestError = `重新加载清单失败：${msg}`;
        downloadError = '';
      } else {
        manifestError = msg;
      }
    },
    onFinally: () => {
      loading = false;
    },
  };

  let resolveConflictA!: (manifest: SpriteManifestLike) => void;
  const conflictPromise = new Promise<SpriteManifestLike>((res) => {
    resolveConflictA = res;
  });

  const fetchersA: ModDetailFetchers = {
    fetchSpriteManifest: async () => conflictPromise,
    fetchModVersion: async () => null,
    fetchPublishedVersions: async () => [],
    fetchModImages: async () => [],
  };

  const reloadA = executeDetailLoad(tracker, modA, 'conflict', fetchersA, handlers);
  assert.equal(loading, true);
  assert.equal(downloadError, '精灵包版本已更新，正在重新加载最新清单…');

  // Switch to Mod B while conflict reload for A is running
  tracker.setMod('mod_b');
  downloadError = ''; // Mod B starts clean

  // Delayed Mod A conflict reload finishes with v2
  resolveConflictA({
    version_id: 'v_a_2',
    sets: [{ id: 'set_a_v2', name: 'V2 Set', items: [] }],
  });

  const resultA = await reloadA;
  assert.equal(resultA, false, 'Stale conflict reload should be rejected');
  assert.equal(downloadError, '', 'Mod A conflict notice must not appear on Mod B');
});

test('version conflict reload on same mod: updates manifest, clears selectedSets, and notifies user', async () => {
  const tracker = createModDetailTracker('mod_a');
  const modA = makeMockMod('mod_a', 'spritepack');

  let loading = false;
  let manifestError = '';
  let downloadError = '';
  let spriteSets: any[] = [{ id: 'set_old' }];
  let selectedSets: string[] = ['set_old'];
  let manifestVersion: CatalogVersion | null = null;

  const handlers: ModDetailLoadHandlers = {
    onStart: (reason) => {
      loading = true;
      manifestError = '';
      if (reason === 'conflict') {
        downloadError = '精灵包版本已更新，正在重新加载最新清单…';
      }
    },
    onSpritepackSuccess: (manifest, ver, reason) => {
      spriteSets = manifest.sets;
      if (reason === 'conflict') {
        selectedSets = [];
        downloadError = '精灵包版本已更新，已刷新至最新版本，请重新选择套装。';
      } else {
        selectedSets = manifest.sets.map((s) => s.id);
      }
      manifestVersion = ver;
    },
    onSubmodSuccess: () => {},
    onError: (msg, reason) => {
      if (reason === 'conflict') {
        manifestError = `重新加载清单失败：${msg}`;
        downloadError = '';
      } else {
        manifestError = msg;
      }
    },
    onFinally: () => {
      loading = false;
    },
  };

  const fetchers: ModDetailFetchers = {
    fetchSpriteManifest: async () => ({
      version_id: 'v_a_new',
      sets: [{ id: 'set_new_1', name: 'New 1', items: [] }],
    }),
    fetchModVersion: async () => ({
      id: 'v_a_new',
      mod_id: 'mod_a',
      version: '2.0.0',
      size_bytes: 3000,
      sha256: 'c'.repeat(64),
      state: 'published',
    }),
    fetchPublishedVersions: async () => [],
    fetchModImages: async () => [],
  };

  const result = await executeDetailLoad(tracker, modA, 'conflict', fetchers, handlers);
  assert.equal(result, true);
  assert.equal(loading, false);
  assert.equal(spriteSets.length, 1);
  assert.equal(spriteSets[0].id, 'set_new_1');
  assert.deepEqual(selectedSets, [], 'Conflict reload must reset selectedSets to empty');
  assert.equal(downloadError, '精灵包版本已更新，已刷新至最新版本，请重新选择套装。');
  assert.equal((manifestVersion as CatalogVersion | null)?.id, 'v_a_new');
  assert.equal(manifestError, '');
});

test('concurrent retries on same mod: earlier slow retry is ignored when second retry succeeds', async () => {
  const tracker = createModDetailTracker('mod_a');
  const modA = makeMockMod('mod_a', 'spritepack');

  let appliedVersion = '';

  const handlers = (tag: string): ModDetailLoadHandlers => ({
    onStart: () => {},
    onSpritepackSuccess: (manifest) => {
      appliedVersion = `${tag}:${manifest.version_id}`;
    },
    onSubmodSuccess: () => {},
    onError: () => {},
    onFinally: () => {},
  });

  let resolveRetry1!: (manifest: SpriteManifestLike) => void;
  const promise1 = new Promise<SpriteManifestLike>((res) => {
    resolveRetry1 = res;
  });

  const fetchers1: ModDetailFetchers = {
    fetchSpriteManifest: async () => promise1,
    fetchModVersion: async () => null,
    fetchPublishedVersions: async () => [],
    fetchModImages: async () => [],
  };

  const run1 = executeDetailLoad(tracker, modA, 'retry', fetchers1, handlers('retry1'));

  // User clicks retry again quickly
  const fetchers2: ModDetailFetchers = {
    fetchSpriteManifest: async () => ({ version_id: 'v_fast', sets: [] }),
    fetchModVersion: async () => null,
    fetchPublishedVersions: async () => [],
    fetchModImages: async () => [],
  };

  const run2 = executeDetailLoad(tracker, modA, 'retry', fetchers2, handlers('retry2'));

  const result2 = await run2;
  assert.equal(result2, true);
  assert.equal(appliedVersion, 'retry2:v_fast');

  // Now slow retry 1 resolves
  resolveRetry1({ version_id: 'v_slow', sets: [] });
  const result1 = await run1;
  assert.equal(result1, false);
  assert.equal(appliedVersion, 'retry2:v_fast', 'Retry 1 must not overwrite Retry 2');
});

test('submod loading: respects tracker and rejects stale response across mod switch', async () => {
  const tracker = createModDetailTracker('submod_a');
  const submodA = makeMockMod('submod_a', 'submod');
  const submodB = makeMockMod('submod_b', 'submod');

  let activeVersions: CatalogVersion[] = [];

  const handlers: ModDetailLoadHandlers = {
    onStart: () => {},
    onSpritepackSuccess: () => {},
    onSubmodSuccess: (versions) => {
      activeVersions = versions;
    },
    onError: () => {},
    onFinally: () => {},
  };

  let resolveSubmodA!: (versions: CatalogVersion[]) => void;
  const promiseA = new Promise<CatalogVersion[]>((res) => {
    resolveSubmodA = res;
  });

  const fetchersA: ModDetailFetchers = {
    fetchSpriteManifest: async () => ({ sets: [] }),
    fetchModVersion: async () => null,
    fetchPublishedVersions: async () => promiseA,
    fetchModImages: async () => [],
  };

  const runA = executeDetailLoad(tracker, submodA, 'initial', fetchersA, handlers);

  // Switch to Submod B
  tracker.setMod('submod_b');

  const fetchersB: ModDetailFetchers = {
    fetchSpriteManifest: async () => ({ sets: [] }),
    fetchModVersion: async () => null,
    fetchPublishedVersions: async () => [
      { id: 'v_b', mod_id: 'submod_b', version: '2.0.0', size_bytes: 10, sha256: 'b'.repeat(64), state: 'published' },
    ],
    fetchModImages: async () => [],
  };

  const runB = executeDetailLoad(tracker, submodB, 'initial', fetchersB, handlers);
  await runB;
  assert.equal(activeVersions.length, 1);
  assert.equal(activeVersions[0].id, 'v_b');

  // Delayed Submod A arrives
  resolveSubmodA([
    { id: 'v_a', mod_id: 'submod_a', version: '1.0.0', size_bytes: 10, sha256: 'a'.repeat(64), state: 'published' },
  ]);
  const resultA = await runA;
  assert.equal(resultA, false);
  assert.equal(activeVersions[0].id, 'v_b', 'Submod A must not overwrite Submod B');
});

test('instance isolation: delayed response from Instance 1 for Mod A does not write to Instance 2 for Mod A', async () => {
  const tracker = createModDetailTracker('mod_shared', 'inst_1');
  const modShared = makeMockMod('mod_shared', 'spritepack');

  let activeInstanceId = 'inst_1';
  let activeSets: any[] = [];
  let loading = false;
  let error = '';

  const handlers: ModDetailLoadHandlers = {
    onStart: () => {
      loading = true;
      error = '';
    },
    onSpritepackSuccess: (manifest) => {
      activeSets = manifest.sets;
    },
    onSubmodSuccess: () => {},
    onError: (msg) => {
      error = msg;
    },
    onFinally: () => {
      loading = false;
    },
  };

  let resolveInst1!: (manifest: SpriteManifestLike) => void;
  const promiseInst1 = new Promise<SpriteManifestLike>((res) => {
    resolveInst1 = res;
  });

  const fetchersInst1: ModDetailFetchers = {
    fetchSpriteManifest: async () => promiseInst1,
    fetchModVersion: async () => null,
    fetchPublishedVersions: async () => [],
    fetchModImages: async () => [],
  };

  // Start load for mod_shared on inst_1
  const runInst1 = executeDetailLoad(tracker, modShared, 'initial', fetchersInst1, handlers, 'inst_1');
  assert.equal(loading, true);

  // Switch instance to inst_2 while same mod_shared is active
  activeInstanceId = 'inst_2';
  tracker.setContext('inst_2', 'mod_shared');

  const fetchersInst2: ModDetailFetchers = {
    fetchSpriteManifest: async () => ({
      version_id: 'v_inst2',
      sets: [{ id: 'set_inst2', name: 'Inst 2 Set' } as any],
    }),
    fetchModVersion: async () => null,
    fetchPublishedVersions: async () => [],
    fetchModImages: async () => [],
  };

  const runInst2 = executeDetailLoad(tracker, modShared, 'initial', fetchersInst2, handlers, 'inst_2');
  const resultInst2 = await runInst2;
  assert.equal(resultInst2, true);
  assert.equal(activeSets.length, 1);
  assert.equal(activeSets[0].id, 'set_inst2');

  // Now the slow response from Instance 1 arrives
  resolveInst1({
    version_id: 'v_inst1',
    sets: [{ id: 'set_inst1', name: 'Inst 1 Set' } as any],
  });
  const resultInst1 = await runInst1;
  assert.equal(resultInst1, false, 'Delayed response from inst_1 must be rejected');
  assert.equal(activeSets[0].id, 'set_inst2', 'State from inst_2 must not be overwritten');
});

test('instance isolation: error response from Instance 1 does not report error to Instance 2', async () => {
  const tracker = createModDetailTracker('mod_shared', 'inst_1');
  const modShared = makeMockMod('mod_shared', 'spritepack');

  let reportedError = '';

  const handlers: ModDetailLoadHandlers = {
    onStart: () => {},
    onSpritepackSuccess: () => {},
    onSubmodSuccess: () => {},
    onError: (msg) => {
      reportedError = msg;
    },
    onFinally: () => {},
  };

  let rejectInst1!: (err: Error) => void;
  const promiseInst1 = new Promise<SpriteManifestLike>((_, rej) => {
    rejectInst1 = rej;
  });

  const fetchersInst1: ModDetailFetchers = {
    fetchSpriteManifest: async () => promiseInst1,
    fetchModVersion: async () => null,
    fetchPublishedVersions: async () => [],
    fetchModImages: async () => [],
  };

  const runInst1 = executeDetailLoad(tracker, modShared, 'initial', fetchersInst1, handlers, 'inst_1');

  // Switch instance to inst_2
  tracker.setContext('inst_2', 'mod_shared');

  // Now reject inst_1
  rejectInst1(new Error('Network failure in instance 1'));
  const resultInst1 = await runInst1;
  assert.equal(resultInst1, false);
  assert.equal(reportedError, '', 'Error from old instance must not be written to new instance');
});
