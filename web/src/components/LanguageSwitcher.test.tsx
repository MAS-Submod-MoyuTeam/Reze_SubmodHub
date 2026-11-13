/**
 * 语言切换器必须真的换掉界面语言。
 *
 * 这里钉的是一个已经踩过的坑：`LangProvider` 曾经没挂到 `main.tsx` 上，
 * `useI18n()` 于是静默退回「永远中文」的默认实现——切换动作点了，
 * `<html lang>` 不变、localStorage 里也没有记录，而所有纯函数单测都是绿的。
 * 组件级测试是唯一能抓到「忘了接线」的那一层。
 *
 * 控件是原生 `<select>`：选中态读 `value`，切换靠派发 `change` 事件。
 */
import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { LangProvider } from '../i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

function mount() {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = {
    window: globals.window,
    document: globals.document,
    localStorage: globals.localStorage,
    IS_REACT_ACT_ENVIRONMENT: globals.IS_REACT_ACT_ENVIRONMENT,
  };
  globals.window = dom.window;
  globals.document = dom.window.document;
  globals.localStorage = dom.window.localStorage;
  globals.IS_REACT_ACT_ENVIRONMENT = true;

  const root = createRoot(dom.window.document.getElementById('root')!);
  const select = () => dom.window.document.querySelector('[data-testid="language-switcher"]') as HTMLSelectElement | null;

  return {
    document: dom.window.document,
    select,
    /** 下拉框当前选中的语言。 */
    value: () => select()?.value,
    /** 下拉框里可选的条目（顺序即展示顺序）。 */
    options: () =>
      [...(select()?.options ?? [])].map((o) => ({ value: o.value, label: o.textContent })),
    async paint() {
      await act(async () => {
        root.render(
          <LangProvider initialLang="zh">
            <LanguageSwitcher />
          </LangProvider>,
        );
      });
    },
    /** 模拟用户在下拉框里选另一个语言：改 value 再派发 change。 */
    async choose(lang: 'zh' | 'en') {
      const el = select()!;
      await act(async () => {
        el.value = lang;
        el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      });
    },
    async cleanup() {
      await act(async () => {
        root.unmount();
      });
      Object.assign(globals, saved);
      dom.window.close();
    },
  };
}

test('下拉框里列出两种语言，各自用本语言的写法', async () => {
  const view = mount();
  try {
    await view.paint();
    assert.deepEqual(view.options(), [
      { value: 'zh', label: '简体中文' },
      { value: 'en', label: 'English' },
    ]);
    assert.equal(view.value(), 'zh', '默认应为中文');
  } finally {
    await view.cleanup();
  }
});

test('下拉框左侧带地球图标，且图标不挡住点击', async () => {
  const view = mount();
  try {
    await view.paint();
    const wrap = view.document.querySelector('[data-testid="language-switcher"]')!.parentElement!;
    // 两个装饰图标：左侧地球（提示这是语言切换）、右侧箭头（提示可展开）。
    const icons = wrap.querySelectorAll('svg');
    assert.equal(icons.length, 2, '应当有一个地球图标和一个展开箭头');
    for (const icon of icons) {
      assert.ok(icon.classList.contains('pointer-events-none'), '装饰图标必须让点击穿透到 select');
      assert.equal(icon.getAttribute('aria-hidden'), 'true', '装饰图标不该被读屏重复播报');
    }
    // 地球图标应带圆周与外圈经线，确保不是别的图标顶替。
    const globe = icons[0];
    assert.ok(globe.querySelector('circle'), '左侧图标应是地球（含圆形轮廓）');
    assert.ok(globe.querySelectorAll('path').length >= 2, '地球应有经线/赤道');
  } finally {
    await view.cleanup();
  }
});

test('切到 English：选中值、html lang 与持久化一起变', async () => {
  const view = mount();
  try {
    await view.paint();
    await view.choose('en');

    assert.equal(view.value(), 'en', '英文必须成为选中项');
    assert.equal(view.document.documentElement.lang, 'en', '<html lang> 必须跟着切换');
    assert.equal(view.document.defaultView!.localStorage.getItem('rezehub.lang'), 'en', '手动选择必须记住');
  } finally {
    await view.cleanup();
  }
});

test('切回中文：状态、lang 属性与存储同步回退', async () => {
  const view = mount();
  try {
    await view.paint();
    await view.choose('en');
    await view.choose('zh');

    assert.equal(view.value(), 'zh');
    assert.equal(view.document.documentElement.lang, 'zh-CN');
    assert.equal(view.document.defaultView!.localStorage.getItem('rezehub.lang'), 'zh');
  } finally {
    await view.cleanup();
  }
});
