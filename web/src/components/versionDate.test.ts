import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatVersionCreatedAt } from './versionDate';

test('missing or invalid version creation time is not shown as Invalid Date', () => {
  // 兜底文案由调用方传入（纯函数拿不到 hook），这里传什么就该原样返回什么。
  assert.equal(formatVersionCreatedAt('', '创建时间未记录'), '创建时间未记录');
  assert.equal(formatVersionCreatedAt('bad-date', '创建时间未记录'), '创建时间未记录');
  // 没传文案时返回空串，而不是硬编码某种语言。
  assert.equal(formatVersionCreatedAt('bad-date'), '');
});

test('valid version creation time is formatted as a date', () => {
  assert.notEqual(formatVersionCreatedAt('2026-10-06T00:00:00Z', '创建时间未记录'), '创建时间未记录');
});

