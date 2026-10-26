import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sidebar } from './Sidebar';
import type { Installation } from '../types/client';

const GB = 1024 * 1024 * 1024;

function installation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'inst_1',
    label: 'MAS Portable',
    platform: 'windows',
    path_hint: 'C:/Games/MAS',
    permission_state: 'authorized',
    mas_version: '0.12.14',
    is_valid: true,
    is_running: false,
    disk_available_bytes: 6 * GB,
    disk_total_bytes: 10 * GB,
    last_validated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function render(activeInstallation: Installation) {
  return renderToStaticMarkup(
    <Sidebar
      activeTab="catalog"
      onSelectTab={() => {}}
      activeInstallation={activeInstallation}
      installedCount={3}
      unmanagedCount={0}
      recoverableOpsCount={0}
    />,
  );
}

test('Sidebar: the storage bar reflects the real occupancy of the volume', () => {
  const html = render(installation());

  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="40"/);
  assert.match(html, /width:40%/);
  assert.match(html, /已用 40%/);
  assert.match(html, /6\.0 GB 可用/);
});

test('Sidebar: unknown capacity leaves the bar empty instead of inventing a width', () => {
  const html = render(installation({ disk_available_bytes: null, disk_total_bytes: null }));

  assert.match(html, /容量未知/);
  assert.doesNotMatch(html, /aria-valuenow/);
  assert.match(html, /width:0%/);
});

test('Sidebar: the storage block carries no root-verification caption', () => {
  const html = render(installation());

  assert.doesNotMatch(html, /已校验根目录/);
});

test('Sidebar: the build footer is gone because the title bar already shows the app identity', () => {
  const html = render(installation());

  // No repeated brand/version line at the bottom of the sidebar, and no second
  // app-update entry point competing with the title bar.
  assert.doesNotMatch(html, /RezeHub/);
  assert.doesNotMatch(html, /检查更新/);
});
