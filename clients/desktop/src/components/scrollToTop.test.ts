import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrollPaneToTop } from './scrollToTop';

function recordingPane(failOn: (options: unknown) => boolean = () => false) {
  const calls: unknown[] = [];
  return {
    calls,
    pane: {
      scrollTo(...args: unknown[]) {
        const options = args.length === 1 ? args[0] : args;
        calls.push(options);
        // 只让「带选项」的那一次抛错，模拟不支持 scrollTo({...}) 的旧实现。
        if (failOn(options)) throw new TypeError('unsupported options');
      },
    },
  };
}

test('返回顶部作用于目录滚动面板，并请求平滑滚动', () => {
  const { pane, calls } = recordingPane();
  scrollPaneToTop(pane as unknown as HTMLElement);
  assert.deepEqual(calls, [{ top: 0, behavior: 'smooth' }], '必须滚面板本身而不是窗口');
});

test('没有面板时不做任何事', () => {
  assert.doesNotThrow(() => scrollPaneToTop(null));
});

test('环境不支持 scrollTo 选项时退回瞬时跳转，而不是让按钮静默失效', () => {
  const { pane, calls } = recordingPane((options) => typeof options === 'object');
  scrollPaneToTop(pane as unknown as HTMLElement);
  assert.deepEqual(calls, [{ top: 0, behavior: 'smooth' }, [0, 0]], '先尝试平滑，再退回 (0, 0)');
});
