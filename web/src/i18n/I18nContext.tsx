/**
 * 语言 context 与 hook。
 *
 * 这里是唯一的语言状态来源：`lang`、`setLang`，以及两个取值入口
 * - `t(key, vars)`     界面文案（来自 dictionary）
 * - `resolve(text)`    服务端下发的模组/标签多语言文本
 *
 * 纯逻辑（初始语言判定、插值、回退链）都在 languagePreference.ts /
 * translate.ts 里，本文件只做 React 接线，方便测试纯函数。
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
  /** 当前界面语言。 */
  lang: Lang;
  /** 切换语言；会持久化到 localStorage。 */
  setLang: (lang: Lang) => void;
  /** 文案查表 + `{name}` 插值。缺失时依次回退 en 之外的中文，再回退键名本身。 */
  t: (key: string, vars?: TVars) => string;
  /** 渲染服务端多语言文本的唯一入口：请求语言 → 中文 → 第一个非空值 → ''。 */
  resolve: (text: LocalizedText | string | null | undefined) => string;
  /** `t` 的别名糖：format(template, vars) 与 t(key, vars) 完全等价。 */
  format: (key: string, vars?: TVars) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

/** 首帧就定好语言，避免先渲染中文再闪一下英文。 */
function initialLang(): Lang {
  return resolveLangPreference({
    stored: readStoredLang(defaultStorage()),
    languages: browserLanguages(),
  });
}

export const LangProvider: React.FC<{ children: React.ReactNode; initialLang?: Lang }> = ({
  children,
  initialLang: initial,
}) => {
  const [lang, setLangState] = useState<Lang>(initial ?? initialLang);

  // `<html lang>` 同时决定读屏发音与 CJK 字体的字形选择，必须跟着语言走。
  // 标题与 meta 描述一并改写：`index.html` 里只能写死一种语言，而浏览器标签页
  // 和分享卡片都是用户可见的。
  useEffect(() => {
    applyDocumentLang(lang, (key) => translate(lang, key));
  }, [lang]);

  // 同一浏览器多标签页时保持一致：另一个标签切换语言，这里跟着变。
  useEffect(() => {
    const storage = defaultStorage();
    if (typeof window === 'undefined' || !storage) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LANG_STORAGE_KEY) return;
      const next = normalizeLangTag(event.newValue);
      if (next) setLangState(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    persistLang(defaultStorage(), next);
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const t = (key: string, vars?: TVars) => translate(lang, key, vars);
    return {
      lang,
      setLang,
      t,
      resolve: (text) => resolveLocalized(text, lang),
      format: t,
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

/**
 * 取当前语言与取值函数。
 *
 * Provider 之外调用会直接返回一个以默认语言（中文）工作的实现，
 * 而不是抛错：这能让只关心 `t()` 的组件在孤立测试里直接渲染。
 */
export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  const t = (key: string, vars?: TVars) => translate(DEFAULT_LANG, key, vars);
  return {
    lang: DEFAULT_LANG,
    setLang: () => {},
    t,
    resolve: (text) => resolveLocalized(text, DEFAULT_LANG),
    format: t,
  };
}
