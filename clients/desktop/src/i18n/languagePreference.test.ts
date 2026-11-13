import test from 'node:test';
import assert from 'node:assert/strict';
import { detectInitialLang, normalizeLangTag, resolveLangPreference, type LangStorage } from './languagePreference.js';
import { applyDocumentLang, interpolate, resolveLocalized, translate } from './translate.js';

function memoryStorage(seed: Record<string, string> = {}): LangStorage & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

test('normalizeLangTag keeps only supported primary subtags', () => {
  assert.equal(normalizeLangTag('en-US'), 'en');
  assert.equal(normalizeLangTag('zh-Hant-TW'), 'zh');
  assert.equal(normalizeLangTag('EN'), 'en');
  assert.equal(normalizeLangTag('fr-FR'), null);
  assert.equal(normalizeLangTag(''), null);
  assert.equal(normalizeLangTag(null), null);
});

test('a manual choice wins over the browser preference', () => {
  assert.equal(resolveLangPreference({ stored: 'zh', languages: ['en-US'] }), 'zh');
  assert.equal(resolveLangPreference({ stored: 'en', languages: ['zh-CN'] }), 'en');
});

test('the browser preference decides when nothing was stored', () => {
  assert.equal(resolveLangPreference({ languages: ['en-US', 'en'] }), 'en');
  assert.equal(resolveLangPreference({ languages: ['zh-CN', 'en'] }), 'zh');
  // 法语用户不该看到半英文半中文：不认识的偏好一律落到完整中文。
  assert.equal(resolveLangPreference({ languages: ['fr-FR', 'de'] }), 'zh');
  assert.equal(resolveLangPreference({ languages: [] }), 'zh');
  assert.equal(resolveLangPreference({}), 'zh');
});

test('the stored preference is what detectInitialLang reads first', () => {
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage({ 'rezehub.lang': 'en' }), configurable: true });
  try {
    assert.equal(detectInitialLang(), 'en');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true });
  }
});

test('translate falls back to Chinese and then to the key itself', () => {
  assert.equal(translate('zh', 'common.save'), '保存');
  assert.equal(translate('en', 'common.save'), 'Save');
  assert.equal(translate('en', 'does.not.exist'), 'does.not.exist');
  assert.equal(interpolate('{a} of {b}', { a: 1, b: 2 }), '1 of 2');
  // 未知占位符保持原样，漏传变量在界面上看得见。
  assert.equal(interpolate('{a} of {b}', { a: 1 }), '1 of {b}');
});

test('resolveLocalized walks requested → Chinese → first non-empty → empty', () => {
  assert.equal(resolveLocalized({ zh: '中文', en: 'English' }, 'en'), 'English');
  assert.equal(resolveLocalized({ zh: '中文' }, 'en'), '中文');
  assert.equal(resolveLocalized({ en: 'English' }, 'en'), 'English');
  assert.equal(resolveLocalized({ ja: '日本語' }, 'zh'), '日本語');
  assert.equal(resolveLocalized('裸字符串', 'en'), '裸字符串');
  assert.equal(resolveLocalized({}, 'zh'), '');
  assert.equal(resolveLocalized(null, 'zh'), '');
});

test('applyDocumentLang is safe without a document', () => {
  assert.doesNotThrow(() => applyDocumentLang('en'));
});
