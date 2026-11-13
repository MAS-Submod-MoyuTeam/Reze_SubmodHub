/**
 * 多语言文本的唯一解析点。
 *
 * 服务端把模组简介、描述与标签的名/描述存成「语言 → 文本」对象；两个前端都只
 * 通过这里取值，回退链只在这里定义一次：
 *
 *   请求的语言 → 中文 → 第一个非空值 → 空串
 *
 * 空串而不是占位符：调用方能在渲染前判断「这条内容还没翻译」，决定是隐藏整块
 * 还是显示别的信息，而不是把一句「暂无」当成正文。
 */

export const SUPPORTED_LANGUAGES = ['zh', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = 'zh';

/** 语言 → 文本。缺省语言就是没有、不是空串，调用方据此判断是否能回退。 */
export type LocalizedText = Record<string, string | undefined>;

function isLang(value: string): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** 把任意上游值收敛成 LocalizedText，永不抛错。 */
export function localizedTextOf(raw: unknown): LocalizedText {
  if (raw === undefined || raw === null) return {};
  // 单个字符串是「只有中文」的历史形状，或某个只发一句原文的端点。
  if (typeof raw === 'string') {
    const text = raw.trim();
    return text ? { [DEFAULT_LANGUAGE]: text } : {};
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: LocalizedText = {};
  for (const [lang, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (text) out[lang] = text;
  }
  return out;
}

/**
 * 按回退链取一句文本。
 *
 * `lang` 允许传浏览器原始值（`en-US`），这里取主语言标签比较，调用方不必先归一。
 */
export function resolveLocalized(text: LocalizedText | string | null | undefined, lang: string): string {
  const values = localizedTextOf(text);
  const wanted = primarySubtag(lang);
  if (wanted && values[wanted]) return values[wanted] as string;
  if (values[DEFAULT_LANGUAGE]) return values[DEFAULT_LANGUAGE] as string;
  // 兜底顺序定为「支持的语言先、其余按字典序」：只配了英文的条目仍然能显示，
  // 同时两次渲染不会因为对象键序不同而抖动。
  for (const supported of SUPPORTED_LANGUAGES) {
    if (values[supported]) return values[supported] as string;
  }
  for (const key of Object.keys(values).sort()) {
    if (values[key]) return values[key] as string;
  }
  return '';
}

/** 构造一个单语言的 LocalizedText，用于请求体。 */
export function localizedText(lang: string, value: string): LocalizedText {
  const text = value.trim();
  const primary = primarySubtag(lang) ?? DEFAULT_LANGUAGE;
  return text ? { [primary]: text } : {};
}

/**
 * 合并写入：保留其他语言的既有译文，只替换本次编辑的语言。
 * 作者改英文描述不该顺手把中文描述删掉。
 */
export function withLocalizedValue(text: LocalizedText | string | null | undefined, lang: string, value: string): LocalizedText {
  const next: LocalizedText = { ...localizedTextOf(text) };
  const primary = primarySubtag(lang) ?? DEFAULT_LANGUAGE;
  const trimmed = value.trim();
  if (trimmed) next[primary] = trimmed;
  else delete next[primary];
  return next;
}

/** 某种语言是否有对应译文（不参与回退）。 */
export function hasTranslation(text: LocalizedText | string | null | undefined, lang: string): boolean {
  const primary = primarySubtag(lang);
  return Boolean(primary && localizedTextOf(text)[primary]);
}

/** 已翻译的语言列表，按支持顺序在前、其余按字典序。 */
export function translatedLanguages(text: LocalizedText | string | null | undefined): string[] {
  const values = localizedTextOf(text);
  const present = Object.keys(values).filter((key) => values[key]);
  return present.sort((a, b) => rankLanguage(a) - rankLanguage(b) || a.localeCompare(b));
}

function rankLanguage(lang: string): number {
  const index = (SUPPORTED_LANGUAGES as readonly string[]).indexOf(lang);
  return index < 0 ? SUPPORTED_LANGUAGES.length : index;
}

/** `en-US` → `en`；不认识的值原样返回小写，由调用方判断。 */
export function primarySubtag(lang: string | null | undefined): string | null {
  if (!lang) return null;
  const primary = lang.trim().toLowerCase().split(/[-_]/)[0];
  return primary || null;
}

/**
 * 浏览器语言偏好 → 站点语言。
 *
 * 只支持两种语言，所以「不认识的偏好」不能算数：只有首选链里明确出现英文时
 * 才落到英文，其余一律中文。这样法语用户看到的不是半英文半中文，而是完整中文。
 */
export function preferredLanguageFrom(acceptLanguages: readonly string[] | undefined): SupportedLanguage {
  for (const raw of acceptLanguages ?? []) {
    const primary = primarySubtag(typeof raw === 'string' ? raw : '');
    if (!primary) continue;
    if (isLang(primary)) return primary;
    // 中文的浏览器标签是 zh-CN / zh-TW / zh-Hans，主标签同样是 zh，已在上面命中。
  }
  return DEFAULT_LANGUAGE;
}
