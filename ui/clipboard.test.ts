import test from 'node:test';
import assert from 'node:assert/strict';
import { copyToClipboard } from './clipboard.js';

/**
 * 剪贴板写入在三种环境里都可能失败，这里锁的是「失败之后还试没试第二条路」，
 * 而不是浏览器最终有没有复制成功。
 */

/**
 * Node 自带的 `navigator` 是只读 getter，直接赋值会被忽略（测试会假装通过），
 * 所以统一用 defineProperty 覆盖，用完再删掉。
 */
function setNavigator(value: unknown) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
}

function installFakeDom(execCommandResult: boolean) {
  const created: any[] = [];
  (globalThis as any).document = {
    createElement: () => {
      const area: any = {
        value: '',
        style: {},
        setAttribute: () => {},
        select: () => {},
      };
      return area;
    },
    body: {
      appendChild: (node: unknown) => { created.push(node); },
      removeChild: () => {},
    },
    execCommand: () => execCommandResult,
  };
  return created;
}

function restore() {
  delete (globalThis as any).document;
  delete (globalThis as any).navigator;
}

test('异步剪贴板可用时直接用它', async () => {
  const written: string[] = [];
  setNavigator({ clipboard: { writeText: async (text: string) => { written.push(text); } } });
  const created = installFakeDom(true);
  try {
    assert.equal(await copyToClipboard('rezehub://mod/mod_a'), true);
    assert.deepEqual(written, ['rezehub://mod/mod_a']);
    assert.equal(created.length, 0, '异步 API 成功时不该动 DOM');
  } finally {
    restore();
  }
});

test('异步 API 拒绝写入（文档没有焦点）时退回 textarea', async () => {
  // 真实浏览器里遇到的就是这一种：API 在，但调用抛错。
  setNavigator({ clipboard: { writeText: async () => { throw new Error('Document is not focused.'); } } });
  const created = installFakeDom(true);
  try {
    assert.equal(await copyToClipboard('https://rezehub.0721play.icu/mod/mod_a'), true);
    assert.equal(created.length, 1, '必须真的试过旧方案');
    assert.equal(created[0].value, 'https://rezehub.0721play.icu/mod/mod_a');
  } finally {
    restore();
  }
});

test('没有异步 API 时直接用 textarea', async () => {
  setNavigator({});
  const created = installFakeDom(true);
  try {
    assert.equal(await copyToClipboard('text'), true);
    assert.equal(created.length, 1);
  } finally {
    restore();
  }
});

test('两条路都失败时返回 false，调用方才知道要把链接显示出来', async () => {
  setNavigator({});
  installFakeDom(false);
  try {
    assert.equal(await copyToClipboard('text'), false);
  } finally {
    restore();
  }
});
