import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LANGUAGE,
  hasTranslation,
  localizedText,
  localizedTextOf,
  preferredLanguageFrom,
  primarySubtag,
  resolveLocalized,
  translatedLanguages,
  withLocalizedValue,
} from './localized-text.js';

test('the fallback chain is requested language → Chinese → any non-empty value', () => {
  const text = { zh: '中文描述', en: 'English description' };
  assert.equal(resolveLocalized(text, 'en'), 'English description');
  assert.equal(resolveLocalized(text, 'zh'), '中文描述');
  // 请求的语言没有译文时落到中文，而不是显示默认值以外的猜测。
  assert.equal(resolveLocalized({ zh: '只有中文' }, 'en'), '只有中文');
  assert.equal(resolveLocalized({ en: 'English only' }, 'en'), 'English only');
  // 只配了第三种语言的条目也不该渲染成空白。
  assert.equal(resolveLocalized({ ja: 'Japanese only' }, 'en'), 'Japanese only');
  assert.equal(resolveLocalized({}, 'zh'), '');
  assert.equal(resolveLocalized(null, 'zh'), '');
  assert.equal(resolveLocalized(undefined, 'en'), '');
});

test('a browser-style tag resolves through its primary subtag', () => {
  assert.equal(resolveLocalized({ zh: '中文', en: 'English' }, 'en-US'), 'English');
  assert.equal(resolveLocalized({ zh: '中文', en: 'English' }, 'zh-Hans-CN'), '中文');
  assert.equal(primarySubtag('EN_us'), 'en');
  assert.equal(primarySubtag(''), null);
  assert.equal(primarySubtag(null), null);
});

test('legacy plain strings are read as the default language', () => {
  assert.deepEqual(localizedTextOf('一句原文'), { zh: '一句原文' });
  assert.deepEqual(localizedTextOf('   '), {});
  assert.deepEqual(localizedTextOf(42), {});
  assert.deepEqual(localizedTextOf(['a']), {});
  assert.deepEqual(resolveLocalized('一句原文', 'en'), '一句原文');
});

test('unknown languages and blank entries survive normalization as data, not errors', () => {
  const text = localizedTextOf({ zh: ' 中文 ', en: '   ', ja: '日本語', fr: 7 });
  assert.deepEqual(text, { zh: '中文', ja: '日本語' });
  assert.deepEqual(translatedLanguages(text), ['zh', 'ja']);
  assert.deepEqual(translatedLanguages({ ja: 'x', en: 'y', zh: 'z' }), ['zh', 'en', 'ja']);
});

test('building and merging translations keeps the other languages intact', () => {
  assert.deepEqual(localizedText('en', 'Hello'), { en: 'Hello' });
  assert.deepEqual(localizedText('en-US', ' Hello '), { en: 'Hello' });
  assert.deepEqual(localizedText('en', '   '), {});

  const edited = withLocalizedValue({ zh: '中文描述', en: 'Old' }, 'en', 'New');
  assert.deepEqual(edited, { zh: '中文描述', en: 'New' });
  // 清空英文只删英文，不顺势把中文一起删掉。
  assert.deepEqual(withLocalizedValue({ zh: '中文描述', en: 'Old' }, 'en', '  '), { zh: '中文描述' });
});

test('hasTranslation answers about one language only, without falling back', () => {
  assert.equal(hasTranslation({ zh: '中文' }, 'en'), false);
  assert.equal(hasTranslation({ zh: '中文' }, 'zh'), true);
  assert.equal(hasTranslation({ en: 'English' }, 'zh'), false);
});

test('browser preferences map to a supported language, defaulting to Chinese', () => {
  assert.equal(preferredLanguageFrom(['en-US', 'en']), 'en');
  assert.equal(preferredLanguageFrom(['zh-CN', 'en']), 'zh');
  assert.equal(preferredLanguageFrom(['fr-FR', 'en']), 'en');
  // 法语用户不该看到半英文半中文：不认识的偏好一律落到完整中文。
  assert.equal(preferredLanguageFrom(['fr-FR', 'de']), DEFAULT_LANGUAGE);
  assert.equal(preferredLanguageFrom([]), DEFAULT_LANGUAGE);
  assert.equal(preferredLanguageFrom(undefined), DEFAULT_LANGUAGE);
});
