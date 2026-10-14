import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanPreviewModal } from './PlanPreviewModal';
import type { Plan, Installation } from '../types/client';

function makeMockInstallation(): Installation {
  return {
    id: 'inst_1',
    label: 'MAS 测试环境',
    platform: 'windows',
    path_hint: 'C:/MAS',
    permission_state: 'authorized',
    mas_version: '0.12.14',
    is_valid: true,
    is_running: false,
    disk_available_bytes: 10 * 1024 * 1024 * 1024,
    last_validated_at: '2026-01-01T00:00:00Z',
  };
}

function makeMockPlan(override?: Partial<Plan>): Plan {
  return {
    plan_id: 'plan_1',
    kind: 'install',
    installation_id: 'inst_1',
    mod_id: 'mod_sprite',
    mod_title: '测试精灵包',
    version_id: 'v1',
    version_str: '1.0.0',
    expires_at: new Date(Date.now() + 300000).toISOString(),
    dependency_blockers: [],
    semantic_blockers: [],
    changes: [],
    backups_required: 0,
    bytes_required: 1024,
    warnings: [],
    category: 'spritepack',
    sprite_set_ids: ['set_a'],
    selected_sprite_set_count: 1,
    ...override,
  };
}

test('external drift distinguishes pending recovery from ordinary repair', () => {
 const html = renderToStaticMarkup(<PlanPreviewModal plan={makeMockPlan({blockers:['external_change: game/demo.rpy (expected old got missing)']})} activeInstallation={makeMockInstallation()} isGameRunning={false} onClose={() => {}} onApplyPlan={() => {}} onOpenRecovery={() => {}} />);
 assert.match(html, /external_change/);
 assert.match(html, /检查未完成事务/);
 assert.match(html, /没有未完成事务/);
 assert.doesNotMatch(html, /事务校验阻断 \[plan_blocked\]/);
});

test('PlanPreviewModal: pure new install does not require uninstall confirmation', () => {
  const plan = makeMockPlan({
    sprite_selection_context: {
      baseline_ids: [],
      final_ids: ['set_a'],
      removed_ids: [],
    },
  });

  const html = renderToStaticMarkup(
    <PlanPreviewModal
      plan={plan}
      activeInstallation={makeMockInstallation()}
      isGameRunning={false}
      onClose={() => {}}
      onApplyPlan={() => {}}
    />
  );

  // Should NOT show uninstall confirmation checkbox
  assert.doesNotMatch(html, /我确认应用后将卸载未保留的已安装套装/);
  // Button should be ready
  assert.match(html, /确认执行写入/);
});

test('PlanPreviewModal: plan with removed sets requires uninstall confirmation checkbox', () => {
  const plan = makeMockPlan({
    sprite_selection_context: {
      baseline_ids: ['set_a', 'set_b'],
      final_ids: ['set_b'],
      removed_ids: ['set_a'],
    },
  });

  const html = renderToStaticMarkup(
    <PlanPreviewModal
      plan={plan}
      activeInstallation={makeMockInstallation()}
      isGameRunning={false}
      onClose={() => {}}
      onApplyPlan={() => {}}
    />
  );

  // Must show uninstall confirmation checkbox
  assert.match(html, /我确认应用后将卸载未保留的已安装套装/);
  // Must show removed set in summary
  assert.match(html, /将卸载旧集合 ID:/);
  assert.match(html, /set_a/);
  // Button must be blocked until confirmed
  assert.match(html, /写入受阻：请勾选确认卸载未保留的已安装套装/);
});

test('PlanPreviewModal: unknown legacy selection requires uninstall confirmation checkbox', () => {
  const plan = makeMockPlan({
    sprite_selection_context: {
      unknown_legacy_selection: true,
      final_ids: ['set_b'],
    },
  });

  const html = renderToStaticMarkup(
    <PlanPreviewModal
      plan={plan}
      activeInstallation={makeMockInstallation()}
      isGameRunning={false}
      onClose={() => {}}
      onApplyPlan={() => {}}
    />
  );

  assert.match(html, /检测到旧安装记录无法验证，应用后将替换并卸载未保留的原有套装。/);
  assert.match(html, /我确认应用后将卸载未保留的已安装套装/);
  assert.match(html, /写入受阻：请勾选确认卸载未保留的已安装套装/);
});

test('PlanPreviewModal: full uninstall of spritepack requires uninstall confirmation checkbox and shows removed sets', () => {
  const plan = makeMockPlan({
    kind: 'uninstall',
    category: 'spritepack',
    sprite_set_ids: [],
    selected_sprite_set_count: 0,
    sprite_selection_context: {
      baseline_ids: ['set_a', 'set_b'],
      final_ids: [],
      removed_ids: ['set_a', 'set_b'],
      unknown_legacy_selection: false,
    },
  });

  const html = renderToStaticMarkup(
    <PlanPreviewModal
      plan={plan}
      activeInstallation={makeMockInstallation()}
      isGameRunning={false}
      onClose={() => {}}
      onApplyPlan={() => {}}
    />
  );

  assert.match(html, /精灵包服饰套装卸载摘要/);
  assert.match(html, /将卸载所有外观套装集合（共 .*2.* 个套装）/);
  assert.match(html, /将卸载的集合 ID:/);
  assert.match(html, /set_a/);
  assert.match(html, /set_b/);
  assert.match(html, /本操作将完整卸载已安装的全部 2 个外观套装。/);
  assert.match(html, /我确认卸载此精灵包及所有已安装套装/);
  assert.match(html, /写入受阻：请勾选确认卸载已安装套装/);
});

test('PlanPreviewModal: full uninstall of unknown legacy spritepack requires uninstall confirmation and shows legacy warning', () => {
  const plan = makeMockPlan({
    kind: 'uninstall',
    category: 'spritepack',
    sprite_set_ids: [],
    selected_sprite_set_count: 0,
    sprite_selection_context: {
      baseline_ids: [],
      final_ids: [],
      removed_ids: [],
      unknown_legacy_selection: true,
    },
  });

  const html = renderToStaticMarkup(
    <PlanPreviewModal
      plan={plan}
      activeInstallation={makeMockInstallation()}
      isGameRunning={false}
      onClose={() => {}}
      onApplyPlan={() => {}}
    />
  );

  assert.match(html, /精灵包服饰套装卸载摘要/);
  assert.match(html, /未知数量（旧安装记录）/);
  assert.match(html, /检测到旧安装记录无法验证，卸载将清理本模组相关的所有安装文件。/);
  assert.match(html, /我确认卸载此旧版本精灵包并清理相关文件/);
  assert.match(html, /写入受阻：请勾选确认卸载已安装套装/);
});
