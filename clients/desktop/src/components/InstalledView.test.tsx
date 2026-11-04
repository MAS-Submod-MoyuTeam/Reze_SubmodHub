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

function renderUnmanagedTab(item: InstalledItem): string {
  return renderToStaticMarkup(
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
      initialSubTab="unmanaged"
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
}

test('InstalledView: leftovers inside a managed directory name their owner instead of posing as a new submod', () => {
  const item = makeMockInstalledItem({
    mod_id: 'local:ManagedMod',
    title: 'ManagedMod',
    is_managed: false,
    files_count: 1,
    unmanaged_paths: ['game/Submods/ManagedMod/user_notes.rpy'],
    submod_dir_name: 'ManagedMod',
    managed_owners: [{ installation_id: 'inst_managed', mod_id: 'mod_managed', title: 'Managed Title' }],
  });

  const html = renderUnmanagedTab(item);
  assert.match(html, /所在目录已安装/);
  assert.match(html, /该目录属于已安装模组「Managed Title」/);
  assert.match(html, /收纳只新增这些文件的归属/);
});

test('InstalledView: a directory without a managed owner makes no ownership claim', () => {
  const item = makeMockInstalledItem({
    mod_id: 'local:LooseMod',
    title: 'LooseMod',
    is_managed: false,
    files_count: 1,
    unmanaged_paths: ['game/Submods/LooseMod/main.rpy'],
    submod_dir_name: 'LooseMod',
  });

  const html = renderUnmanagedTab(item);
  assert.doesNotMatch(html, /所在目录已安装/);
  assert.doesNotMatch(html, /该目录属于已安装模组/);
});

test('InstalledView: unmanaged banner explains deletion limits in plain words', () => {
  const item = makeMockInstalledItem({
    mod_id: 'local:LooseMod',
    title: 'LooseMod',
    is_managed: false,
    files_count: 1,
    unmanaged_paths: ['game/Submods/LooseMod/main.rpy'],
    submod_dir_name: 'LooseMod',
  });

  const html = renderUnmanagedTab(item);
  assert.match(html, /未收纳模组在收纳前不支持直接删除/);
  assert.match(html, /这些可能是你在使用 RezeHub 之前安装的子模组/);
  assert.match(html, /可以手动删除这些文件/);
  assert.match(html, /确认这些文件安全以后手动收纳文件作为子模组使用/);
  // Design-rule citations belong in the design doc, not in front of players.
  assert.doesNotMatch(html, /2026-09-25-submodhub-design\.md/);
});

test('InstalledView: unmanaged actions speak of collecting files, not of stray hashes', () => {
  const item = makeMockInstalledItem({
    mod_id: 'local:LooseMod',
    title: 'LooseMod',
    is_managed: false,
    files_count: 1,
    unmanaged_paths: ['game/Submods/LooseMod/main.rpy'],
    submod_dir_name: 'LooseMod',
  });

  const html = renderUnmanagedTab(item);
  assert.match(html, /收纳模组/);
  assert.match(html, /查看所有文件/);
  assert.doesNotMatch(html, /收养/);
  assert.doesNotMatch(html, /散列/);
});

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
  assert.match(html, /预览从已校验的安装材料恢复文件/);
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
