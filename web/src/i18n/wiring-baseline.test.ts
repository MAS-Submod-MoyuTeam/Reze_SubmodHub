/**
 * 基线自检：保证 `wiring-baseline.ts` 里的欠账清单不会腐化成摆设。
 *
 * 两条规则互为保险：
 *
 * 1. 清单里的每一条都必须**仍然真的违规**。修好了却忘记从清单删除，
 *    这条就会红——否则清单会一直膨胀，渐渐把守卫淹没。
 * 2. 清单条目必须**仍然存在于字典/源码**。键被删掉了、文件被重命名了，
 *    清单里留着幽灵条目同样会让第 1 条失去意义。
 *
 * 换句话说：这个测试失败时，通常不是「基线错了」，而是「你该收债了」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_CJK_FILES, KNOWN_UNUSED_KEYS } from './wiring-baseline';
import { auditUi } from './wiring-audit';

// web/src/i18n/x.test.ts 相对仓库根是三层上跳：i18n -> src -> web -> 仓库根。
  // 注意末尾必须保留斜杠，否则 `join` 会把 web 段吃掉。
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

test('孤儿键基线里没有幽灵条目：每个键都还在字典里', () => {
  const dictDir = join(repoRoot, 'web/src/i18n/messages');
  const all = ['zh.ts', 'zh-author.ts', 'zh-workbench.ts']
    .map((f) => readFileSync(join(dictDir, f), 'utf-8'))
    .join('\n');
  const ghosts = KNOWN_UNUSED_KEYS.filter((key) => !all.includes(`'${key}':`));
  assert.deepEqual(
    ghosts,
    [],
    `这些键已从字典消失，请从 wiring-baseline.ts 删除：${ghosts.join(', ')}`,
  );
});

test('孤儿键基线只应缩短：每条都必须仍然真的没人用', () => {
  const result = auditUi([join(repoRoot, 'web/src'), join(repoRoot, 'ui')], join(repoRoot, 'web/src/i18n/messages'));
  const live = new Set(result.unused);
  const alreadyFixed = KNOWN_UNUSED_KEYS.filter((key) => !live.has(key));
  assert.deepEqual(
    alreadyFixed,
    [],
    `这些键现在已被引用，说明接线补好了。请从 wiring-baseline.ts 删除：${alreadyFixed.join(', ')}`,
  );
});

test('中文残留基线只应缩短：每个文件都必须仍然真的含中文', () => {
  const result = auditUi([join(repoRoot, 'web/src'), join(repoRoot, 'ui')], join(repoRoot, 'web/src/i18n/messages'));
  const live = new Set(result.cjk);
  const stale = KNOWN_CJK_FILES.filter(
    (entry) => ![...live].some((hit) => hit.includes(entry.file)),
  ).map((entry) => entry.file);
  assert.deepEqual(
    stale,
    [],
    `这些文件已经没有硬编码中文了。请从 wiring-baseline.ts 删除：${stale.join(', ')}`,
  );
});
