import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { Window } from '@wailsio/runtime';
import { TitleBar } from './TitleBar';
import type { Installation } from '../types/client';

// Vite injects __APP_VERSION__ at build time; the Node test runner does not.
(globalThis as any).__APP_VERSION__ = '0.0.0-test';

const installation: Installation = {
  id: 'inst_1',
  label: 'MAS Portable',
  platform: 'windows',
  path_hint: 'C:/Games/MAS',
  permission_state: 'authorized',
  mas_version: '0.12.14',
  is_valid: true,
  is_running: false,
  disk_available_bytes: 1024,
  last_validated_at: '2026-01-01T00:00:00Z',
};

function titleBarProps(isAndroid = false) {
  return {
    installations: [installation],
    activeInstallationId: installation.id,
    onSelectInstallation: () => {},
    isGameRunning: false,
    isOffline: false,
    onToggleGameRunning: () => {},
    onToggleOffline: () => {},
    onOpenInstancesView: () => {},
    onLaunchGame: async () => {},
    isLaunchingGame: false,
    isAndroid,
  };
}

test('TitleBar: desktop renders a draggable custom bar with working window controls', () => {
  const html = renderToStaticMarkup(<TitleBar {...titleBarProps()} />);

  assert.match(html, /wails-drag/);
  assert.match(html, /wails-no-drag/);
  assert.match(html, /aria-label="最小化"/);
  assert.match(html, /aria-label="最大化"/);
  assert.match(html, /aria-label="关闭"/);
  // Window controls must stay reachable at narrow widths; hiding them would
  // leave a frameless window without any native fallback.
  assert.doesNotMatch(html, /hidden md:flex/);
});

test('TitleBar: Android keeps the header non-draggable and hides native window controls', () => {
  const html = renderToStaticMarkup(<TitleBar {...titleBarProps(true)} />);

  assert.doesNotMatch(html, /wails-drag/);
  assert.doesNotMatch(html, /aria-label="最小化"/);
  assert.doesNotMatch(html, /aria-label="关闭"/);
});

let dom: JSDOM;
let reactRoot: Root | null = null;
const windowCalls: string[] = [];
const originalMethods = {
  IsMaximised: Window.IsMaximised,
  Minimise: Window.Minimise,
  ToggleMaximise: Window.ToggleMaximise,
  Close: Window.Close,
};

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
  });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).MouseEvent = dom.window.MouseEvent;
  // Mark the environment as the native Wails shell so the title bar uses the
  // runtime window API instead of silently no-oping.
  (dom.window as any)._wails = { environment: { OS: 'windows' } };
  windowCalls.length = 0;
  (Window as any).IsMaximised = async () => false;
  (Window as any).Minimise = async () => {
    windowCalls.push('minimise');
  };
  (Window as any).ToggleMaximise = async () => {
    windowCalls.push('toggle-maximise');
  };
  (Window as any).Close = async () => {
    windowCalls.push('close');
  };
});

afterEach(async () => {
  if (reactRoot) {
    await act(async () => {
      reactRoot?.unmount();
    });
    reactRoot = null;
  }
  (Window as any).IsMaximised = originalMethods.IsMaximised;
  (Window as any).Minimise = originalMethods.Minimise;
  (Window as any).ToggleMaximise = originalMethods.ToggleMaximise;
  (Window as any).Close = originalMethods.Close;
  delete (globalThis as any).window;
  delete (globalThis as any).document;
});

test('TitleBar DOM: window control buttons dispatch native window commands', async () => {
  const container = dom.window.document.getElementById('root')!;
  reactRoot = createRoot(container);
  await act(async () => {
    reactRoot!.render(<TitleBar {...titleBarProps()} />);
  });

  const click = async (label: string) => {
    const button = container.querySelector(`button[aria-label="${label}"]`);
    assert.ok(button, `expected a ${label} button`);
    await act(async () => {
      button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
  };

  await click('最小化');
  await click('最大化');
  await click('关闭');

  assert.deepEqual(windowCalls, ['minimise', 'toggle-maximise', 'close']);
});

test('TitleBar DOM: double-clicking the drag area toggles maximise', async () => {
  const container = dom.window.document.getElementById('root')!;
  reactRoot = createRoot(container);
  await act(async () => {
    reactRoot!.render(<TitleBar {...titleBarProps()} />);
  });

  const header = container.querySelector('header')!;
  await act(async () => {
    header.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
  });

  assert.deepEqual(windowCalls, ['toggle-maximise']);
});

async function renderTitleBar(
  overrides: Partial<Parameters<typeof TitleBar>[0]> = {},
): Promise<{ container: HTMLElement; doubleClick: (target: Element) => Promise<void> }> {
  const container = dom.window.document.getElementById('root')!;
  reactRoot = createRoot(container);
  await act(async () => {
    reactRoot!.render(<TitleBar {...titleBarProps()} {...overrides} />);
  });

  const doubleClick = async (target: Element) => {
    await act(async () => {
      target.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }));
    });
  };

  return { container, doubleClick };
}

test('TitleBar DOM: double-clicking the game/offline status areas does not toggle maximise', async () => {
  const { container, doubleClick } = await renderTitleBar();

  // Both status indicators are clickable divs marked `wails-no-drag`; the DOM
  // double-click listener must treat them as interactive, otherwise a double
  // click both fires their onClick handlers and maximises the window.
  const gameStatus = container.querySelector(
    '[title="点击可模拟启动 MAS 游戏测试进程锁"]',
  );
  assert.ok(gameStatus, 'expected the game status indicator');
  await doubleClick(gameStatus);
  // The event target is often a nested icon/text node; closest() must resolve it.
  const nested = gameStatus.querySelector('span');
  assert.ok(nested, 'expected nested content inside the game status indicator');
  await doubleClick(nested);

  const offlineStatus = container.querySelector('[title="点击可模拟切换离线/在线状态"]');
  assert.ok(offlineStatus, 'expected the offline status indicator');
  await doubleClick(offlineStatus);

  assert.deepEqual(windowCalls, []);
});

test('TitleBar DOM: double-clicking the running game lock badge does not toggle maximise', async () => {
  const { container, doubleClick } = await renderTitleBar({ isGameRunning: true });

  const lockBadge = container.querySelector(
    '[title="点击可模拟退出游戏。当 MAS 运行时，为防止 Ren\'Py 运行时损坏，写操作被物理锁定。"]',
  );
  assert.ok(lockBadge, 'expected the running-game lock badge');
  await doubleClick(lockBadge);

  assert.deepEqual(windowCalls, []);
});

test('TitleBar DOM: every wails-no-drag region defers to the native hit test', async () => {
  const { container, doubleClick } = await renderTitleBar();

  const noDragRegions = Array.from(container.querySelectorAll('.wails-no-drag'));
  assert.ok(noDragRegions.length > 0, 'expected wails-no-drag regions in the header');

  for (const region of noDragRegions) {
    await doubleClick(region);
    // Also exercise a nested child so bubbling from inner content is covered.
    const child = region.firstElementChild;
    if (child) await doubleClick(child);
  }

  assert.deepEqual(windowCalls, []);
});

test('TitleBar DOM: double-clicking inert drag-area content still toggles maximise', async () => {
  const { container, doubleClick } = await renderTitleBar();

  // Brand text lives in the draggable area and has no click handler, so it must
  // keep behaving like the header itself.
  const brand = container.querySelector('span.font-semibold');
  assert.ok(brand, 'expected the brand label');
  await doubleClick(brand);

  assert.deepEqual(windowCalls, ['toggle-maximise']);
});
