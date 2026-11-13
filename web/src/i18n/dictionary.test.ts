import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 词典契约。
 *
 * 三种语言的文件必须键集合完全一致：单边缺键时界面会退回到中文或键名本身，
 * 这类问题只在「刚好切到那个语言的那一屏」才看得见，评审几乎发现不了，
 * 所以让测试在提交前就把缺的键全部列出来。
 */

const here = dirname(fileURLToPath(import.meta.url));

/** 从 source 里取出 `'a.b': '…'` 形式的键（避免为了测试去跑 TS 转译）。 */
function keysIn(file: string): string[] {
  const source = readFileSync(join(here, file), 'utf8');
  const body = source.slice(source.indexOf('export const'));
  return [...body.matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1]);
}

const LANGS = ['zh', 'en'] as const;
const keysByLang = Object.fromEntries(LANGS.map((lang) => [lang, keysIn(`messages/${lang}.ts`)])) as Record<
  (typeof LANGS)[number],
  string[]
>;

const missingIn = (lang: (typeof LANGS)[number]) =>
  LANGS.filter((other) => other !== lang).flatMap((other) =>
    keysByLang[other].filter((key) => !keysByLang[lang].includes(key)).map((key) => `${key} (missing in ${lang})`),
  );

test('每个键在 zh 与 en 中都存在', () => {
  const problems = LANGS.flatMap((lang) => missingIn(lang));
  assert.deepEqual(problems, [], `双语键集合不一致：\n${problems.join('\n')}`);
});

test('键不重复（重复的键会静默覆盖前一条）', () => {
  for (const lang of LANGS) {
    const seen = new Set<string>();
    const duplicates = keysByLang[lang].filter((key) => (seen.has(key) ? true : (seen.add(key), false)));
    assert.deepEqual(duplicates, [], `${lang} 里重复的键：${duplicates.join(', ')}`);
  }
});

test('键名符合「名字空间.语义」的点分约定', () => {
  const bad = LANGS.flatMap((lang) =>
    keysByLang[lang].filter((key) => !/^[a-z][A-Za-z0-9]*(\.[a-zA-Z0-9]+)+$/.test(key)).map((key) => `${lang}:${key}`),
  );
  assert.deepEqual(bad, [], `不合规的键名：\n${bad.join('\n')}`);
});

test('common.* 的必备键都在', () => {
  const required = ['save', 'cancel', 'delete', 'confirm', 'close', 'loading', 'error'].map((name) => `common.${name}`);
  for (const lang of LANGS) {
    const missing = required.filter((key) => !keysByLang[lang].includes(key));
    assert.deepEqual(missing, [], `${lang} 缺少的 common 键：${missing.join(', ')}`);
  }
});

test('没有空文案：空值会让按钮变成空白', () => {
  for (const lang of LANGS) {
    const source = readFileSync(join(here, `messages/${lang}.ts`), 'utf8');
    const empties = [...source.matchAll(/^\s*'([^']+)':\s*'',?$/gm)].map((match) => match[1]);
    assert.deepEqual(empties, [], `${lang} 里的空文案：${empties.join(', ')}`);
  }
});
