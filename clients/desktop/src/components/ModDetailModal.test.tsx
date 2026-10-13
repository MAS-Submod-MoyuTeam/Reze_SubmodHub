import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { ModDetailModal } from './ModDetailModal';
import type { ModSummary } from '../types/client';
import type { SpriteInstallationSnapshot } from '../spritepackUtils';

function setupDOM() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
  });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: dom.window.navigator,
      configurable: true,
      writable: true,
    });
  } catch {
    // Node.js built-in navigator can be reused
  }
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).HTMLButtonElement = dom.window.HTMLButtonElement;
  (globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
  return dom;
}

function makeMockMod(id: string = 'mod_sprite', category: 'spritepack' | 'submod' = 'spritepack'): ModSummary {
  return {
    id,
    title: `模组 ${id}`,
    category,
    summary: `简介 ${id}`,
    description: `详细描述 ${id}`,
    author: { id: 'author_1', display_name: '测试作者' },
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

let dom: JSDOM;
let rootContainer: HTMLElement;
let reactRoot: Root;

beforeEach(() => {
  dom = setupDOM();
  rootContainer = dom.window.document.getElementById('root')!;
  reactRoot = createRoot(rootContainer);
});

afterEach(async () => {
  if (reactRoot) {
    await act(async () => {
      reactRoot.unmount();
    });
  }
});

test('ModDetailModal DOM: loading manifest shows loading button and does not expose uninitialized empty selection as uninstall', async () => {
  const mod = makeMockMod();
  const snapshot: SpriteInstallationSnapshot = {
    instanceId: 'inst_1',
    modId: mod.id,
    versionId: mod.latest_version_id,
    operationId: 'op_1',
    setIds: ['set_a'],
    selectionHash: 'hash_a',
  };

  // Mock fetch to simulate pending network request
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Promise(() => {}); // never resolves
  }) as any;

  try {
    await act(async () => {
      reactRoot.render(
        <ModDetailModal
          mod={mod}
          catalogMods={[mod]}
          onSelectMod={() => {}}
          onClose={() => {}}
          onStartInstallPlan={() => {}}
          onStartUninstallPlan={() => {}}
          onDownloadArchive={() => {}}
          isDownloadingArchive={false}
          isInstalling={false}
          archiveProgress={null}
          isInstalled={true}
          installedVersion="1.0.0"
          instanceId="inst_1"
          installationSnapshot={snapshot}
          installedLoadingStatus="success"
        />
      );
    });

    // While loading manifest, button must state loading, NOT "卸载此精灵包 (已取消全部)"
    const text = rootContainer.textContent || '';
    assert.match(text, /正在读取套装清单…/);
    assert.doesNotMatch(text, /卸载此精灵包 \(已取消全部\)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ModDetailModal DOM: manifest error shows error state and blocks empty selection uninstall', async () => {
  const mod = makeMockMod();
  const snapshot: SpriteInstallationSnapshot = {
    instanceId: 'inst_1',
    modId: mod.id,
    versionId: mod.latest_version_id,
    operationId: 'op_1',
    setIds: ['set_a'],
    selectionHash: 'hash_a',
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return {
      ok: false,
      status: 500,
      json: async () => ({ code: 'server_error' }),
    };
  }) as any;

  try {
    await act(async () => {
      reactRoot.render(
        <ModDetailModal
          mod={mod}
          catalogMods={[mod]}
          onSelectMod={() => {}}
          onClose={() => {}}
          onStartInstallPlan={() => {}}
          onStartUninstallPlan={() => {}}
          onDownloadArchive={() => {}}
          isDownloadingArchive={false}
          isInstalling={false}
          archiveProgress={null}
          isInstalled={true}
          installedVersion="1.0.0"
          instanceId="inst_1"
          installationSnapshot={snapshot}
          installedLoadingStatus="success"
        />
      );
    });

    // Wait a tick for rejected fetch promise to flush
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const text = rootContainer.textContent || '';
    assert.match(text, /套装清单读取失败/);
    assert.doesNotMatch(text, /卸载此精灵包 \(已取消全部\)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ModDetailModal DOM: known installed defaults to installed A, ticking B submits A+B, deselecting all triggers uninstall plan', async () => {
  const mod = makeMockMod();
  const snapshot: SpriteInstallationSnapshot = {
    instanceId: 'inst_1',
    modId: mod.id,
    versionId: mod.latest_version_id,
    operationId: 'op_1',
    setIds: ['set_a'],
    selectionHash: 'hash_a',
  };

  const manifestData = {
    sets: [
      { id: 'set_a', name: '套装 A', items: [] },
      { id: 'set_b', name: '套装 B', items: [] },
    ],
    version_id: mod.latest_version_id,
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes('/spritepacks/')) {
      return {
        ok: true,
        json: async () => manifestData,
      };
    }
    return {
      ok: true,
      json: async () => ({
        id: mod.latest_version_id,
        mod_id: mod.id,
        version: '1.0.0',
        state: 'published',
        size_bytes: 1000,
        sha256: 'a'.repeat(64),
      }),
    };
  }) as any;

  let installedPlanCalledWith: { mod: ModSummary; version?: any; sets?: string[] } | null = null;
  let uninstalledPlanCalledWith: ModSummary | null = null;

  try {
    await act(async () => {
      reactRoot.render(
        <ModDetailModal
          mod={mod}
          catalogMods={[mod]}
          onSelectMod={() => {}}
          onClose={() => {}}
          onStartInstallPlan={(m, v, sets) => {
            installedPlanCalledWith = { mod: m, version: v, sets };
          }}
          onStartUninstallPlan={(m) => {
            uninstalledPlanCalledWith = m;
          }}
          onDownloadArchive={() => {}}
          isDownloadingArchive={false}
          isInstalling={false}
          archiveProgress={null}
          isInstalled={true}
          installedVersion="1.0.0"
          instanceId="inst_1"
          installationSnapshot={snapshot}
          installedLoadingStatus="success"
        />
      );
    });

    // Wait for manifest load effect
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // 1. Check default selection: set_a is checked, set_b is unchecked
    const checkboxes = Array.from(rootContainer.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
    assert.equal(checkboxes.length, 2, 'Should have 2 set checkboxes');
    assert.equal(checkboxes[0].checked, true, 'set_a should be checked by default');
    assert.equal(checkboxes[1].checked, false, 'set_b should be unchecked by default');

    // Button states "套装选择未变化" when unchanged
    assert.match(rootContainer.textContent || '', /套装选择未变化/);

    // 2. Tick set_b: checkbox 1
    await act(async () => {
      checkboxes[1].click();
    });

    assert.equal(checkboxes[0].checked, true);
    assert.equal(checkboxes[1].checked, true);

    // Apply button should now be enabled with "应用套装选择 (2)"
    const applyBtn = Array.from(rootContainer.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('应用套装选择')
    );
    assert.ok(applyBtn, 'Apply button should exist');

    await act(async () => {
      applyBtn.click();
    });

    assert.ok(installedPlanCalledWith, 'Install plan should be called');
    assert.deepEqual((installedPlanCalledWith as any).sets.sort(), ['set_a', 'set_b']);

    // 3. Deselect set_a while keeping set_b -> submits ['set_b']
    await act(async () => {
      checkboxes[0].click(); // uncheck set_a
    });

    assert.equal(checkboxes[0].checked, false);
    assert.equal(checkboxes[1].checked, true);

    const applyPartialBtn = Array.from(rootContainer.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('应用套装选择')
    );
    assert.ok(applyPartialBtn, 'Apply button should exist for partial selection');

    await act(async () => {
      applyPartialBtn.click();
    });

    assert.ok(installedPlanCalledWith, 'Install plan should be called for partial selection');
    assert.deepEqual((installedPlanCalledWith as any).sets, ['set_b']);

    // 4. Deselect set_b as well -> all deselected
    await act(async () => {
      checkboxes[1].click(); // uncheck set_b
    });

    assert.equal(checkboxes[0].checked, false);
    assert.equal(checkboxes[1].checked, false);

    // Should now show "卸载此精灵包 (已取消全部)"
    const uninstallBtn = Array.from(rootContainer.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('卸载此精灵包 (已取消全部)')
    );
    assert.ok(uninstallBtn, 'Uninstall button should exist when all deselected');

    await act(async () => {
      uninstallBtn.click();
    });

    assert.ok(uninstalledPlanCalledWith, 'Uninstall plan should be called');
    assert.equal((uninstalledPlanCalledWith as any).id, mod.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ModDetailModal DOM: dedicated "卸载模组" button directly invokes onStartUninstallPlan without deselecting', async () => {
  const mod = makeMockMod();
  const snapshot: SpriteInstallationSnapshot = {
    instanceId: 'inst_1',
    modId: mod.id,
    versionId: mod.latest_version_id,
    operationId: 'op_1',
    setIds: ['set_a'],
    selectionHash: 'hash_a',
  };

  const manifestData = {
    sets: [
      { id: 'set_a', name: '套装 A', items: [] },
      { id: 'set_b', name: '套装 B', items: [] },
    ],
    version_id: mod.latest_version_id,
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes('/spritepacks/')) {
      return {
        ok: true,
        json: async () => manifestData,
      };
    }
    return {
      ok: true,
      json: async () => ({
        id: mod.latest_version_id,
        mod_id: mod.id,
        version: '1.0.0',
        state: 'published',
        size_bytes: 1000,
        sha256: 'a'.repeat(64),
      }),
    };
  }) as any;

  let uninstalledPlanCalledWith: ModSummary | null = null;

  try {
    await act(async () => {
      reactRoot.render(
        <ModDetailModal
          mod={mod}
          catalogMods={[mod]}
          onSelectMod={() => {}}
          onClose={() => {}}
          onStartInstallPlan={() => {}}
          onStartUninstallPlan={(m) => {
            uninstalledPlanCalledWith = m;
          }}
          onDownloadArchive={() => {}}
          isDownloadingArchive={false}
          isInstalling={false}
          archiveProgress={null}
          isInstalled={true}
          installedVersion="1.0.0"
          instanceId="inst_1"
          installationSnapshot={snapshot}
          installedLoadingStatus="success"
        />
      );
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const directUninstallBtn = Array.from(rootContainer.querySelectorAll('button')).find((b) =>
      b.textContent?.trim() === '卸载模组'
    );
    assert.ok(directUninstallBtn, 'Dedicated uninstall button must exist in footer');

    await act(async () => {
      directUninstallBtn.click();
    });

    assert.ok(uninstalledPlanCalledWith, 'Direct uninstall button triggers uninstall callback');
    assert.equal((uninstalledPlanCalledWith as any).id, mod.id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
