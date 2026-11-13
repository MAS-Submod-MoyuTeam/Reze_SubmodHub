/**
 * 只取 `t()` 的便捷 hook。
 *
 * 多数组件只需要翻译界面文案，不关心当前语言本身；用这个可以少解构一层。
 * 需要 `lang` / `setLang` / `resolve` 时请直接用 `useI18n()`。
 */
import { useI18n } from './I18nContext';
import type { TVars } from './types';

export type TFunction = (key: string, vars?: TVars) => string;

export function useT(): TFunction {
  return useI18n().t;
}
