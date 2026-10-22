import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CatalogView } from './CatalogView';
import type { Installation, ModSummary } from '../types/client';

const mockInstallation: Installation = {
  id: 'inst_1',
  label: 'MAS Portable 0.12',
  path_hint: 'C:/Games/DDLC_MAS',
  is_valid: true,
  is_running: false,
  mas_version: '0.12.14',
  permission_state: 'authorized',
  platform: 'windows',
  last_validated_at: new Date().toISOString(),
};

const mockMod: ModSummary = {
  id: 'catalog_mod_1',
  title: 'Monika AI Voice',
  summary: 'A submod for Monika voice synthesis',
  author: { id: 'usr_1', display_name: 'Reze' },
  category: 'submod',
  tags: ['语音'],
  supported_platforms: ['windows'],
  mas_version_range: '>=0.12.0',
  recommended_priority: 5,
  latest_version_id: 'ver_1',
  latest_version: '1.0.0',
  size_bytes: 4096,
  sha256: 'abc123sha',
  updated_at: '2026-10-01T00:00:00Z',
  downloads_count: 100,
};

function renderCatalog(props: Partial<React.ComponentProps<typeof CatalogView>> = {}): string {
  return renderToStaticMarkup(
    <CatalogView
      mods={[]}
      installedMods={[]}
      activeInstallation={mockInstallation}
      catalogError={null}
      isCatalogRefreshing={false}
      onReloadCatalog={() => {}}
      onOpenDetail={() => {}}
      onStartInstallPlan={() => {}}
      onStartUpdatePlan={() => {}}
      installingModId={null}
      installProgress={null}
      {...props}
    />,
  );
}

/** Isolate the retry button so page-level `disabled` (pager arrows) cannot leak in. */
function retryButtonMarkup(html: string): string {
  const anchor = html.indexOf('重新加载');
  assert.ok(anchor > 0, 'expected a retry entry in the markup');
  const start = html.lastIndexOf('<button', anchor);
  const end = html.indexOf('</button>', anchor);
  assert.ok(start >= 0 && end > start, 'expected the retry entry to be a button');
  return html.slice(start, end);
}

test('CatalogView: a failed catalog load shows a retry state, never the empty-result state', () => {
  const html = renderCatalog({ mods: [], catalogError: 'fetch failed' });

  assert.match(html, /目录加载失败/);
  // The real failure detail must survive; a generic network guess would hide
  // 5xx and parse errors behind "check your network".
  assert.match(html, /fetch failed/);
  assert.doesNotMatch(html, /未找到符合条件的模组/);
  assert.match(retryButtonMarkup(html), /重新加载目录/);
  assert.doesNotMatch(retryButtonMarkup(html), /disabled=""/, 'the retry entry must stay clickable while idle');
});

test('CatalogView: the retry entry reports that a reload is already running', () => {
  const html = renderCatalog({ catalogError: 'fetch failed', isCatalogRefreshing: true });
  const retry = retryButtonMarkup(html);

  assert.match(retry, /重新加载中…/);
  assert.match(retry, /disabled=""/);
});

test('CatalogView: a healthy catalog renders neither the failure nor the empty-result state', () => {
  const html = renderCatalog({ mods: [mockMod], catalogError: null });

  assert.doesNotMatch(html, /目录加载失败/);
  assert.doesNotMatch(html, /未找到符合条件的模组/);
  assert.match(html, /Monika AI Voice/);
});
