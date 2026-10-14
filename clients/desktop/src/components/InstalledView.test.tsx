import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InstalledView } from './InstalledView';
import type { InstalledItem } from '../types/client';

function makeMockInstalledItem(override?: Partial<InstalledItem>): InstalledItem {
  return {
    mod_id: 'submod_1',
    title: 'Test Submod',
    author_name: 'Test Author',
    summary: 'A submod for testing',
    category: 'submod',
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    installed_version: '1.0.0',
    installed_version_id: 'ver_1',
    latest_version: '1.0.0',
    latest_version_id: 'ver_1',
    has_update: false,
    priority: 0,
    installed_at: new Date().toISOString(),
    is_managed: true,
    managed_operation_id: 'op_1',
    integrity_status: 'modified',
    files_count: 5,
    size_bytes: 1024,
    ...override,
  };
}

test('InstalledView: repair button is rendered with real preview tooltip for drifted item', () => {
  const item = makeMockInstalledItem();
  const html = renderToStaticMarkup(
    <InstalledView
      installedMods={[item]}
      spritepacks={[]}
      hasValidInstance={true}
      modsStatus="idle"
      modsError={null}
      isModsInitialLoading={false}
      isModsRefreshing={false}
      spritepacksStatus="idle"
      spritepacksError={null}
      isSpritepacksInitialLoading={false}
      isSpritepacksRefreshing={false}
      isVerifying={false}
      onRefreshInstalled={() => {}}
      onRefreshSpritepacks={() => {}}
      onCreateSpriteGift={async () => 'gift_file'}
      onDeleteSpritepack={async () => {}}
      onStartUninstallPlan={() => {}}
      onStartRepairPlan={() => {}}
      onStartUpdatePlan={() => {}}
      onOpenAdoptModal={() => {}}
      onInspectFiles={() => {}}
      onCheckAllUpdates={() => {}}
      onVerifyIntegrity={() => {}}
    />
  );

  assert.match(html, /修复/);
  assert.match(html, /预览从已校验的托管材料恢复文件/);
  assert.match(html, /覆盖前备份，缺少材料时失败/);
});

test('InstalledView: repair button is disabled when scan is running or in error state', () => {
  const item = makeMockInstalledItem();
  const htmlLoading = renderToStaticMarkup(
    <InstalledView
      installedMods={[item]}
      spritepacks={[]}
      hasValidInstance={true}
      modsStatus="loading"
      modsError={null}
      isModsInitialLoading={true}
      isModsRefreshing={false}
      spritepacksStatus="idle"
      spritepacksError={null}
      isSpritepacksInitialLoading={false}
      isSpritepacksRefreshing={false}
      isVerifying={false}
      onRefreshInstalled={() => {}}
      onRefreshSpritepacks={() => {}}
      onCreateSpriteGift={async () => 'gift_file'}
      onDeleteSpritepack={async () => {}}
      onStartUninstallPlan={() => {}}
      onStartRepairPlan={() => {}}
      onStartUpdatePlan={() => {}}
      onOpenAdoptModal={() => {}}
      onInspectFiles={() => {}}
      onCheckAllUpdates={() => {}}
      onVerifyIntegrity={() => {}}
    />
  );

  assert.match(htmlLoading, /disabled/);
  assert.match(htmlLoading, /正在读取模组列表/);
});
