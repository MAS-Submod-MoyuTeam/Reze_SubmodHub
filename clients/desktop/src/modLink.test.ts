import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeLinkedMod,
  findCatalogMod,
  resolveDeepLinkMod,
  shouldPromptClipboardLink,
} from './modLink.js';
import type { ModSummary } from './types/client.js';

const mod = (id: string, title: string) => ({ id, title } as ModSummary);

test('从目录里按 id 找模组，找不到返回 null', () => {
  const catalog = [mod('mod_a', 'A'), mod('mod_b', 'B')];
  assert.equal(findCatalogMod('mod_b', catalog)?.title, 'B');
  assert.equal(findCatalogMod('mod_missing', catalog), null);
  assert.equal(findCatalogMod('', catalog), null);
  assert.equal(findCatalogMod('mod_a', []), null);
});

test('同一链接不重复提示；正在看该模组时不提示；有未处理提示时不叠加', () => {
  const base = { lastPromptedModID: null, openModID: null, promptOpen: false };
  assert.equal(shouldPromptClipboardLink('mod_a', base), true);
  assert.equal(shouldPromptClipboardLink('mod_a', { ...base, lastPromptedModID: 'mod_a' }), false);
  assert.equal(shouldPromptClipboardLink('mod_b', { ...base, lastPromptedModID: 'mod_a' }), true);
  // 已经打开着这个模组：提示只是打断。
  assert.equal(shouldPromptClipboardLink('mod_a', { ...base, openModID: 'mod_a' }), false);
  assert.equal(shouldPromptClipboardLink('mod_a', { ...base, promptOpen: true }), false);
  assert.equal(shouldPromptClipboardLink('', base), false);
});

test('深链命中目录时给出真实 ModSummary', () => {
  const resolved = resolveDeepLinkMod('mod_b', [mod('mod_a', 'A'), mod('mod_b', 'B')], { catalogLoaded: true });
  assert.equal(resolved.kind, 'open');
  assert.equal(resolved.kind === 'open' ? resolved.mod.title : '', 'B');
});

test('目录还没加载完时不下「已下架」的结论', () => {
  assert.deepEqual(resolveDeepLinkMod('mod_b', [], { catalogLoaded: false }), { kind: 'none' });
});

test('目录已加载但查不到时明确报告缺失', () => {
  assert.deepEqual(
    resolveDeepLinkMod('mod_gone', [mod('mod_a', 'A')], { catalogLoaded: true }),
    { kind: 'missing', modID: 'mod_gone' },
  );
});

test('目录加载成功但为空时，深链仍然要落到「缺失」而不是一直等', () => {
  // 「空目录」和「目录还没到」是两件事：前者是结论，后者只是还没结论。
  // 若把「条数不为零」当成加载判断，这里会永远返回 none，用户永远等不到提示。
  assert.deepEqual(resolveDeepLinkMod('mod_gone', [], { catalogLoaded: true }), {
    kind: 'missing',
    modID: 'mod_gone',
  });
});

test('没有 mod id 时什么都不做', () => {
  assert.deepEqual(resolveDeepLinkMod(null, [mod('mod_a', 'A')], { catalogLoaded: true }), { kind: 'none' });
  assert.deepEqual(resolveDeepLinkMod('', [mod('mod_a', 'A')], { catalogLoaded: true }), { kind: 'none' });
});

test('提示文案优先用标题，查不到才退回 id', () => {
  const catalog = [mod('mod_a', '漂亮衣服')];
  assert.equal(describeLinkedMod('mod_a', catalog), '漂亮衣服');
  assert.equal(describeLinkedMod('mod_unknown', catalog), 'mod_unknown');
  assert.equal(describeLinkedMod('mod_blank', [mod('mod_blank', '   ')]), 'mod_blank');
});
