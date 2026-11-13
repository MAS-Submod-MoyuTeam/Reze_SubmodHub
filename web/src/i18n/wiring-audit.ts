/**
 * 多语言接线的审计内核。
 *
 * 单独成模块（而不是写在测试文件里），是为了让 `wiring.test.ts`（断言规则）
 * 和 `wiring-baseline.test.ts`（断言欠账清单没过期）共用同一套扫描逻辑，
 * 又不会因为 import 一个测试文件而把它的用例重复跑一遍。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

export const CJK = /[\u4e00-\u9fff]/;
const KEY_DEF = /^\s{2}'([^']+)':/;

/** 递归收集源码文件，跳过测试、字典与 node_modules。 */
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'messages' || entry === 'dist') continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      if (/\.test\.(ts|tsx)$/.test(entry)) continue;
      out.push(full);
    }
  };
  walk(root);
  return out;
}

function dictionaryFiles(messagesDir: string): string[] {
  return readdirSync(messagesDir)
    .filter((name) => /^(zh|en).*\.ts$/.test(name))
    .map((name) => join(messagesDir, name));
}

/** 一个字典文件里的 key -> 该键的整段文本（含多行）。 */
function entriesOf(file: string): Map<string, string> {
  const lines = readFileSync(file, 'utf-8').split('\n');
  const out = new Map<string, string>();
  let current: string | null = null;
  let buffer: string[] = [];
  for (const line of lines) {
    const match = KEY_DEF.exec(line);
    if (match) {
      if (current) out.set(current, buffer.join('\n'));
      current = match[1];
      buffer = [line];
    } else if (current) {
      buffer.push(line);
    }
  }
  if (current) out.set(current, buffer.join('\n'));
  return out;
}

const placeholders = (text: string) => new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));

/**
 * 去注释后的代码行。
 *
 * 三种注释都要处理，否则 jsx 里的跨行注释会被误判为「代码中的中文字面量」：
 *   - 行注释（双斜杠），含 `; // 说明` 这种行尾注释
 *   - 块注释（斜杠星号 … 星号斜杠），含文档注释
 *   - jsx 注释，即花括号包住的块注释，经常跨行
 * 行尾注释用逐字符扫描而不是正则，因为要区分真的注释和字符串里的 `https://`。
 */
function codeLines(file: string): { line: number; code: string }[] {
  const out: { line: number; code: string }[] = [];
  let inBlock = false;
  readFileSync(file, 'utf-8').split('\n').forEach((raw, index) => {
    let code = raw;
    if (inBlock) {
      const closeAt = code.indexOf('*/');
      if (closeAt === -1) return;
      code = code.slice(closeAt + 2);
      inBlock = false;
    }
    // 同一行里可能先关后开，循环处理到本行稳定为止。
    for (;;) {
      const open = code.indexOf('/*');
      if (open === -1) break;
      const close = code.indexOf('*/', open + 2);
      if (close === -1) {
        code = code.slice(0, open);
        inBlock = true;
        break;
      }
      code = code.slice(0, open) + code.slice(close + 2);
    }
    let quote: string | null = null;
    for (let i = 0; i < code.length; i += 1) {
      const ch = code[i];
      if (quote) {
        if (ch === '\\') i += 1;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch;
        continue;
      }
      if (ch === '/' && code[i + 1] === '/') {
        code = code.slice(0, i);
        break;
      }
    }
    if (!code.trim()) return;
    out.push({ line: index + 1, code });
  });
  return out;
}

/**
 * 从代码里收集被引用的键。
 *
 * 覆盖 `t('x')` / `t("x")`，以及 `t(\`a.${b}\`)` 这种模板串：模板串的静态前缀
 * 用通配前缀匹配，只要字典里有同前缀的键就算通过。
 * 注意 `t(someVar)` 这种动态调用无法静态判定，对应键会进「孤儿」清单——
 * 这类键需要在 wiring-baseline.ts 里登记并写明原因。
 */
function referencedKeys(files: string[]): { exact: Set<string>; prefixes: Set<string> } {
  const exact = new Set<string>();
  const prefixes = new Set<string>();
  for (const file of files) {
    for (const { code } of codeLines(file)) {
      for (const match of code.matchAll(/\bt\(\s*'([^']+)'/g)) exact.add(match[1]);
      for (const match of code.matchAll(/\bt\(\s*"([^"]+)"/g)) exact.add(match[1]);
      for (const match of code.matchAll(/\bt\(\s*`([^`$]*)\$\{/g)) {
        if (match[1].includes('.')) prefixes.add(match[1]);
      }
    }
  }
  return { exact, prefixes };
}

export type Audit = {
  missing: string[];
  unresolvedPrefix: string[];
  onlyZh: string[];
  onlyEn: string[];
  placeholderMismatch: string[];
  unused: string[];
  cjk: string[];
};

export function auditUi(root: string | string[], messagesDir: string): Audit {
  const roots = Array.isArray(root) ? root : [root];
  const files = roots.flatMap((dir) => sourceFiles(dir));

  const zh = new Map<string, string>();
  for (const file of dictionaryFiles(messagesDir).filter((f) => /[\\/]zh/.test(f))) {
    for (const [k, v] of entriesOf(file)) zh.set(k, v);
  }
  const en = new Map<string, string>();
  for (const file of dictionaryFiles(messagesDir).filter((f) => /[\\/]en/.test(f))) {
    for (const [k, v] of entriesOf(file)) en.set(k, v);
  }

  const { exact, prefixes } = referencedKeys(files);

  const missing = [...exact].filter((key) => !zh.has(key)).sort();
  const unresolvedPrefix = [...prefixes].filter(
    (prefix) => ![...zh.keys()].some((key) => key.startsWith(prefix)),
  );

  const onlyZh = [...zh.keys()].filter((k) => !en.has(k)).sort();
  const onlyEn = [...en.keys()].filter((k) => !zh.has(k)).sort();

  const placeholderMismatch = [...zh.keys()]
    .filter((k) => en.has(k))
    .filter((k) => {
      const a = placeholders(zh.get(k)!);
      const b = placeholders(en.get(k)!);
      return a.size !== b.size || [...a].some((p) => !b.has(p));
    })
    .sort();

  const unused = [...zh.keys()].filter((key) => {
    if (exact.has(key)) return false;
    return ![...prefixes].some((prefix) => key.startsWith(prefix));
  }).sort();

  const cjk: string[] = [];
  for (const file of files) {
    for (const { line, code } of codeLines(file)) {
      if (!CJK.test(code)) continue;
      // 这些文件里的中文是「数据」而不是「界面文案」：
      // - catalogPlatforms：平台筛选值本身就是专有名词
      // - modHealth：占位版本号集合，与游戏版本号一一对应
      // - i18n/types.ts：语言选择器上每种语言的自称（中文写「简体中文」，
      //   英文写「English」），本来就该用该语言自己的写法，不能跟着界面语言变。
      const relRoot = roots.find((dir) => file.startsWith(dir)) ?? roots[0];
      const rel = relative(relRoot, file).replace(/\\/g, '/');
      if (rel.endsWith('catalogPlatforms.ts') || rel.endsWith('modHealth.ts') || rel.endsWith('i18n/types.ts')) {
        continue;
      }
      // 共享层要带上前缀，否则白名单里的路径匹配不到。
      const shown = roots.length > 1 && relRoot !== roots[0] ? `${basename(relRoot)}/${rel}` : rel;
      cjk.push(`${shown}:${line}: ${code.trim().slice(0, 100)}`);
    }
  }

  return { missing, unresolvedPrefix, onlyZh, onlyEn, placeholderMismatch, unused, cjk };
}
