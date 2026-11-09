import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Android 竖屏的视口契约。
 *
 * 这条不能靠组件测试覆盖：`env(safe-area-inset-*)` 只有在 `viewport-fit=cover`
 * 时才不为 0，而 meta 标签写在 `index.html` 里。一旦有人把它改回去，所有
 * 安全区内边距会静默失效，而界面看起来「只是顶栏被压了一点」——很难在评审里发现。
 */
const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../index.html'), 'utf8');
// 注释里会解释「为什么不用 user-scalable=no」，断言只看真正的标记。
const html = raw.replace(/<!--[\s\S]*?-->/g, '');

test('viewport 声明 viewport-fit=cover，安全区变量才会生效', () => {
  assert.match(html, /<meta[^>]+name="viewport"[^>]+viewport-fit=cover/);
});

test('viewport 不禁止用户缩放：不用 user-scalable=no，也不设 maximum-scale', () => {
  assert.doesNotMatch(html, /user-scalable\s*=\s*no/i);
  assert.doesNotMatch(html, /maximum-scale/i);
});
