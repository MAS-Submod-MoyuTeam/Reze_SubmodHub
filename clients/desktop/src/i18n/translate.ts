/**
 * 纯翻译引擎：查表、插值、多语言文本回退与 html lang 同步。
 * 不依赖 React，因此可以单测。
 */

import { DEFAULT_LANG, LANG_HTML_ATTRS, type Lang, type LocalizedText, type TVars } from './types';
import { messages } from './dictionary';

/** 匹配 `{name}`；`{{` / `}}` 表示字面花括号。 */
const PLACEHOLDER = /\{\{|\}\}|\{([^{}\s]+)\}/g;

/**
 * 单趟替换 `{name}`。
 *
 * 单趟是有意的：替换进去的值如果再含 `{other}`，不会被二次展开，
 * 否则用户输入的正文会被当成模板。
 */
export function interpolate(template: string, vars?: TVars): string {
  if (!vars) return template.replace(/\{\{|\}\}/g, (match) => (match === '{{' ? '{' : '}'));
  return template.replace(PLACEHOLDER, (match, name: string | undefined) => {
    if (match === '{{') return '{';
    if (match === '}}') return '}';
    if (name && Object.prototype.hasOwnProperty.call(vars, name)) {
      const value = vars[name];
      return value === undefined || value === null ? '' : String(value);
    }
    return match;
  });
}

/**
 * 查一个键：当前语言 → 中文 → 键名本身。
 *
 * 返回键名而不是空串：漏翻的地方会以 `sidebar.operations` 的样子出现在界面上，
 * 一眼可见，也不会渲染出一个空按钮。
 */
export function translate(lang: Lang, key: string, vars?: TVars): string {
  const template = messages[lang]?.[key] ?? messages[DEFAULT_LANG][key];
  if (template === undefined || template === '') return key;
  return interpolate(template, vars);
}

/**
 * 渲染服务端下发的多语言文本。
 *
 * 回退链只在这里定义一次：请求语言 → 中文 → 第一个非空值 → 空串。
 * 字符串输入按中文处理：单语言载荷是 `LocalizedText` 的历史形状。
 */
export function resolveLocalized(text: LocalizedText | string | null | undefined, lang: Lang): string {
  if (typeof text === 'string') return text.trim();
  if (!text) return '';
  const pick = (value: string | undefined) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : '';
  };
  const wanted = pick(text[lang]);
  if (wanted) return wanted;
  const fallback = pick(text[DEFAULT_LANG]);
  if (fallback) return fallback;
  for (const value of Object.values(text)) {
    const candidate = pick(value);
    if (candidate) return candidate;
  }
  return '';
}

/** 让 `<html lang>` 跟着语言走（影响字体与读屏发音）；非 DOM 环境下安全空转。 */
export function applyDocumentLang(lang: Lang): void {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc?.documentElement) return;
  doc.documentElement.lang = LANG_HTML_ATTRS[lang];
}
