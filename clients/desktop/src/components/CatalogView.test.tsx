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

/** Isolate the retry button so any other `disabled` state elsewhere in the view cannot leak in. */
function retryButtonMarkup(html: string): string {
  // 锚在 `>重新加载` 而不是 `重新加载`：页脚里也有「共 N 个子模组」之外的同名前缀文案，
  // 只锚文本会让切片落在一个更早的元素上。`>` 让锚点唯一命中按钮自身的文案起点。
  const anchor = html.indexOf('>重新加载');
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

/** Isolate the floating refresh control; it is icon-only, so anchor on its accessible name. */
function floatingRefreshMarkup(html: string): string {
  const anchor = html.indexOf('aria-label="刷新模组目录"');
  assert.ok(anchor > 0, 'expected the floating refresh control in the markup');
  const start = html.lastIndexOf('<button', anchor);
  const end = html.indexOf('</button>', anchor);
  assert.ok(start >= 0 && end > start, 'expected the floating refresh control to be a button');
  return html.slice(start, end);
}

test('CatalogView: the floating refresh control sits in the catalog pane and spins while refreshing', () => {
  const idle = floatingRefreshMarkup(renderCatalog({ mods: [mockMod] }));
  assert.doesNotMatch(idle, /disabled=""/, 'the floating refresh control must stay clickable while idle');
  assert.doesNotMatch(idle, /animate-spin/, 'an idle refresh control must not animate');
  assert.match(idle, /rounded-full/, 'the refresh control must render as a circle');

  const refreshing = floatingRefreshMarkup(renderCatalog({ mods: [mockMod], isCatalogRefreshing: true }));
  assert.match(refreshing, /disabled=""/, 'a running refresh must lock the control');
  assert.match(refreshing, /animate-spin/, 'a running refresh must spin until it settles');
});

test('CatalogView: the floating refresh control yields to the explicit retry entry on failure', () => {
  const failed = renderCatalog({ mods: [mockMod], catalogError: 'fetch failed' });

  // A failed load already owns an explicit, labelled retry button; a second
  // icon-only entry for the same action only adds noise.
  assert.equal(failed.indexOf('aria-label="刷新模组目录"'), -1, 'the floating control must not compete with the retry entry');
  assert.match(retryButtonMarkup(failed), /重新加载目录/);
});

test('CatalogView: the scroll pane reserves room for the floating refresh control', () => {
  const html = renderCatalog({ mods: [mockMod] });

  // Regression: the control is pinned bottom-right inside the scroll pane, so
  // without bottom padding the last row's right-most card buttons hide under it.
  assert.match(html, /overflow-y-auto p-4 pb-20/, 'the grid pane must keep the floating control clear of the last row');
});

test('CatalogView: a healthy catalog renders neither the failure nor the empty-result state', () => {
  const html = renderCatalog({ mods: [mockMod], catalogError: null });

  assert.doesNotMatch(html, /目录加载失败/);
  assert.doesNotMatch(html, /未找到符合条件的模组/);
  assert.match(html, /Monika AI Voice/);
});
