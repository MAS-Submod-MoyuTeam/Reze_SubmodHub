/**
 * 初始语言判定的纯函数。
 *
 * 客户端运行在 Wails 外壳里：`document` / `localStorage` 在 jsdom 测试里存在，
 * 但在极简测试环境里可能不存在，所以每次访问都先确认可用。
 */

import { DEFAULT_LANG, LANG_STORAGE_KEY, SUPPORTED_LANGS, type Lang } from './types';

/** 最小存储接口：只用到这两个方法，测试可以传内存实现。 */
export interface LangStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 当前环境的 localStorage；不可用时返回 null（隐私模式、非浏览器环境）。 */
export function defaultStorage(): LangStorage | null {
  try {
    const candidate = (globalThis as { localStorage?: LangStorage }).localStorage;
    if (!candidate) return null;
    // 访问一次以触发隐私模式下的异常，而不是等到写入时才炸。
    candidate.getItem(LANG_STORAGE_KEY);
    return candidate;
  } catch {
    return null;
  }
}

/** `en-US` → `en`；不认识的值返回 null。 */
export function normalizeLangTag(raw: string | null | undefined): Lang | null {
  if (!raw) return null;
  const primary = raw.trim().toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_LANGS as readonly string[]).includes(primary) ? (primary as Lang) : null;
}

export function readStoredLang(storage: LangStorage | null): Lang | null {
  if (!storage) return null;
  try {
    return normalizeLangTag(storage.getItem(LANG_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function persistLang(storage: LangStorage | null, lang: Lang): void {
  if (!storage) return;
  try {
    storage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // 写不进去不影响本次会话的语言：只是下次启动会重新按浏览器判定。
  }
}

/** 浏览器的语言偏好；没有 navigator 时返回空数组。 */
export function browserLanguages(): readonly string[] {
  const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
  if (!nav) return [];
  if (Array.isArray(nav.languages) && nav.languages.length > 0) return nav.languages;
  return nav.language ? [nav.language] : [];
}

/**
 * 判定顺序：手动选择（localStorage）→ 浏览器偏好 → 中文。
 *
 * 浏览器偏好只认日语/英文之外的支持项：只有首选链里明确出现英文时才用英文，
 * 其余一律中文——一半英文一半中文比完整中文更难读。
 */
export function resolveLangPreference(input: {
  stored?: Lang | null;
  languages?: readonly string[] | null;
}): Lang {
  if (input.stored) return input.stored;
  for (const raw of input.languages ?? []) {
    const lang = normalizeLangTag(raw);
    if (lang) return lang;
  }
  return DEFAULT_LANG;
}

/** 一次性拿到「该用什么语言」。 */
export function detectInitialLang(): Lang {
  return resolveLangPreference({ stored: readStoredLang(defaultStorage()), languages: browserLanguages() });
}
