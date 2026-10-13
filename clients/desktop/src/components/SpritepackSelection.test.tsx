import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SpritepackSelection } from './SpritepackSelection';
import { deriveSpriteSelection, calculateSpriteSelectionDiff } from '../spritepackUtils';
import type { SpriteSet } from '../../../../ui/catalog-api';

function makeMockSets(): SpriteSet[] {
  return [
    { id: 'set_a', name: '套装 A', items: [] },
    { id: 'set_b', name: '套装 B', items: [] },
    { id: 'set_c', name: '套装 C', items: [] },
  ];
}

test('SpritepackSelection: known_installed displays fixed prompt, badges, and summary', () => {
  const sets = makeMockSets();
  const baseline = deriveSpriteSelection(sets, {
    instanceId: 'inst_1',
    modId: 'mod_1',
    versionId: 'v1',
    operationId: 'op_1',
    setIds: ['set_a'],
    selectionHash: 'hash_a',
  }, 'success');

  // User keeps A and adds B
  const diff = calculateSpriteSelectionDiff(baseline, ['set_a', 'set_b']);

  const html = renderToStaticMarkup(
    <SpritepackSelection
      spriteSets={sets}
      selectedSets={['set_a', 'set_b']}
      onToggleSet={() => {}}
      onSelectAll={() => {}}
      onDeselectAll={() => {}}
      baseline={baseline}
      diff={diff}
    />
  );

  // 1. 固定提示
  assert.match(
    html,
    /已选择当前安装的项目。勾选其他套装可追加安装；取消勾选已安装套装并应用后，这些套装将被卸载。/
  );

  // 2. 摘要显示
  assert.match(html, /保留 1 个 \/ 新增 1 个 \/ 卸载 0 个/);

  // 3. set_a 是已安装且选中 -> 徽标包含 "已安装"
  assert.match(html, /已安装/);

  // 4. set_b 是未安装且选中 -> 徽标包含 "待安装"
  assert.match(html, /待安装/);
});

test('SpritepackSelection: known_installed unchecking installed set displays "应用后将卸载"', () => {
  const sets = makeMockSets();
  const baseline = deriveSpriteSelection(sets, {
    instanceId: 'inst_1',
    modId: 'mod_1',
    versionId: 'v1',
    operationId: 'op_1',
    setIds: ['set_a'],
    selectionHash: 'hash_a',
  }, 'success');

  // User unchecks set_a and only checks set_b
  const diff = calculateSpriteSelectionDiff(baseline, ['set_b']);

  const html = renderToStaticMarkup(
    <SpritepackSelection
      spriteSets={sets}
      selectedSets={['set_b']}
      onToggleSet={() => {}}
      onSelectAll={() => {}}
      onDeselectAll={() => {}}
      baseline={baseline}
      diff={diff}
    />
  );

  assert.match(html, /应用后将卸载/);
  assert.match(html, /待安装/);
  assert.match(html, /保留 0 个 \/ 新增 1 个 \/ 卸载 1 个/);
});

test('SpritepackSelection: deselecting all displays uninstall prompt for known_installed', () => {
  const sets = makeMockSets();
  const baseline = deriveSpriteSelection(sets, {
    instanceId: 'inst_1',
    modId: 'mod_1',
    versionId: 'v1',
    operationId: 'op_1',
    setIds: ['set_a'],
    selectionHash: 'hash_a',
  }, 'success');

  const diff = calculateSpriteSelectionDiff(baseline, []);

  const html = renderToStaticMarkup(
    <SpritepackSelection
      spriteSets={sets}
      selectedSets={[]}
      onToggleSet={() => {}}
      onSelectAll={() => {}}
      onDeselectAll={() => {}}
      baseline={baseline}
      diff={diff}
    />
  );

  assert.match(html, /已取消所有套装。点击下方“卸载此精灵包”将彻底卸载此模组。/);
});

test('SpritepackSelection: first_install displays zero-selection blocking alert and no installed prompt', () => {
  const sets = makeMockSets();
  const baseline = deriveSpriteSelection(sets, null, 'success');
  const diff = calculateSpriteSelectionDiff(baseline, []);

  const html = renderToStaticMarkup(
    <SpritepackSelection
      spriteSets={sets}
      selectedSets={[]}
      onToggleSet={() => {}}
      onSelectAll={() => {}}
      onDeselectAll={() => {}}
      baseline={baseline}
      diff={diff}
    />
  );

  // Must not have installed prompt
  assert.doesNotMatch(html, /已选择当前安装的项目/);
  assert.match(html, /请至少选择一个套装以继续安装。/);
});

test('SpritepackSelection: unknown_installed displays legacy warning and risk confirmation checkbox', () => {
  const sets = makeMockSets();
  const baseline = deriveSpriteSelection(sets, {
    instanceId: 'inst_1',
    modId: 'mod_1',
    versionId: 'v1',
    operationId: 'op_legacy',
  }, 'success');
  const diff = calculateSpriteSelectionDiff(baseline, ['set_a']);

  const htmlUnconfirmed = renderToStaticMarkup(
    <SpritepackSelection
      spriteSets={sets}
      selectedSets={['set_a']}
      onToggleSet={() => {}}
      onSelectAll={() => {}}
      onDeselectAll={() => {}}
      baseline={baseline}
      diff={diff}
      legacyRiskConfirmed={false}
    />
  );

  assert.match(htmlUnconfirmed, /旧安装记录无法识别已安装套装，请重新选择最终保留的套装；应用将替换旧安装内容。/);
  assert.match(htmlUnconfirmed, /我已知晓并确认将替换旧安装内容/);
});

test('SpritepackSelection: unavailable installed IDs displays warning notice', () => {
  const sets = makeMockSets();
  const baseline = deriveSpriteSelection(sets, {
    instanceId: 'inst_1',
    modId: 'mod_1',
    versionId: 'v1',
    operationId: 'op_1',
    setIds: ['set_a', 'set_discontinued'],
    selectionHash: 'hash_a',
  }, 'success');
  const diff = calculateSpriteSelectionDiff(baseline, ['set_a']);

  const html = renderToStaticMarkup(
    <SpritepackSelection
      spriteSets={sets}
      selectedSets={['set_a']}
      onToggleSet={() => {}}
      onSelectAll={() => {}}
      onDeselectAll={() => {}}
      baseline={baseline}
      diff={diff}
    />
  );

  assert.match(html, /以下已安装套装在当前版本不可用，应用后将移除旧安装内容/);
  assert.match(html, /set_discontinued/);
});
