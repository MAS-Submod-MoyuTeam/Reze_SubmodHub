import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AppForegroundEventName, DeepLinkEventName } from './wails.js';

/**
 * 事件名是跨语言的字符串契约：前端按名字订阅，Go 侧和 Android 原生层按名字发。
 * 两边拼错一个字不会编译报错、不会测试报错，只会安静地什么都不发生——
 * 而这两条通道恰好都是「用不了也没人会发现」的功能。所以在这里钉死。
 */

const read = (relPath: string) => readFileSync(new URL(relPath, import.meta.url), 'utf8');

test('深链事件名在 TypeScript、Go 与 Android 原生层三处一致', () => {
  const go = read('../../../cmd/client/SubmodHub/deep_link.go');
  const java = read(
    '../../../cmd/client/SubmodHub/build/android/app/src/main/java/com/wails/app/MainActivity.java',
  );

  assert.match(go, new RegExp(`DeepLinkEventName\\s*=\\s*"${DeepLinkEventName}"`));
  assert.match(java, new RegExp(`DEEP_LINK_EVENT\\s*=\\s*"${DeepLinkEventName}"`));
});

test('回到前台事件名在 TypeScript 与 Android 原生层两处一致', () => {
  const java = read(
    '../../../cmd/client/SubmodHub/build/android/app/src/main/java/com/wails/app/MainActivity.java',
  );

  assert.match(java, new RegExp(`APP_FOREGROUND_EVENT\\s*=\\s*"${AppForegroundEventName}"`));
});

test('Android 在 onResume 里发出回到前台事件，剪贴板检查才等得到', () => {
  const java = read(
    '../../../cmd/client/SubmodHub/build/android/app/src/main/java/com/wails/app/MainActivity.java',
  );

  // 光有常量不发没用：必须真的挂在 onResume 上，否则「切回来查一次」不存在。
  const onResume = java.slice(java.indexOf('protected void onResume()'));
  const body = onResume.slice(0, onResume.indexOf('protected void onPause()'));
  assert.match(body, /notifyAppForeground\(\)/);
});
