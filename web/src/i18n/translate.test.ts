import test from 'node:test';
import assert from 'node:assert/strict';
import { interpolate, resolveLocalized, translate } from './translate';
import { applyDocumentLang } from './translate';
import { messages } from './dictionary';
import { DEFAULT_LANG } from './types';

/**
 * 取值与回退链。
 *
 * 两条回退链是整个 i18n 最容易出错的地方，也是组件里唯一需要记住的契约：
 * - 界面文案：当前语言 → 中文 → 键名本身（不能变成空白按钮）
 * - 服务端文本：当前语言 → 中文 → 第一个非空值 → ''
 */

test('t() 按当前语言查表并支持 {name} 插值', () => {
  assert.equal(translate('zh', 'header.catalog'), '模组目录');
  assert.equal(translate('en', 'header.catalog'), 'Catalog');
  assert.equal(translate('en', 'header.appVersionTitle', { version: '1.2.3' }), 'Current version v1.2.3');
  assert.equal(translate('zh', 'pagination.pageOf', { page: 2, totalPages: 7 }), '2 / 7 页');
});

test('插值把数字直接转成字符串，且只替换一遍', () => {
  assert.equal(interpolate('共 {total} 条', { total: 13 }), '共 13 条');
  assert.equal(interpolate('{a} 和 {b}', { a: 'x', b: 'y' }), 'x 和 y');
  // 值里带 {b} 不会被二次展开，否则用户输入的内容会被当成模板。
  assert.equal(interpolate('{a}', { a: '{b}', b: 'boom' }), '{b}');
  // 未知占位符原样保留：比渲染成 undefined 更容易在评审里发现。
  assert.equal(interpolate('{a} {miss}', { a: '1' }), '1 {miss}');
  assert.equal(interpolate('没有占位符'), '没有占位符');
});

test('t() 缺键时回退中文，再缺则返回键名本身', () => {
  // 只存在于中文的键：英文查不到时回退中文。
  const onlyZh = '__test.onlyZh';
  (messages.zh as Record<string, string>)[onlyZh] = '仅中文';
  try {
    assert.equal(translate('en', onlyZh), '仅中文');
  } finally {
    delete (messages.zh as Record<string, string>)[onlyZh];
  }
  // 两边都没有：返回键名，而不是空串。
  assert.equal(translate('en', 'does.not.exist'), 'does.not.exist');
  assert.equal(translate('zh', 'does.not.exist'), 'does.not.exist');
});

test('t() 的中文回退也会做插值', () => {
  const key = '__test.onlyZhWithVar';
  (messages.zh as Record<string, string>)[key] = '只有 {n} 条';
  try {
    assert.equal(translate('en', key, { n: 3 }), '只有 3 条');
  } finally {
    delete (messages.zh as Record<string, string>)[key];
  }
});

test('resolve() 优先取请求语言', () => {
  const text = { zh: '中文标题', en: 'English title' };
  assert.equal(resolveLocalized(text, 'en'), 'English title');
  assert.equal(resolveLocalized(text, 'zh'), '中文标题');
});

test('resolve() 缺请求语言时回退中文', () => {
  assert.equal(resolveLocalized({ zh: '中文简介' }, 'en'), '中文简介');
  assert.equal(resolveLocalized({ zh: '中文简介', en: '   ' }, 'en'), '中文简介');
});

test('resolve() 中文也缺时取第一个非空值（服务端可能存了别的语种）', () => {
  assert.equal(resolveLocalized({ zh: '', ja: '日本語', fr: 'Français' }, 'en'), '日本語');
  assert.equal(resolveLocalized({ fr: 'Français', de: 'Deutsch' }, 'zh'), 'Français');
});

test('resolve() 对空值与裸字符串的处理', () => {
  assert.equal(resolveLocalized(null, 'zh'), '');
  assert.equal(resolveLocalized(undefined, 'zh'), '');
  assert.equal(resolveLocalized({}, 'en'), '');
  assert.equal(resolveLocalized({ en: '  ' }, 'en'), '');
  // 单语言载荷是历史的「只有中文」形状。
  assert.equal(resolveLocalized('裸字符串', 'en'), '裸字符串');
  assert.equal(resolveLocalized('  ', 'en'), '');
});

test('resolve() 不会把空白当成内容', () => {
  assert.equal(resolveLocalized({ en: '   ', zh: '  ' }, 'en'), '');
  assert.equal(resolveLocalized({ zh: '内容', en: '   ' }, 'en'), '内容');
});

test('默认语言是中文', () => {
  assert.equal(DEFAULT_LANG, 'zh');
});

test('applyDocumentLang 同步 <html lang>，无 DOM 时不抛错', () => {
  const created: { lang?: string } = {};
  const doc = { documentElement: created } as unknown as Document;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
  try {
    applyDocumentLang('en');
    assert.equal(created.lang, 'en');
    applyDocumentLang('zh');
    assert.equal(created.lang, 'zh-CN');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else delete (globalThis as { document?: unknown }).document;
  }
  assert.doesNotThrow(() => applyDocumentLang('en'));
});
