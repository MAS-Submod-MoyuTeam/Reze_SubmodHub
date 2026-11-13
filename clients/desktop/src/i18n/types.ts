/**
 * i18n 的基础类型与常量。
 *
 * 只放类型/常量，不放运行时依赖（尤其 React），纯函数模块与测试可以直接 import。
 */

/** 客户端支持的语言。默认中文：绝大多数内容与作者都在中文侧。 */
export type Lang = 'zh' | 'en';

export const SUPPORTED_LANGS: readonly Lang[] = ['zh', 'en'];

/** 缺失/无法识别时一律回到中文。 */
export const DEFAULT_LANG: Lang = 'zh';

/** 语言切换器上的名称：用各语言自己的写法，切过去之后仍认得出怎么切回来。 */
export const LANG_LABELS: Record<Lang, string> = {
  zh: '简体中文',
  en: 'English',
};

/** 窄屏（标题栏 / 移动底栏）用的两字母标签。 */
export const LANG_SHORT_LABELS: Record<Lang, string> = {
  zh: '中',
  en: 'EN',
};

/** `<html lang>` 属性值。 */
export const LANG_HTML_ATTRS: Record<Lang, string> = {
  zh: 'zh-CN',
  en: 'en',
};

/** 与 Web 商店共用同一个键：同域部署时两边的语言选择一致。 */
export const LANG_STORAGE_KEY = 'rezehub.lang';

/**
 * 服务端下发的多语言文本：语言 → 文本。
 * 缺省语言是「没有这个键」，而不是空串。
 */
export type LocalizedText = Record<string, string | undefined>;

/** `t()` 的插值变量。 */
export type TVars = Record<string, string | number>;

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (SUPPORTED_LANGS as readonly string[]).includes(value);
}
