// Pure translation engine: dictionary lookup, interpolation, localized-text
// resolution and html-lang sync. No React here, so it is unit-testable.

import { DEFAULT_LANG, LANG_HTML_ATTRS, type Lang, type LocalizedText, type TVars } from './types';
import { messages } from './dictionary';

/** Matches `{name}` placeholders. `{{` escapes a literal brace. */
const PLACEHOLDER = /\{\{|\}\}|\{([^{}\s]+)\}/g;

/**
 * Replace `{name}` with `vars[name]`.
 *
 * Interpolation runs in a single pass: a value that itself contains `{other}`
 * is not interpolated again. Unknown placeholders stay verbatim so a missing
 * variable is visible in dev instead of rendering "undefined".
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
 * Look a key up: requested lang → zh → the key itself.
 *
 * Returning the key (instead of an empty string) is deliberate: a missing
 * translation shows up as `header.catalog` on screen, which is obvious in
 * review and in a bug report, and never produces a blank button.
 */
export function translate(lang: Lang, key: string, vars?: TVars): string {
  const template = messages[lang]?.[key] ?? messages[DEFAULT_LANG][key];
  if (template === undefined || template === '') return key;
  return interpolate(template, vars);
}

/**
 * Render server-provided mod/tag text.
 *
 * Fallback chain, defined once: requested lang → zh → first non-empty value →
 * `''`. Empty string (not a placeholder) so callers can decide to hide a block
 * when nothing has been translated yet.
 *
 * A bare string is treated as Chinese: single-language payloads are the legacy
 * shape of `LocalizedText`.
 */
export function resolveLocalized(
  text: LocalizedText | string | null | undefined,
  lang: Lang,
): string {
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

/**
 * 把 `<html lang>` 与页面标题/描述同步到当前语言。
 *
 * `index.html` 里的 `<title>` 和 meta 只能是某一种语言，而浏览器标签页与
 * 搜索结果都是用户可见的，所以切语言时必须由运行时改写。文案通过传入的
 * `t` 取字典，避免在 HTML 里硬编码两份。
 */
export function applyDocumentLang(lang: Lang, t?: (key: string) => string): void {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc?.documentElement) return;
  doc.documentElement.lang = LANG_HTML_ATTRS[lang];
  if (!t) return;

  const title = t('app.documentTitle');
  if (title && title !== 'app.documentTitle') doc.title = title;

  const description = t('app.documentDescription');
  if (description && description !== 'app.documentDescription') {
    for (const el of doc.querySelectorAll('meta[name="description"], meta[property="og:description"]')) {
      el.setAttribute('content', description);
    }
    for (const el of doc.querySelectorAll('meta[property="og:title"]')) {
      el.setAttribute('content', title);
    }
  }
}
