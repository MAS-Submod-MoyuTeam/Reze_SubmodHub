import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InstalledView } from './InstalledView';
import { OperationsView } from './OperationsView';
import { PlanPreviewModal } from './PlanPreviewModal';
import { CatalogView } from './CatalogView';
import type { InstalledItem, Operation, Plan, ModSummary, Installation } from '../types/client';

function makeMockInstalledItem(override?: Partial<InstalledItem>): InstalledItem {
  return {
    mod_id: 'submod_mobile_1',
    title: 'Mobile Test Submod',
    author_name: 'Reze Dev',
    summary: 'A submod for testing mobile card rendering',
    category: 'submod',
    sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    installed_version: '1.2.0',
    installed_version_id: 'ver_1',
    latest_version: '1.3.0',
    latest_version_id: 'ver_2',
    has_update: true,
    priority: 10,
    installed_at: new Date().toISOString(),
    is_managed: true,
    managed_operation_id: 'op_1',
    integrity_status: 'intact',
    files_count: 8,
    size_bytes: 2048,
    ...override,
  };
}

function makeMockOperation(override?: Partial<Operation>): Operation {
  return {
    operation_id: 'op_install_test_12345',
    installation_id: 'inst_1',
    mod_id: 'submod_mobile_1',
    mod_title: 'Mobile Test Submod',
    version_id: 'ver_1',
    version_str: '1.2.0',
    kind: 'install',
    state: 'recoverable',
    phase: 'applying',
    progress: {
      stage: '正在写入文件',
      processed_files: 5,
      total_files: 8,
      bytes_processed: 512,
      total_bytes: 1024,
      percent: 62,
      current_file: 'game/Submods/Test/script.rpy',
    },
    backup_id: 'bak_snapshot_999',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    can_rollback: true,
    ...override,
  };
}

const mockActiveInstallation: Installation = {
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

test('InstalledView: mobile card view renders managed mod identity, metadata, and all action buttons', () => {
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

  // Both desktop and mobile card view are present in markup (responsive md:hidden / hidden md:block)
  assert.match(html, /md:hidden/);
  assert.match(html, /Mobile Test Submod/);
  assert.match(html, /优先级 10/);
  assert.match(html, /规划更新/);
  assert.match(html, /文件清单/);
  assert.match(html, /修复/);
  assert.match(html, /卸载/);
  assert.match(html, /未被改动/);
});

test('OperationsView: mobile card view renders operation details, progress, and rollback action', () => {
  const op = makeMockOperation();
  const html = renderToStaticMarkup(
    <OperationsView
      operations={[op]}
      externalDrift={null}
      onRecoverOperation={() => {}}
      onResolveDrift={() => {}}
      onExportLogs={() => {}}
    />
  );

  assert.match(html, /md:hidden/);
  assert.match(html, /op_install_test_12345/);
  assert.match(html, /Mobile Test Submod/);
  assert.match(html, /安全回滚/);
  assert.match(html, /详情/);
  assert.match(html, /bak_snapshot_999/);
});

test('PlanPreviewModal: actions include 44px min-height touch targets and accessible layout', () => {
  const mockPlan: Plan = {
    plan_id: 'plan_preview_123',
    mod_id: 'submod_mobile_1',
    mod_title: 'Mobile Test Submod',
    version_id: 'v_1',
    version_str: '1.3.0',
    kind: 'install',
    installation_id: 'inst_1',
    expires_at: new Date(Date.now() + 300000).toISOString(),
    changes: [
      {
        action: 'CREATE',
        target_path: 'game/Submods/Test/script.rpy',
        previous_owner: '',
        next_owner: 'submod_mobile_1',
        backup_required: false,
        reason: '初始安装',
      },
    ],
    dependency_blockers: [],
    semantic_blockers: [],
    bytes_required: 1024,
    backups_required: 0,
    warnings: [],
  };

  const html = renderToStaticMarkup(
    <PlanPreviewModal
      plan={mockPlan}
      activeInstallation={mockActiveInstallation}
      onApplyPlan={() => {}}
      onClose={() => {}}
      isGameRunning={false}
    />
  );

  assert.match(html, /放弃并取消/);
  assert.match(html, /确认执行写入 \(ApplyPlan\)/);
  assert.match(html, /min-h-\[44px\]/);
  assert.match(html, /max-h-\[92dvh\]/);
});

test('CatalogView: responsive secondary filter groups platform, compatibility, and tags', () => {
  const mockMod: ModSummary = {
    id: 'catalog_mod_1',
    title: 'Monika AI Voice',
    summary: 'A submod for Monika voice synthesis',
    author: { id: 'usr_1', display_name: 'Reze' },
    category: 'submod',
    tags: ['语音', 'AI'],
    supported_platforms: ['windows', 'android'],
    mas_version_range: '>=0.12.0',
    recommended_priority: 5,
    latest_version_id: 'ver_1',
    latest_version: '1.0.0',
    size_bytes: 4096,
    sha256: 'abc123sha',
    updated_at: '2026-10-01T00:00:00Z',
    downloads_count: 100,
  };

  const html = renderToStaticMarkup(
    <CatalogView
      mods={[mockMod]}
      installedMods={[]}
      activeInstallation={mockActiveInstallation}
      catalogError={null}
      isCatalogRefreshing={false}
      onReloadCatalog={() => {}}
      onOpenDetail={() => {}}
      onStartInstallPlan={() => {}}
      onStartUpdatePlan={() => {}}
      installingModId={null}
      installProgress={null}
    />
  );

  assert.match(html, /目标平台:/);
  assert.match(html, /匹配当前 MAS/);
  assert.match(html, /语音/);
  assert.match(html, /no-scrollbar/);
});
