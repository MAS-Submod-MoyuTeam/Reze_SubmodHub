/**
 * i18n 桶文件：组件一律从 `'../i18n'` 引入，不直接摸内部文件。
 *
 *   import { useI18n, useT, LangProvider } from '../i18n';
 */
export type { Lang, LocalizedText, TVars } from './types';
export {
  SUPPORTED_LANGS,
  DEFAULT_LANG,
  LANG_LABELS,
  LANG_SHORT_LABELS,
  LANG_HTML_ATTRS,
  LANG_STORAGE_KEY,
  isLang,
} from './types';

export { messages } from './dictionary';

export { LangProvider, useI18n } from './I18nContext';
export type { I18nContextValue } from './I18nContext';

export { useT } from './useT';
export type { TFunction } from './useT';

export {
  browserLanguages,
  defaultStorage,
  detectInitialLang,
  normalizeLangTag,
  persistLang,
  readStoredLang,
  resolveLangPreference,
} from './languagePreference';
export type { LangStorage } from './languagePreference';

export { applyDocumentLang, interpolate, resolveLocalized, translate } from './translate';
