import test from 'node:test';
import assert from 'node:assert/strict';
import {
  browserLanguages,
  detectInitialLang,
  normalizeLangTag,
  persistLang,
  readStoredLang,
  resolveLangPreference,
  type LangStorage,
} from './languagePreference';
import { LANG_STORAGE_KEY } from './types';

/**
 * 初始语言判定。
 *
 * 规则：存储里的显式选择 > 浏览器偏好 > 默认中文。
 * 浏览器偏好里任何一个以 en 开头就算英文，其余一律中文——
 * 这条会被「用户明明选了中文，刷新后又跳回英文」这类 bug 反复踩到，所以逐条锁住。
 */

function memoryStorage(initial?: string | null): LangStorage & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(key) {
      return key === LANG_STORAGE_KEY ? this.value : null;
    },
    setItem(key, value) {
      if (key === LANG_STORAGE_KEY) this.value = value;
    },
  };
}

test('浏览器偏好以 en 开头时判为英文', () => {
  assert.equal(detectInitialLang(['en']), 'en');
  assert.equal(detectInitialLang(['en-US']), 'en');
  assert.equal(detectInitialLang(['en-GB', 'zh-CN']), 'en');
});

test('任何位置出现 en 偏好都算英文（不只是第一项）', () => {
  assert.equal(detectInitialLang(['zh-CN', 'en-US']), 'en');
  assert.equal(detectInitialLang(['ja', 'en']), 'en');
});

test('中文或无法识别的偏好一律回退默认中文', () => {
  assert.equal(detectInitialLang(['zh']), 'zh');
  assert.equal(detectInitialLang(['zh-CN']), 'zh');
  assert.equal(detectInitialLang(['zh-Hant-TW']), 'zh');
  assert.equal(detectInitialLang(['ja-JP', 'fr']), 'zh');
  assert.equal(detectInitialLang([]), 'zh');
  assert.equal(detectInitialLang(null), 'zh');
  assert.equal(detectInitialLang(undefined), 'zh');
});

test('语言标签归一：大小写、下划线、区域后缀都能收', () => {
  assert.equal(normalizeLangTag('EN'), 'en');
  assert.equal(normalizeLangTag('en_us'), 'en');
  assert.equal(normalizeLangTag('zh_CN'), 'zh');
  assert.equal(normalizeLangTag(' fr-FR '), null);
  assert.equal(normalizeLangTag(''), null);
  assert.equal(normalizeLangTag(null), null);
});

test('存储里的显式选择优先于浏览器', () => {
  assert.equal(resolveLangPreference({ stored: 'en', languages: ['zh-CN'] }), 'en');
  assert.equal(resolveLangPreference({ stored: 'zh', languages: ['en-US'] }), 'zh');
});

test('存储里没有（或值非法）时才看浏览器', () => {
  assert.equal(resolveLangPreference({ stored: null, languages: ['en-US'] }), 'en');
  assert.equal(resolveLangPreference({ stored: 'de', languages: ['en-US'] }), 'en');
  assert.equal(resolveLangPreference({ stored: 'de', languages: ['zh-CN'] }), 'zh');
  assert.equal(resolveLangPreference({}), 'zh');
});

test('读取存储只认受支持的语言', () => {
  assert.equal(readStoredLang(memoryStorage('en')), 'en');
  assert.equal(readStoredLang(memoryStorage('zh')), 'zh');
  assert.equal(readStoredLang(memoryStorage('EN')), null);
  assert.equal(readStoredLang(memoryStorage('klingon')), null);
  assert.equal(readStoredLang(memoryStorage(null)), null);
  assert.equal(readStoredLang(null), null);
});

test('存储被禁用时读写都不抛错', () => {
  const hostile: LangStorage = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
  assert.equal(readStoredLang(hostile), null);
  assert.doesNotThrow(() => persistLang(hostile, 'en'));
});

test('写入后用同一个键读取能拿到选择', () => {
  const storage = memoryStorage();
  persistLang(storage, 'en');
  assert.equal(storage.value, 'en');
  assert.equal(readStoredLang(storage), 'en');
  persistLang(storage, 'zh');
  assert.equal(readStoredLang(storage), 'zh');
});

test('没有 navigator 的环境里浏览器语言为空', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });
  try {
    assert.equal(browserLanguages(), null);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
});
