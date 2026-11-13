/**
 * 语言 context 与 hook。
 *
 * 唯一的语言状态来源：`lang` / `setLang`，以及两个取值入口
 * - `t(key, vars)`   界面文案（来自 dictionary）
 * - `resolve(text)`  服务端下发的模组/标签多语言文本
 *
 * 纯逻辑（初始语言、插值、回退链）在 languagePreference.ts / translate.ts。
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { LANG_STORAGE_KEY, DEFAULT_LANG, type Lang, type LocalizedText, type TVars } from './types';
import {
  browserLanguages,
  defaultStorage,
  normalizeLangTag,
  persistLang,
  readStoredLang,
  resolveLangPreference,
} from './languagePreference';
import { applyDocumentLang, resolveLocalized, translate } from './translate';

export interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** 文案查表 + `{name}` 插值；缺失时回退中文，再回退键名。 */
  t: (key: string, vars?: TVars) => string;
  /** 渲染服务端多语言文本的唯一入口：请求语言 → 中文 → 第一个非空值 → ''。 */
  resolve: (text: LocalizedText | string | null | undefined) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/** 首帧就定好语言，避免先渲染中文再闪一下英文。 */
function initialLang(): Lang {
  return resolveLangPreference({ stored: readStoredLang(defaultStorage()), languages: browserLanguages() });
}

export const LangProvider: React.FC<{ children: React.ReactNode; initialLang?: Lang }> = ({
  children,
  initialLang: initial,
}) => {
  const [lang, setLangState] = useState<Lang>(initial ?? initialLang);

  useEffect(() => {
    applyDocumentLang(lang);
  }, [lang]);

  // 同一外壳里多个窗口（或与 Web 商店同域）切换语言时保持一致。
  useEffect(() => {
    const target = (globalThis as { window?: Window }).window;
    const storage = defaultStorage();
    if (!target || !storage) return undefined;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LANG_STORAGE_KEY) return;
      const next = normalizeLangTag(event.newValue);
      if (next) setLangState(next);
    };
    target.addEventListener('storage', onStorage);
    return () => target.removeEventListener('storage', onStorage);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    persistLang(defaultStorage(), next);
  }, []);

  const value = useMemo<I18nContextValue>(() => ({
    lang,
    setLang,
    t: (key: string, vars?: TVars) => translate(lang, key, vars),
    resolve: (text) => resolveLocalized(text, lang),
  }), [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

/**
 * 取当前语言与取值函数。
 *
 * Provider 之外调用返回一个以默认语言（中文）工作的实现，而不是抛错：
 * 只关心 `t()` 的组件因此能在孤立测试里直接渲染。
 */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  return {
    lang: DEFAULT_LANG,
    setLang: () => {},
    t: (key: string, vars?: TVars) => translate(DEFAULT_LANG, key, vars),
    resolve: (text) => resolveLocalized(text, DEFAULT_LANG),
  };
}
