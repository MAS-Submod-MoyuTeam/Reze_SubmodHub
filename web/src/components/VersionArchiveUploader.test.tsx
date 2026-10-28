import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { VersionArchiveUploader } from './VersionArchiveUploader';
import type { AssetPlatform, ModVersion, Platform } from '../types/submodhub';

const version = (patch: Partial<ModVersion> = {}): ModVersion => ({
  id: 'v1',
  mod_id: 'm1',
  version: '1.0.0',
  state: 'draft',
  size_bytes: 0,
  sha256: '',
  release_notes: '',
  dependencies: [],
  created_at: '2026-10-28T00:00:00Z',
  ...patch,
});

async function mount(initial: ModVersion, declared: Platform[] | undefined = ['windows', 'android']) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const picks: Array<AssetPlatform | ''> = [];
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <VersionArchiveUploader version={initial} declaredPlatforms={declared} busy={false} onPick={(platform) => picks.push(platform)} />,
    );
  });
  const button = (label: string) => {
    const found = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.trim() === label);
    assert.ok(found, `missing button ${label}`);
    return found;
  };
  const click = async (label: string) => {
    await act(async () => {
      button(label).click();
    });
  };
  const close = async () => {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
    Object.assign(globalThis, { window: oldWindow, document: oldDocument });
  };
  return { container, picks, button, click, close };
}

// The reported gap: a version uploaded to this site only had one all-platform
// button, so an author who builds separate Windows/Android packages could never
// reach the per-platform path.
test('a version without an archive chooses between a shared and a per-platform upload', async () => {
  const view = await mount(version());
  try {
    assert.match(view.container.textContent!, /全平台共用一个包/);
    assert.match(view.container.textContent!, /按平台分别上传/);
    // Default stays the behaviour every existing version has.
    assert.match(view.container.textContent!, /上传 ZIP 归档（全平台共用）/);
    assert.throws(() => view.button('上传 Windows 归档'), 'platform buttons must stay hidden until the split shape is chosen');

    await view.click('按平台分别上传');
    await view.click('上传 Windows 归档');
    await view.click('上传 Android 归档');
    assert.deepEqual(view.picks, ['windows', 'android']);
  } finally {
    await view.close();
  }
});

test('a split version re-uploads each platform and names the platform still missing', async () => {
  const view = await mount(version({ platform_assets: [{ platform: 'windows', size_bytes: 10 }] }));
  try {
    assert.doesNotMatch(view.container.textContent!, /按平台分别上传/, 'a version that already shipped its shape cannot switch it');
    assert.ok(view.button('Windows：重新上传 (10 B)'));
    assert.ok(view.button('上传 Android 归档'));
    assert.match(view.container.textContent!, /还需上传 Android 归档/);
    await view.click('上传 Android 归档');
    assert.deepEqual(view.picks, ['android']);
  } finally {
    await view.close();
  }
});

test('a shared version only offers to replace its single archive', async () => {
  const view = await mount(version({ sha256: 'a'.repeat(64), size_bytes: 2048 }));
  try {
    assert.ok(view.button('重新上传 ZIP 归档（全平台共用）'));
    assert.doesNotMatch(view.container.textContent!, /按平台分别上传/);
    assert.doesNotMatch(view.container.textContent!, /上传 Windows 归档/);
  } finally {
    await view.close();
  }
});

test('a mod that publishes for one platform only uploads that platform', async () => {
  const view = await mount(version(), ['android']);
  try {
    await view.click('按平台分别上传');
    assert.ok(view.button('上传 Android 归档'));
    assert.throws(() => view.button('上传 Windows 归档'));
    assert.match(view.container.textContent!, /模组只声明了 Android 平台/);
  } finally {
    await view.close();
  }
});
