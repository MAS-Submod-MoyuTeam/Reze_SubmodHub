import test from 'node:test';
import assert from 'node:assert/strict';
import { ANDROID_PACKAGE, openInClient, planClientLaunch } from './clientDeepLink.js';

const MOD = 'mod_abc123';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36';

// 浏览器不会告诉我们「客户端装没装」，所以这里锁的是两件事：
// 1. 每种平台该发哪种跳转形态；
// 2. 跳转后页面仍可见时，必须回调「没客户端」让调用方兜底。

test('Android 用带 package 的 intent://，避免选择框', () => {
  const plan = planClientLaunch(MOD, ANDROID_UA);
  assert.equal(plan.target, 'intent');
  assert.equal(
    plan.target === 'intent' ? plan.url : '',
    `intent://mod/${MOD}#Intent;scheme=rezehub;package=${ANDROID_PACKAGE};end`,
  );
});

test('桌面浏览器用自定义 scheme', () => {
  const plan = planClientLaunch(MOD, WINDOWS_UA);
  assert.deepEqual(plan, { target: 'scheme', url: `rezehub://mod/${MOD}` });
});

test('非法 mod id 不发起任何跳转', () => {
  assert.deepEqual(planClientLaunch('bad id', WINDOWS_UA), { target: 'invalid_mod_id' });
  assert.deepEqual(planClientLaunch('', WINDOWS_UA), { target: 'invalid_mod_id' });
});

test('跳转后页面仍可见时提示「没有客户端」', () => {
  const navigated: string[] = [];
  let noClientCalls = 0;
  let scheduled: (() => void) | null = null;
  const plan = openInClient(MOD, {
    userAgent: WINDOWS_UA,
    navigate: (url) => navigated.push(url),
    onNoClient: () => { noClientCalls += 1; },
    setTimeoutFn: ((fn: () => void) => { scheduled = fn; return 0 as unknown as ReturnType<typeof setTimeout>; }) as typeof setTimeout,
  });
  assert.equal(plan.target, 'scheme');
  assert.deepEqual(navigated, [`rezehub://mod/${MOD}`], '跳转只应发生一次');
  assert.equal(noClientCalls, 0, '跳转当下还不能判定，必须等超时');
  assert.ok(scheduled, '必须安排一次可见性复查');
  (scheduled as () => void)();
  assert.equal(noClientCalls, 1);
});

test('非法 id 不跳转也不安排超时回调', () => {
  let navigations = 0;
  let timers = 0;
  const plan = openInClient('bad id', {
    navigate: () => { navigations += 1; },
    setTimeoutFn: ((() => { timers += 1; return 0; }) as unknown) as typeof setTimeout,
  });
  assert.equal(plan.target, 'invalid_mod_id');
  assert.equal(navigations, 0);
  assert.equal(timers, 0);
});

test('跳转本身抛错时立刻判定「没有客户端」，不让用户干等', () => {
  let noClientCalls = 0;
  let timers = 0;
  const plan = openInClient(MOD, {
    userAgent: WINDOWS_UA,
    navigate: () => { throw new Error('blocked'); },
    onNoClient: () => { noClientCalls += 1; },
    setTimeoutFn: ((() => { timers += 1; return 0; }) as unknown) as typeof setTimeout,
  });
  assert.equal(plan.target, 'scheme');
  assert.equal(noClientCalls, 1, '明确的拒绝应当立即兜底');
  assert.equal(timers, 0, '已经知道结果就不必再等超时');
});
