import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AdoptModal,
  getCandidateRegistrationPaths,
  matchRegistrationToCandidate,
  normalizePath,
} from './AdoptModal';
import { InstalledView } from './InstalledView';
import type { InstalledItem } from '../types/client';

function makeMockUnmanagedItem(override?: Partial<InstalledItem>): InstalledItem {
  return {
    mod_id: 'local:TestSubmod',
    title: 'Test Submod',
    author_name: 'Test Author',
    summary: '检测到 MAS 本地子模组',
    category: 'submod',
    sha256: 'hash123',
    installed_version: '1.2.0',
    installed_version_id: '',
    latest_version: '未托管',
    latest_version_id: '',
    has_update: false,
    priority: 0,
    installed_at: new Date().toISOString(),
    is_managed: false,
    files_count: 5,
    size_bytes: 2048,
    integrity_status: 'unknown',
    submod_dir_name: 'TestSubmod',
    unmanaged_paths: [
      'game/Submods/TestSubmod/a.rpy',
      'game/Submods/TestSubmod/b.rpy',
      'game/Submods/TestSubmod/c.rpy',
      'game/Submods/TestSubmod/d.rpy',
      'game/Submods/TestSubmod/e.rpy',
    ],
    ...override,
  };
}

test('InstalledView: unmanaged item shows collapsed 3 paths and full list toggle', () => {
  const item = makeMockUnmanagedItem({
    match_status: 'matched',
    match_candidates: [
      {
        mod_id: 'store_test_mod',
        title: 'Store Matched Title',
        priority: 'single_registration',
        score: 0,
        registrations: ['Test Submod'],
        evidence: ['v1.2.0'],
        reason: 'single registration match',
      },
    ],
  });

  const html = renderToStaticMarkup(
    <InstalledView
      installedMods={[item]}
      spritepacks={[]}
      hasValidInstance={true}
      initialSubTab="unmanaged"
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

  // Check store match badge
  assert.ok(html.includes('商店可匹配: Store Matched Title'));
  // Check first 3 paths are shown
  assert.ok(html.includes('game/Submods/TestSubmod/a.rpy'));
  assert.ok(html.includes('game/Submods/TestSubmod/b.rpy'));
  assert.ok(html.includes('game/Submods/TestSubmod/c.rpy'));
  // Check 4th path is collapsed
  assert.ok(!html.includes('game/Submods/TestSubmod/d.rpy'));
  // Check view full list button
  assert.ok(html.includes('查看完整清单 (5)'));
});

test('AdoptModal: renders store match candidate and file checklist', () => {
  const item = makeMockUnmanagedItem({
    registrations: [
      { name: 'Test Submod', source: 'game/Submods/TestSubmod/a.rpy', unknown: false },
    ],
    match_status: 'matched',
    match_candidates: [
      {
        mod_id: 'store_test_mod',
        title: 'Store Matched Title',
        priority: 'single_registration',
        score: 0,
        registrations: ['Test Submod'],
        evidence: ['v1.2.0'],
        reason: 'single registration match',
      },
    ],
  });

  const html = renderToStaticMarkup(
    <AdoptModal
      item={item}
      onClose={() => {}}
      onConfirmAdopt={() => {}}
    />
  );

  // Checks candidate title prefilled or recommended
  assert.ok(html.includes('Store Matched Title'));
  assert.ok(html.includes('商店已匹配候选模组'));
  assert.ok(html.includes('⭐ 唯一注册头优先匹配'));
  // Checks file checklist summary - only proven registration source (1 of 5) is selected by default
  assert.ok(html.includes('纳入收养范围的文件清单 (1 / 5)'));
});

test('AdoptModal: unverified attribution without registrations defaults to empty selection (0 / N), not all scripts or cleanPaths', () => {
  const item = makeMockUnmanagedItem({
    registrations: [],
    unmanaged_paths: [
      'game/Submods/TestSubmod/script1.rpy',
      'game/Submods/TestSubmod/script2.rpy',
      'game/Submods/TestSubmod/image.png',
    ],
  });

  const html = renderToStaticMarkup(
    <AdoptModal
      item={item}
      onClose={() => {}}
      onConfirmAdopt={() => {}}
    />
  );

  // Without verified registrations, defaults to empty selection 0 / 3
  assert.ok(html.includes('纳入收养范围的文件清单 (0 / 3)'));
});

test('AdoptModal: item with only assets and no scripts defaults to empty selection (0 / N), never selecting cleanPaths', () => {
  const item = makeMockUnmanagedItem({
    registrations: [],
    unmanaged_paths: [
      'game/Submods/TestSubmod/asset1.png',
      'game/Submods/TestSubmod/asset2.png',
      'game/Submods/TestSubmod/data.json',
    ],
  });

  const html = renderToStaticMarkup(
    <AdoptModal
      item={item}
      onClose={() => {}}
      onConfirmAdopt={() => {}}
    />
  );

  // Without proven attribution, never falls back to selecting all cleanPaths
  assert.ok(html.includes('纳入收养范围的文件清单 (0 / 3)'));
});

test('AdoptModal: path normalization matches registrations with or without game/ prefix', () => {
  // Test registration source without game/ prefix matching cleanPath with game/ prefix
  const item = makeMockUnmanagedItem({
    registrations: [
      { name: 'Mod A', source: 'Submods/TestSubmod/head.rpy', unknown: false },
    ],
    unmanaged_paths: [
      'game/Submods/TestSubmod/head.rpy',
      'game/Submods/TestSubmod/auxiliary.rpy',
      'game/Submods/TestSubmod/asset.png',
    ],
  });

  const html = renderToStaticMarkup(
    <AdoptModal
      item={item}
      onClose={() => {}}
      onConfirmAdopt={() => {}}
    />
  );

  // Normalized path matching ensures head.rpy is selected (1 / 3)
  assert.ok(html.includes('纳入收养范围的文件清单 (1 / 3)'));
});

test('AdoptModal: ambiguous match candidate does NOT auto-bind mod_id or title', () => {
  const item = makeMockUnmanagedItem({
    match_status: 'ambiguous',
    match_candidates: [
      {
        mod_id: 'store_cand_1',
        title: 'Candidate One',
        priority: 'multi_registration',
        score: 1,
        registrations: ['Reg 1'],
        evidence: ['v1.0.0'],
        reason: 'matches published version with multiple registrations',
      },
      {
        mod_id: 'store_cand_2',
        title: 'Candidate Two',
        priority: 'multi_registration',
        score: 1,
        registrations: ['Reg 2'],
        evidence: ['v1.0.0'],
        reason: 'matches published version with multiple registrations',
      },
    ],
  });

  const html = renderToStaticMarkup(
    <AdoptModal
      item={item}
      onClose={() => {}}
      onConfirmAdopt={() => {}}
    />
  );

  // Ambiguous banner is rendered
  assert.ok(html.includes('存在歧义候选模组'));
  // Neither candidate is automatically prefilled in mod_id input (value="")
  assert.ok(html.includes('value=""'));
  // Both candidates are listed with "使用此 ID" buttons
  assert.ok(html.includes('store_cand_1'));
  assert.ok(html.includes('store_cand_2'));
});

test('AdoptModal: multi-registration or unknown does NOT select all files by default', () => {
  const item = makeMockUnmanagedItem({
    registrations: [
      { name: 'Mod A', source: 'game/Submods/TestSubmod/a.rpy', unknown: false },
      { name: 'Mod B', source: 'game/Submods/TestSubmod/b.rpy', unknown: false },
    ],
    unmanaged_paths: [
      'game/Submods/TestSubmod/a.rpy',
      'game/Submods/TestSubmod/b.rpy',
      'game/Submods/TestSubmod/c.rpy',
      'game/Submods/TestSubmod/asset.png',
    ],
  });

  const html = renderToStaticMarkup(
    <AdoptModal
      item={item}
      onClose={() => {}}
      onConfirmAdopt={() => {}}
    />
  );

  // Multi-registration warning banner is displayed
  assert.ok(html.includes('检测到多个子模组注册头'));
  // Only explicitly linked registration source files (2 of 4) are selected by default, NOT all 4
  assert.ok(html.includes('纳入收养范围的文件清单 (2 / 4)'));
});

test('scanLocalSubmods logic: co-existence of managed and unmanaged files in same directory', () => {
  // Simulates frontend mapping without managedDirs filtering
  const receipts = [
    {
      mod_id: 'mod_managed',
      title: 'Managed Mod',
      version: '1.0',
      version_id: 'v1',
      submod_dirs: ['ManagedDir'],
      files: 2,
      size_bytes: 1000,
      operation_id: 'op1',
    },
  ];
  // Backend returns local submod for ManagedDir containing the unmanaged file
  const localScanResults = [
    {
      id: 'ManagedDir',
      directory: 'ManagedDir',
      name: 'Extra Script',
      version: '0.1',
      files: [{ path: 'game/Submods/ManagedDir/extra.rpy', sha256: 'h1', size: 120 }],
      registrations: [{ name: 'Extra Script', source: 'game/Submods/ManagedDir/extra.rpy', unknown: false }],
    },
  ];

  // The new logic does NOT filter out ManagedDir:
  const unmanaged = localScanResults.map((item) => ({
    mod_id: `local:${item.directory || item.id || 'scattered'}`,
    title: item.name || item.directory || '散落脚本项',
    submod_dir_name: item.directory,
    files_count: item.files.length,
    unmanaged_paths: item.files.map((f) => f.path),
  }));

  assert.equal(unmanaged.length, 1);
  assert.equal(unmanaged[0].submod_dir_name, 'ManagedDir');
  assert.equal(unmanaged[0].unmanaged_paths[0], 'game/Submods/ManagedDir/extra.rpy');
});

test('AdoptModal helpers: matchRegistrationToCandidate and getCandidateRegistrationPaths', () => {
  const candidate = {
    mod_id: 'store_cand_a',
    title: 'Candidate A Title',
    priority: 'single_registration' as const,
    score: 0,
    registrations: ['Mod A'],
    evidence: ['v1.0'],
    reason: 'single',
  };

  const regA = { name: 'Mod A', source: 'game/Submods/multi/a.rpy', unknown: false };
  const regB = { name: 'Mod B', source: 'game/Submods/multi/b.rpy', unknown: false };
  const regUnk = { name: '', source: 'game/Submods/multi/unk.rpy', unknown: true };

  assert.equal(matchRegistrationToCandidate(regA, candidate), true);
  assert.equal(matchRegistrationToCandidate(regB, candidate), false);
  assert.equal(matchRegistrationToCandidate(regUnk, candidate), false);

  const allPaths = [
    'game/Submods/multi/a.rpy',
    'game/Submods/multi/b.rpy',
    'game/Submods/multi/a.rpyc',
    'game/Submods/multi/asset.png',
  ];

  const matchedPaths = getCandidateRegistrationPaths(candidate, [regA, regB, regUnk], allPaths);
  assert.deepEqual(matchedPaths, ['game/Submods/multi/a.rpy']);
});

test('AdoptModal: strict candidate registration matching rejects title fallback, id fallback, and case differences', () => {
  // Store candidate A has registration ["Actual A"], Mod ID "store_cand_a", and Title "Mod B"
  const candidate = {
    mod_id: 'store_cand_a',
    title: 'Mod B',
    priority: 'single_registration' as const,
    score: 0,
    registrations: ['Actual A'],
    evidence: ['v1.0'],
    reason: 'single',
  };

  // 1. Same as candidate title ("Mod B") -> must NOT match (title fallback removed)
  const regTitle = { name: 'Mod B', source: 'game/Submods/multi/b.rpy', unknown: false };
  assert.equal(matchRegistrationToCandidate(regTitle, candidate), false);

  // 2. Same as candidate mod_id ("store_cand_a") -> must NOT match (mod_id fallback removed)
  const regModId = { name: 'store_cand_a', source: 'game/Submods/multi/id.rpy', unknown: false };
  assert.equal(matchRegistrationToCandidate(regModId, candidate), false);

  // 3. Only case differences ("actual a" vs "Actual A") -> must NOT match (strict case sensitivity)
  const regLower = { name: 'actual a', source: 'game/Submods/multi/case.rpy', unknown: false };
  assert.equal(matchRegistrationToCandidate(regLower, candidate), false);

  // 4. Exact case-sensitive match with candidate registrations -> must match
  const regExact = { name: 'Actual A', source: 'game/Submods/multi/a.rpy', unknown: false };
  assert.equal(matchRegistrationToCandidate(regExact, candidate), true);
});

test('AdoptModal: multi-registration ambiguous candidates default to empty file selection (0 / N)', () => {
  const item = makeMockUnmanagedItem({
    registrations: [
      { name: 'Mod A', source: 'game/Submods/multi/a.rpy', unknown: false },
      { name: 'Mod B', source: 'game/Submods/multi/b.rpy', unknown: false },
    ],
    unmanaged_paths: [
      'game/Submods/multi/a.rpy',
      'game/Submods/multi/b.rpy',
      'game/Submods/multi/asset.png',
    ],
    match_status: 'ambiguous',
    match_candidates: [
      {
        mod_id: 'store_cand_a',
        title: 'Candidate A',
        priority: 'multi_registration',
        score: 1,
        registrations: ['Mod A'],
        evidence: ['v1.0'],
        reason: 'multi',
      },
      {
        mod_id: 'store_cand_b',
        title: 'Candidate B',
        priority: 'multi_registration',
        score: 1,
        registrations: ['Mod B'],
        evidence: ['v1.0'],
        reason: 'multi',
      },
    ],
  });

  const html = renderToStaticMarkup(
    <AdoptModal
      item={item}
      onClose={() => {}}
      onConfirmAdopt={() => {}}
    />
  );

  // Ambiguous candidates must NOT blindly pre-select conflicting registration files
  assert.ok(html.includes('纳入收养范围的文件清单 (0 / 3)'));
  assert.ok(html.includes('存在歧义候选模组'));
});

test('AdoptModal: single matched candidate defaults only to that candidate registration source', () => {
  const item = makeMockUnmanagedItem({
    registrations: [
      { name: 'Mod A', source: 'game/Submods/multi/a.rpy', unknown: false },
      { name: 'Mod B', source: 'game/Submods/multi/b.rpy', unknown: false },
    ],
    unmanaged_paths: [
      'game/Submods/multi/a.rpy',
      'game/Submods/multi/b.rpy',
      'game/Submods/multi/asset.png',
    ],
    match_status: 'matched',
    match_candidates: [
      {
        mod_id: 'store_cand_a',
        title: 'Candidate A',
        priority: 'single_registration',
        score: 0,
        registrations: ['Mod A'],
        evidence: ['v1.0'],
        reason: 'single',
      },
    ],
  });

  const html = renderToStaticMarkup(
    <AdoptModal
      item={item}
      onClose={() => {}}
      onConfirmAdopt={() => {}}
    />
  );

  // Only candidate A's registration file (a.rpy) is selected by default (1 / 3), NOT b.rpy
  assert.ok(html.includes('纳入收养范围的文件清单 (1 / 3)'));
  assert.ok(!html.includes('模组身份与文件归属冲突'));
});

test('AdoptModal: multi-registration with missing candidate registration displays validation banner and disables confirm button', () => {
  // If item has candidate A, but only foreign registration b.rpy is unmanaged path (a.rpy is missing from unmanaged paths)
  const item = makeMockUnmanagedItem({
    registrations: [
      { name: 'Mod A', source: 'game/Submods/multi/a.rpy', unknown: false },
      { name: 'Mod B', source: 'game/Submods/multi/b.rpy', unknown: false },
    ],
    unmanaged_paths: [
      'game/Submods/multi/b.rpy',
    ],
    match_status: 'matched',
    match_candidates: [
      {
        mod_id: 'store_cand_a',
        title: 'Candidate A',
        priority: 'single_registration',
        score: 0,
        registrations: ['Mod A'],
        evidence: ['v1.0'],
        reason: 'single',
      },
    ],
  });

  const html = renderToStaticMarkup(
    <AdoptModal
      item={item}
      onClose={() => {}}
      onConfirmAdopt={() => {}}
    />
  );

  // Error banner must be rendered because candidate A has no verified registration in selected files
  assert.ok(html.includes('模组身份与文件归属冲突'));
  assert.ok(html.includes('所选文件中未包含候选模组的有效注册来源文件，归属不明确，禁止提交。'));
  // Confirm button must be disabled
  assert.ok(html.includes('disabled=""'));
});

test('AdoptModal: candidate validation rejects title-matching foreign registration', () => {
  // Candidate A has registrations: ['Actual A'] and title: 'Mod B'
  const item = makeMockUnmanagedItem({
    registrations: [
      { name: 'Mod B', source: 'game/Submods/multi/b.rpy', unknown: false },
    ],
    unmanaged_paths: [
      'game/Submods/multi/b.rpy',
    ],
    match_status: 'matched',
    match_candidates: [
      {
        mod_id: 'cand_a',
        title: 'Mod B', // Title matches registration name of b.rpy
        priority: 'single_registration',
        score: 0,
        registrations: ['Actual A'],
        evidence: ['v1.0'],
        reason: 'single',
      },
    ],
  });

  const html = renderToStaticMarkup(
    <AdoptModal
      item={item}
      onClose={() => {}}
      onConfirmAdopt={() => {}}
    />
  );

  // Even though candidate Title is 'Mod B', b.rpy only registers 'Mod B' which does not belong to Candidate A's registrations ['Actual A'].
  // Therefore, candidate registration paths for Candidate A is empty (0/1 selected), and validation blocks adoption.
  assert.ok(html.includes('模组身份与文件归属冲突'));
  assert.ok(html.includes('所选文件中未包含候选模组的有效注册来源文件，归属不明确，禁止提交。'));
  assert.ok(html.includes('disabled=""'));
});
