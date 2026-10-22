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

test('TitleBar: an idle, valid instance renders no ambient status indicators', () => {
  const html = renderToStaticMarkup(<TitleBar {...titleBarProps()} />);

  assert.doesNotMatch(html, /游戏未运行/);
  assert.doesNotMatch(html, /API v1 在线/);
  assert.doesNotMatch(html, /离线缓存/);
  assert.doesNotMatch(html, /MAS 状态未验证/);
  // The middle indicator zone is not rendered at all when there is nothing to
  // warn about, so an idle instance costs no layout slot.
  assert.doesNotMatch(html, /xl:flex items-center gap-3/);
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

test('TitleBar: the running-game lock badge is a passive warning, not a simulator', () => {
  const html = renderToStaticMarkup(<TitleBar {...titleBarProps()} isGameRunning />);

  assert.match(html, /MAS 进程运行中 \(写操作锁定\)/);
  // The scenario simulator is gone: the badge must not advertise a
  // click-to-simulate affordance, nor look clickable.
  assert.doesNotMatch(html, /点击可模拟/);
  assert.doesNotMatch(html, /cursor-pointer/);
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
