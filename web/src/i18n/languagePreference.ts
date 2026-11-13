/**
 * 语言偏好的纯函数实现（不 import React）。
 *
 * 抽出来的原因：初始语言的判定规则（存储 > 浏览器 > 默认）是产品契约，
 * 也是唯一可能在无 DOM 环境里被验证的部分；组件层只负责把结果接进 context。
 *
 * 新增键/改规则时只改这里，I18nContext 与测试都跟着走。
 */
import {
  DEFAULT_LANG,
  LANG_STORAGE_KEY,
  type Lang,
  isLang,
} from './types';

/** 最小化的存储接口，方便在 node 测试里传假实现。 */
export interface LangStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 把 `en-US` / `zh-Hant-TW` / `EN` 这类原始标签收敛成受支持的语言。
 * 无法识别时返回 null，由调用方决定回退到哪。
 */
export function normalizeLangTag(tag: string | null | undefined): Lang | null {
  if (!tag) return null;
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0];
  if (!primary) return null;
  if (primary === 'zh') return 'zh';
  if (primary === 'en') return 'en';
  return null;
}

/** 读取已保存的语言偏好；不存在或不是受支持语言时返回 null。 */
export function readStoredLang(storage: LangStorage | null | undefined): Lang | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LANG_STORAGE_KEY);
    return isLang(raw) ? raw : null;
  } catch {
    // 隐私模式/禁用存储时 getItem 会抛错：语言偏好不该因此让页面崩掉。
    return null;
  }
}

/** 写入语言偏好。写失败（配额、隐私模式）时静默放弃，内存里的语言仍然生效。 */
export function persistLang(storage: LangStorage | null | undefined, lang: Lang): void {
  if (!storage) return;
  try {
    storage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* 忽略：偏好保存失败不影响本次会话 */
  }
}

/**
 * 按浏览器语言列表挑选：任何一个偏好以 `en` 开头 → en，否则 zh。
 *
 * 只看主语言标签：`en-GB`、`en-US` 都算 en；`zh-CN`、`zh-TW` 都算 zh；
 * 出现 `ja`、`fr` 这类不支持的偏好时跳过，继续看下一个。
 * 全部不支持（或传入 null）→ 默认中文，而不是英文：站点主体面向中文用户。
 */
export function detectInitialLang(languages: readonly string[] | null | undefined): Lang {
  if (!languages) return DEFAULT_LANG;
  // 「任何一个偏好以 en 开头 → en」优先于 zh：浏览器列表里常见
  // `['en-US', 'zh-CN']`（在英文系统上用中文阅读），这种用户按英文进入。
  // 不支持的偏好（ja、fr…）跳过，继续看下一个；全都不认识才回默认中文。
  if (languages.some((tag) => normalizeLangTag(tag) === 'en')) return 'en';
  return DEFAULT_LANG;
}

/** 存储里的显式选择优先于浏览器；都没有时按浏览器判定。 */
export function resolveLangPreference(options: {
  stored?: string | null;
  languages?: readonly string[] | null;
}): Lang {
  const stored = options.stored;
  if (isLang(stored)) return stored;
  return detectInitialLang(options.languages);
}

/** 当前环境的浏览器语言列表；SSR / 无 navigator 时返回 null。 */
export function browserLanguages(): readonly string[] | null {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  if (!nav) return null;
  if (Array.isArray(nav.languages) && nav.languages.length > 0) return nav.languages;
  return nav.language ? [nav.language] : null;
}

/** 本地存储的封装：不可用时返回 null（调用方据此跳过持久化）。 */
export function defaultStorage(): LangStorage | null {
  try {
    const storage = (globalThis as { localStorage?: LangStorage }).localStorage;
    return storage ?? null;
  } catch {
    return null;
  }
}
