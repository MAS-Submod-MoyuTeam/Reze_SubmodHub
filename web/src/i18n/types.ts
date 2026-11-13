/**
 * i18n 的基础类型与常量。
 *
 * 只放类型/常量，不放任何运行时代码依赖（尤其是 React），
 * 这样纯函数模块（languagePreference.ts）与测试可以直接 import。
 */

/** 站点支持的语言。默认中文：绝大多数内容与作者都在中文侧。 */
export type Lang = 'zh' | 'en';

export const SUPPORTED_LANGS: readonly Lang[] = ['zh', 'en'];

/** 缺失/无法识别时一律回到中文。 */
export const DEFAULT_LANG: Lang = 'zh';

/** 语言切换器上显示的名称：用各语言自己的写法，而不是当前界面语言的写法。 */
export const LANG_LABELS: Record<Lang, string> = {
  zh: '简体中文',
  en: 'English',
};

/** 切换器「收起态」的两字母标签，窄屏空间不够时用。 */
export const LANG_SHORT_LABELS: Record<Lang, string> = {
  zh: '中',
  en: 'EN',
};

/** `<html lang>` 属性值。 */
export const LANG_HTML_ATTRS: Record<Lang, string> = {
  zh: 'zh-CN',
  en: 'en',
};

/** localStorage 键名。带前缀避免与其他应用的键冲突。 */
export const LANG_STORAGE_KEY = 'rezehub.lang';

/**
 * 服务端下发的多语言文本：语言 → 文本。
 *
 * 允许出现 `zh` / `en` 之外的语言键（后端可能先存了别的语种），
 * 因此这里用 `Record<string, string | undefined>` 而不是 `Partial<Record<Lang, string>>`。
 * 缺省语言就是「没有这个键」，而不是空串。
 */
export type LocalizedText = Record<string, string | undefined>;

/** `t()` 的插值变量。 */
export type TVars = Record<string, string | number>;

/** 判断任意字符串是否是受支持的语言。 */
export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (SUPPORTED_LANGS as readonly string[]).includes(value);
}
