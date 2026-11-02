import React, { act } from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { TagFilterDrawer } from './TagFilterDrawer';
import type { TagFilterRow, TagFilterStates } from '../../../ui/tag-filter';

/**
 * 目录筛选抽屉的层级呈现：每个标签一行「名称 + 小号灰色描述」，
 * 子标签默认折叠，没有子标签的主标签不出现折叠按钮。
 * 折叠只改变可见性，不能顺带改动筛选状态。
 */

const rows: TagFilterRow[] = [
  {
    main: { name: '工具', description: '自动修复与诊断类模组' },
    children: [
      { name: '绘图', description: '生成与编辑图片' },
      { name: '脚本', description: '' },
    ],
    stale: false,
  },
  { main: { name: '音乐', description: '播放与切换背景音乐' }, children: [], stale: false },
  { main: { name: '遗留标签', description: '' }, children: [], stale: true },
];

async function mountDrawer(options: { states?: TagFilterStates } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const original = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });

  let states: TagFilterStates = options.states ?? {};
  const toggles: string[] = [];
  const root = createRoot(dom.window.document.getElementById('root')!);
  const render = () => {
    act(() => {
      root.render(
        <TagFilterDrawer
          open
          onClose={() => {}}
          rows={rows}
          states={states}
          onToggle={(name) => {
            toggles.push(name);
            const current = states[name];
            const next: TagFilterStates =
              current === 'include'
                ? { ...states, [name]: 'exclude' }
                : current === 'exclude'
                  ? Object.fromEntries(Object.entries(states).filter(([key]) => key !== name))
                  : { ...states, [name]: 'include' };
            states = next;
            render();
          }}
          onClear={() => {
            states = {};
            render();
          }}
        />,
      );
    });
  };
  render();
  const container = dom.window.document.getElementById('root')!;
  return {
    container,
    toggles,
    states: () => states,
    row: (name: string) => container.querySelector(`[data-testid="tag-filter-row-${name}"]`),
    toggle: (name: string) => container.querySelector(`[data-testid="tag-filter-toggle-${name}"]`) as HTMLButtonElement | null,
    children: (name: string) => container.querySelector(`[data-testid="tag-filter-children-${name}"]`),
    tag: (name: string) => container.querySelector(`[data-tag="${name}"]`) as HTMLButtonElement | null,
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

test('每个标签一行「名称 + 小号灰色描述」，描述同时进入可访问名', async () => {
  const view = await mountDrawer();
  try {
    const main = view.tag('工具')!;
    assert.match(main.textContent || '', /#工具/);
    assert.match(main.textContent || '', /自动修复与诊断类模组/);
    assert.match(main.getAttribute('aria-label') || '', /工具：自动修复与诊断类模组/);
    assert.match(main.innerHTML, /text-\[10px\][^"]*text-neutral-500/, '描述要比标签名小一号且是灰色');
    // 没有描述的标签不渲染空行。
    assert.equal(view.row('音乐')!.querySelectorAll('[data-tag]').length, 1);
  } finally {
    await view.close();
  }
});

test('子标签默认折叠，折叠按钮独立于筛选动作', async () => {
  const view = await mountDrawer();
  try {
    assert.equal(view.children('工具'), null, '默认不展开');
    const toggle = view.toggle('工具')!;
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.match(toggle.getAttribute('aria-label') || '', /展开 工具 的子标签（2 个）/);

    await view.click(toggle, '展开 工具');
    assert.ok(view.children('工具'), '展开后子标签出现');
    assert.ok(view.tag('绘图'));
    assert.deepEqual(view.toggles, [], '展开/收起不能改变筛选');
    assert.deepEqual(view.states(), {}, '筛选状态必须原样保留');
  } finally {
    await view.close();
  }
});

test('没有子标签的主标签不出现折叠按钮', async () => {
  const view = await mountDrawer();
  try {
    assert.equal(view.toggle('音乐'), null, '一个点了没反应的箭头比没有更糟');
    assert.equal(view.toggle('遗留标签'), null);
    assert.ok(view.tag('音乐'), '主标签本身仍可点选');
  } finally {
    await view.close();
  }
});

test('子标签也能三态切换，并在展开区里显示自己的描述', async () => {
  const view = await mountDrawer();
  try {
    await view.click(view.toggle('工具'), '展开 工具');
    const child = view.tag('绘图')!;
    assert.match(child.textContent || '', /生成与编辑图片/);
    await view.click(child, '#绘图');
    assert.deepEqual(view.toggles, ['绘图']);
    assert.deepEqual(view.states(), { 绘图: 'include' });
    assert.equal(view.tag('绘图')!.getAttribute('data-tag-state'), 'include');
    assert.equal(view.tag('绘图')!.getAttribute('aria-label'), '绘图（包含）：生成与编辑图片');
  } finally {
    await view.close();
  }
});

test('收起时仍能看出这一组里有生效的筛选', async () => {
  const view = await mountDrawer({ states: { 绘图: 'include' } });
  try {
    assert.equal(view.children('工具'), null, '仍然是收起的');
    const badge = view.container.querySelector('[data-testid="tag-filter-group-active-工具"]');
    assert.ok(badge, '收起时必须提示这一组里有筛选，否则用户会以为没生效');
    assert.equal(badge!.textContent, '1');
    // 展开后这个提示让位给真正的高亮状态。
    await view.click(view.toggle('工具'), '展开 工具');
    assert.equal(view.container.querySelector('[data-testid="tag-filter-group-active-工具"]'), null);
  } finally {
    await view.close();
  }
});

test('目录外的历史标签用虚线标出，且没有折叠按钮', async () => {
  const view = await mountDrawer();
  try {
    const stale = view.tag('遗留标签')!;
    assert.match(stale.className, /border-dashed/);
    assert.equal(view.toggle('遗留标签'), null);
    assert.match(stale.getAttribute('title') || '', /已不在标签目录中/);
  } finally {
    await view.close();
  }
});
