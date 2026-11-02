import React, { act } from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { TagPicker } from './TagPicker';
import type { TagGroup } from '../../../ui/tags-api';

/**
 * 作者端的标签选择器。两项要求：每一项按「标签名 + 小号灰色描述」排，
 * 以及子标签默认折叠、没有子标签的主标签不给折叠按钮。
 */

const groups: TagGroup[] = [
  {
    name: '工具',
    description: '自动修复与诊断类模组',
    children: [
      { name: '绘图', description: '生成与编辑图片' },
      { name: '脚本' },
    ],
  },
  { name: '音乐', description: '播放与切换背景音乐' },
];

async function mountPicker(props: Partial<React.ComponentProps<typeof TagPicker>> = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const original = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let value = props.value ?? [];
  const changes: string[][] = [];
  const element = (extra: Partial<React.ComponentProps<typeof TagPicker>> = {}) => (
    <TagPicker
      groups={groups}
      value={value}
      onChange={(next) => {
        changes.push(next);
        value = next;
        render(extra);
      }}
      {...extra}
    />
  );
  const root = createRoot(dom.window.document.getElementById('root')!);
  const render = (extra: Partial<React.ComponentProps<typeof TagPicker>> = {}) => {
    act(() => root.render(element(extra)));
  };
  render(props);
  const container = dom.window.document.getElementById('root')!;
  return {
    container,
    changes,
    value: () => value,
    tag: (name: string) => container.querySelector(`[data-tag="${name}"]`) as HTMLButtonElement | null,
    toggle: (name: string) => container.querySelector(`[data-testid="tag-picker-toggle-${name}"]`) as HTMLButtonElement | null,
    children: (name: string) => container.querySelector(`[data-testid="tag-picker-children-${name}"]`),
    async click(node: HTMLElement | null, label: string) {
      assert.ok(node, `expected a control labelled ${label}`);
      await act(async () => {
        node!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      });
    },
    close: async () => {
      await act(async () => root.unmount());
      Object.assign(globalThis, original);
    },
  };
}

test('每一项按「标签名 + 小号灰色描述」排，没有自由输入', () => {
  const html = renderToStaticMarkup(<TagPicker groups={groups} value={[]} onChange={() => {}} />);
  assert.match(html, /#工具/);
  assert.match(html, /自动修复与诊断类模组/);
  assert.match(html, /#音乐/);
  assert.match(html, /播放与切换背景音乐/);
  assert.match(html, /已选 0\/8/);
  assert.match(html, /至少选择一个标签/);
  assert.equal(html.includes('<input'), false, 'the picker must not offer a free-form tag input');
  // 描述用更小的字号与灰色，不能和标签名同级。
  assert.match(html, /text-\[10px\][^"]*text-neutral-500/);
});

test('描述同时进入可访问名，读屏不只知道名称', () => {
  const html = renderToStaticMarkup(<TagPicker groups={groups} value={[]} onChange={() => {}} />);
  assert.match(html, /aria-label="工具：自动修复与诊断类模组"/);
});

test('子标签默认折叠，点折叠按钮才展开', async () => {
  const view = await mountPicker();
  try {
    assert.equal(view.children('工具'), null, '默认不展开子标签');
    assert.equal(view.toggle('工具')!.getAttribute('aria-expanded'), 'false');
    assert.match(view.toggle('工具')!.getAttribute('aria-label') || '', /展开 工具 的子标签（2 个）/);

    await view.click(view.toggle('工具'), '展开 工具');
    assert.ok(view.children('工具'), '展开后子标签必须出现');
    assert.equal(view.toggle('工具')!.getAttribute('aria-expanded'), 'true');
    assert.ok(view.tag('绘图'));
    assert.ok(view.tag('脚本'));
  } finally {
    await view.close();
  }
});

test('没有子标签的主标签不出现折叠按钮', async () => {
  const view = await mountPicker();
  try {
    assert.equal(view.toggle('音乐'), null, '一个点了没反应的箭头比没有更糟');
    assert.ok(view.tag('音乐'), '主标签本身仍可直接选');
  } finally {
    await view.close();
  }
});

test('折叠只影响展开，不改动已选标签', async () => {
  const view = await mountPicker({ value: ['工具'] });
  try {
    await view.click(view.toggle('工具'), '展开 工具');
    assert.deepEqual(view.changes, [], '展开/收起不能产生选择变更');
    assert.equal(view.tag('工具')!.getAttribute('aria-pressed'), 'true');
  } finally {
    await view.close();
  }
});

test('选中子标签时同时高亮主标签', async () => {
  const view = await mountPicker();
  try {
    await view.click(view.toggle('工具'), '展开 工具');
    await view.click(view.tag('绘图'), '#绘图');
    assert.deepEqual(view.changes.at(-1), ['工具', '绘图']);
  } finally {
    await view.close();
  }
});

test('达到上限时未选的标签禁用', () => {
  const full = Array.from({ length: 8 }, (_, index) => `t${index}`);
  const html = renderToStaticMarkup(<TagPicker groups={groups} value={full} onChange={() => {}} />);
  assert.match(html, /已选 8\/8/);
  // 折叠状态下只有两个主标签可见，且都未选中，因此都被禁用。
  assert.equal((html.match(/disabled=""/g) || []).length, 2);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 0);
});

test('读取中、失败与空目录各自说明，而不是给出空壳', () => {
  const loading = renderToStaticMarkup(<TagPicker groups={[]} value={[]} onChange={() => {}} loading />);
  assert.match(loading, /正在读取标签目录/);
  const failed = renderToStaticMarkup(<TagPicker groups={[]} value={[]} onChange={() => {}} error="标签目录读取失败，请稍后重试" />);
  assert.match(failed, /role="alert"/);
  assert.match(failed, /标签目录读取失败/);
  const empty = renderToStaticMarkup(<TagPicker groups={[]} value={[]} onChange={() => {}} />);
  assert.match(empty, /标签目录为空/);
});
