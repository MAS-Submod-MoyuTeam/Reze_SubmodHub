/**
 * 多语言接线的静态不变量。
 *
 * 这些规则不是「风格偏好」，每一条都对应过真实漏译：
 *
 * 1. `t('x')` 引用的键必须存在于字典里 —— 漏键时界面会直接把键名当文案显示。
 * 2. zh / en 键集合必须完全一致 —— 迁移时曾漏了 `reviewer.archiveUnavailablePlatform`。
 * 3. 同一键的 `{placeholder}` 集合必须一致 —— en 侧漏 `{count}` 时英文会少一段信息。
 * 4. 字典里存在的键必须真有人用 —— 否则「补了键但没接线」会被误认为已完成。
 * 5. 非注释代码里不该出现中文 UI 字面量 —— 这是最容易被 grep 批量替换漏掉的一类。
 *
 * 已登记的欠账见 `wiring-baseline.ts`，由 `wiring-baseline.test.ts` 保证只减不增。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditUi } from './wiring-audit';
import { KNOWN_CJK_FILES, KNOWN_UNUSED_KEYS, KNOWN_UNUSED_KEYS_DESKTOP } from './wiring-baseline';

/** 已登记欠账。守卫只报「新增」违规，不报已登记的那些。 */
const ALLOW_UNUSED = new Set<string>([
  // dictionary.test.ts 的跨组件必备词汇：即使当前没有组件引用也必须存在。
  'common.save',
  'common.cancel',
  'common.delete',
  'common.confirm',
  'common.close',
  'common.loading',
  'common.error',
  ...KNOWN_UNUSED_KEYS,
  ...KNOWN_UNUSED_KEYS_DESKTOP,
]);
const ALLOW_CJK = KNOWN_CJK_FILES;

// 从本文件位置上跳三级即为仓库根：i18n -> src -> web -> 仓库根。
// 用 `fileURLToPath` 而非 `URL.pathname`：后者在 Windows 上会留下 %20 之类的转义。
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

for (const [label, root, messages, extraRoots] of [
  // `ui/` 是两端共享的纯逻辑层，`describeTagFilterLocalized(..., t)` 这类函数
  // 从外部接收 `t` 并引用字典键，所以扫描范围必须包含它。
  ['web', 'web/src', 'web/src/i18n/messages', ['ui']],
  ['desktop', 'clients/desktop/src', 'clients/desktop/src/i18n/messages', []],
] as const) {
  const audit = () =>
    auditUi([root, ...extraRoots].map((r) => join(repoRoot, r)), join(repoRoot, messages));

  test(`${label}: 引用的键都存在于字典，且 zh/en 完全对齐`, () => {
    const result = audit();
    assert.deepEqual(result.missing, [], `引用了不存在的键（界面会显示键名本身）：${result.missing.join(', ')}`);
    assert.deepEqual(result.unresolvedPrefix, [], `模板串前缀匹配不到任何键：${result.unresolvedPrefix.join(', ')}`);
    assert.deepEqual(result.onlyZh, [], `这些键只有中文：${result.onlyZh.join(', ')}`);
    assert.deepEqual(result.onlyEn, [], `这些键只有英文：${result.onlyEn.join(', ')}`);
    assert.deepEqual(
      result.placeholderMismatch,
      [],
      `这些键的占位符在 zh/en 之间不一致：${result.placeholderMismatch.join(', ')}`,
    );
  });

  test(`${label}: 没有「补了键却没接线」的孤儿键`, () => {
    const result = audit();
    const unexpected = result.unused.filter((key) => !ALLOW_UNUSED.has(key));
    assert.deepEqual(
      unexpected,
      [],
      `字典里有这些键但没人用（说明接线漏了，或键该删）：${unexpected.join(', ')}`,
    );
  });

  test(`${label}: 非注释代码里没有中文 UI 字面量`, () => {
    const result = audit();
    const unexpected = result.cjk.filter((hit) => !ALLOW_CJK.some((allow) => hit.includes(allow.file)));
    assert.deepEqual(
      unexpected,
      [],
      `这些地方仍有硬编码中文，切到英文时不会翻译：\n${unexpected.join('\n')}`,
    );
  });
}
