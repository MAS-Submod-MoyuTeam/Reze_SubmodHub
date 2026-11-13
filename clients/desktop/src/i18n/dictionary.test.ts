import test from 'node:test';
import assert from 'node:assert/strict';
import { messages } from './dictionary.js';
import { SUPPORTED_LANGS } from './types.js';

// 两边键集合必须完全一致：漏翻一个键不该靠肉眼发现。
const zhKeys = Object.keys(messages.zh).sort();
const enKeys = Object.keys(messages.en).sort();

test('every supported language has a dictionary', () => {
  for (const lang of SUPPORTED_LANGS) {
    assert.ok(messages[lang], `missing dictionary for ${lang}`);
  }
});

test('zh and en carry the same keys', () => {
  const missingInEn = zhKeys.filter((key) => !(key in messages.en));
  const missingInZh = enKeys.filter((key) => !(key in messages.zh));
  assert.deepEqual(missingInEn, [], `missing in en: ${missingInEn.join(', ')}`);
  assert.deepEqual(missingInZh, [], `missing in zh: ${missingInZh.join(', ')}`);
});

test('no key is blank and every placeholder is present in both languages', () => {
  const placeholders = (template: string) =>
    [...template.matchAll(/\{([^{}\s]+)\}/g)].map((match) => match[1]).sort();
  for (const key of zhKeys) {
    const zh = messages.zh[key];
    const en = messages.en[key];
    assert.ok(zh.trim().length > 0, `blank zh text for ${key}`);
    assert.ok(en.trim().length > 0, `blank en text for ${key}`);
    assert.deepEqual(placeholders(en), placeholders(zh), `placeholder mismatch for ${key}`);
  }
});
