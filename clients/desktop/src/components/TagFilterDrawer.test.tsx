import { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogView } from './CatalogView';
import type { Installation, ModSummary } from '../types/client';
import { FakeIntersectionObserver, mountTestDom } from './testDom';
import { TagFilterDrawer } from './TagFilterDrawer';
import type { TagFilterRow, TagFilterStates } from '../../../../ui/tag-filter';

/**
 * 客户端目录的标签筛选：入口是刷新按钮旁边的悬浮标签按钮，点开是右侧抽屉。
 * 标签默认不选；点一次「包含」，再点一次「排除」，第三次回到未选；包含之间是 AND。
 * 三态语义与 Web 共用 `ui/tag-filter`，这里验证它确实接进了目录的渲染与过滤。
 */

const installation: Installation = {
  id: 'inst_1',
  label: 'MAS Portable 0.12',
  path_hint: 'C:/Games/DDLC_MAS',
  is_valid: true,
  is_running: false,
  mas_version: '0.12.14',
  permission_state: 'authorized',
  platform: 'windows',
  last_validated_at: '2026-10-01T00:00:00Z',
};

function makeMod(index: number, overrides: Partial<ModSummary> = {}): ModSummary {
  return {
    id: `catalog_mod_${index}`,
    title: `Submod ${index}`,
    summary: `summary ${index}`,
    author: { id: 'usr_1', display_name: 'Reze' },
    category: 'submod',
    tags: ['语音'],
    supported_platforms: ['windows'],
    mas_version_range: '>=0.12.0',
    recommended_priority: 0,
    latest_version_id: `ver_${index}`,
    latest_version: '1.0.0',
    size_bytes: 4096,
    sha256: 'abc123sha',
    updated_at: '2026-10-01T00:00:00Z',
    downloads_count: 1,
    ...overrides,
  };
}

function mount() {
  const ctx = mountTestDom('<div id="root"></div>');
  FakeIntersectionObserver.install();

  const render = async (next: ModSummary[]) => {
    await ctx.paint(
      <CatalogView
        mods={next}
        installedMods={[]}
        activeInstallation={installation}
        catalogError={null}
        isCatalogRefreshing={false}
        onReloadCatalog={() => {}}
        onOpenDetail={() => {}}
        onStartInstallPlan={() => {}}
        onStartUpdatePlan={() => {}}
        installingModId={null}
        installProgress={null}
      />,
    );
  };

  return {
    ctx,
    render,
    text: () => ctx.document.body.textContent ?? '',
    tagsButton: () => ctx.document.querySelector('[data-testid="catalog-tags"]') as HTMLButtonElement | null,
    refreshButton: () => ctx.document.querySelector('[data-testid="catalog-refresh"]') as HTMLButtonElement | null,
    drawer: () => ctx.document.querySelector('[data-testid="tag-filter-drawer"]') as HTMLElement | null,
    chip: (name: string) =>
      ctx.document.querySelector(`[data-tag="${name}"]`) as HTMLButtonElement | null,
    badge: () => ctx.document.querySelector('[data-testid="catalog-tags-badge"]') as HTMLElement | null,
    click: async (node: HTMLElement | null, label: string) => {
      assert.ok(node, `expected a control labelled ${label}`);
      await act(async () => {
        node!.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
      });
    },
    pressEscape: async () => {
      await act(async () => {
        ctx.document.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
    },
    cardTitles: () =>
      Array.from(ctx.document.querySelectorAll('h4')).map((node) => node.textContent ?? ''),
    close: () => ctx.close(),
  };
}

const drawerRows: TagFilterRow[] = [
  {
    main: { name: '工具', description: '自动修复与诊断类模组' },
    children: [
      { name: '绘图', description: '生成与编辑图片' },
      { name: '脚本', description: '' },
    ],
    stale: false,
  },
  { main: { name: '音乐', description: '播放与切换背景音乐' }, children: [], stale: false },
];

/** 直接挂抽屉本身：目录层级来自 props，不需要先跑一遍目录页。 */
function mountDrawerOnly() {
  const ctx = mountTestDom('<div id="root"></div>');
  const toggles: string[] = [];
  let states: TagFilterStates = {};
  const render = () => {
    act(() => {
      ctx.root.render(
        <TagFilterDrawer
          open
          onClose={() => {}}
          rows={drawerRows}
          states={states}
          onToggle={(name) => {
            toggles.push(name);
            states = { ...states, [name]: 'include' };
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
  const container = ctx.document.getElementById('root')!;
  return {
    ctx,
    toggles,
    tag: (name: string) => container.querySelector(`[data-tag="${name}"]`) as HTMLButtonElement | null,
    toggle: (name: string) => container.querySelector(`[data-testid="tag-filter-toggle-${name}"]`) as HTMLButtonElement | null,
    children: (name: string) => container.querySelector(`[data-testid="tag-filter-children-${name}"]`),
    async click(node: HTMLElement | null, label: string) {
      assert.ok(node, `expected a control labelled ${label}`);
      await act(async () => {
        node!.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
      });
    },
    close: () => ctx.close(),
  };
}

test('标签按钮紧挨刷新按钮，抽屉默认关闭', async () => {
  const view = mount();
  try {
    await view.render([makeMod(1)]);
    const tags = view.tagsButton();
    const refresh = view.refreshButton();
    assert.ok(tags, '目录页必须有标签入口');
    assert.ok(refresh, '刷新入口仍在');
    assert.equal(tags.getAttribute('aria-expanded'), 'false');
    assert.equal(tags.getAttribute('aria-label'), '标签筛选');
    assert.equal(view.drawer(), null, '默认不展开抽屉');
    assert.equal(view.badge(), null, '没有筛选时不该有角标');
  } finally {
    await view.close();
  }
});

test('点标签按钮打开抽屉，Esc 能关掉', async () => {
  const view = mount();
  try {
    await view.render([makeMod(1)]);
    await view.click(view.tagsButton(), '标签筛选');
    const drawer = view.drawer();
    assert.ok(drawer, '点一次入口必须打开抽屉');
    assert.equal(drawer.getAttribute('aria-modal'), 'true');
    assert.equal(view.tagsButton()!.getAttribute('aria-expanded'), 'true');
    assert.ok(view.chip('语音'), '抽屉里必须列出模组正在用的标签');

    await view.pressEscape();
    assert.equal(view.drawer(), null, 'Esc 必须能关闭浮层');
  } finally {
    await view.close();
  }
});

test('标签三态循环真的改变目录结果：包含收窄、排除反过来排除', async () => {
  const view = mount();
  const withTag = (index: number, tag: string) => makeMod(index, { tags: [tag] });
  try {
    await view.render([withTag(1, '语音'), withTag(2, '剧情')]);
    assert.equal(view.cardTitles().length, 2);

    await view.click(view.tagsButton(), '标签筛选');
    await view.click(view.chip('语音'), '#语音');
    assert.equal(view.chip('语音')!.getAttribute('data-tag-state'), 'include');
    assert.deepEqual(view.cardTitles(), ['Submod 1'], '包含只留下带该标签的模组');
    assert.equal(view.badge()!.textContent, '1');

    // 再点一次 → 排除：带 #语音 的反被排除，只剩另一条。
    await view.click(view.chip('语音'), '#语音');
    assert.equal(view.chip('语音')!.getAttribute('data-tag-state'), 'exclude');
    assert.deepEqual(view.cardTitles(), ['Submod 2'], '排除只留下不带该标签的模组');

    // 第三次 → 取消：两条都回来。
    await view.click(view.chip('语音'), '#语音');
    assert.equal(view.chip('语音')!.getAttribute('data-tag-state'), 'off');
    assert.equal(view.cardTitles().length, 2);
    assert.equal(view.badge(), null, '取消最后一个标签后角标消失');
  } finally {
    await view.close();
  }
});

test('两个包含标签必须同时满足', async () => {
  const view = mount();
  try {
    await view.render([
      makeMod(1, { tags: ['语音', '剧情'] }),
      makeMod(2, { tags: ['语音'] }),
    ]);
    await view.click(view.tagsButton(), '标签筛选');
    await view.click(view.chip('语音'), '#语音');
    await view.click(view.chip('剧情'), '#剧情');
    assert.deepEqual(view.cardTitles(), ['Submod 1'], 'AND：两条包含标签都要在');
    assert.equal(view.badge()!.textContent, '2');
    assert.match(view.text(), /包含 #语音 #剧情/);
  } finally {
    await view.close();
  }
});

test('标签筛到空结果时说明原因，并给出只清标签的入口', async () => {
  const view = mount();
  try {
    await view.render([makeMod(1, { tags: ['语音'] })]);
    await view.click(view.tagsButton(), '标签筛选');
    await view.click(view.chip('语音'), '#语音');
    await view.click(view.chip('语音'), '#语音'); // 排除：唯一一条被排掉

    assert.match(view.text(), /未找到符合条件的模组/);
    const reason = view.ctx.document.querySelector('[data-testid="catalog-tag-filter-reason"]');
    assert.ok(reason, '空结果必须说明标签筛选是原因');
    assert.match(reason!.textContent ?? '', /排除 #语音/);

    const clearOnly = view.ctx.document.querySelector('[data-testid="catalog-clear-tags"]') as HTMLButtonElement | null;
    assert.ok(clearOnly, '必须能只清标签，而不牵连搜索与分类');
    await view.click(clearOnly, '只清除标签筛选');
    assert.equal(view.cardTitles().length, 1, '只清标签就把模组放回来了');
    assert.equal(view.badge(), null);
  } finally {
    await view.close();
  }
});

test('抽屉的「清除全部」在有筛选时才可点', async () => {
  const view = mount();
  try {
    await view.render([makeMod(1)]);
    await view.click(view.tagsButton(), '标签筛选');
    const clearAll = Array.from(view.ctx.document.querySelectorAll('button')).find(
      (node) => (node.textContent ?? '').trim() === '清除全部',
    ) as HTMLButtonElement | undefined;
    assert.ok(clearAll, '抽屉里必须有清除全部');
    assert.equal(clearAll!.disabled, true, '没有筛选时不该给出一个无效的清空动作');

    await view.click(view.chip('语音'), '#语音');
    const afterSelect = Array.from(view.ctx.document.querySelectorAll('button')).find(
      (node) => (node.textContent ?? '').trim() === '清除全部',
    ) as HTMLButtonElement;
    assert.equal(afterSelect.disabled, false);
    await view.click(afterSelect, '清除全部');
    assert.equal(view.badge(), null, '清除后不再有生效标签');
    assert.equal(view.cardTitles().length, 1);
  } finally {
    await view.close();
  }
});

test('抽屉按目录层级折叠：主标签带描述，子标签展开后才出现', async () => {
  const view = mountDrawerOnly();
  try {
    const main = view.tag('工具')!;
    assert.match(main.textContent || '', /#工具/);
    assert.match(main.textContent || '', /自动修复与诊断类模组/, '描述必须显示在标签名下');
    assert.match(main.getAttribute('aria-label') || '', /工具：自动修复与诊断类模组/);
    assert.equal(view.children('工具'), null, '子标签默认折叠');
    assert.match(view.toggle('工具')!.getAttribute('aria-label') || '', /展开 工具 的子标签（2 个）/);

    await view.click(view.toggle('工具'), '展开 工具');
    assert.ok(view.children('工具'));
    assert.match(view.tag('绘图')!.textContent || '', /生成与编辑图片/);
    assert.deepEqual(view.toggles, [], '折叠不能改变筛选状态');
  } finally {
    await view.close();
  }
});

test('没有子标签的主标签在抽屉里没有折叠按钮', async () => {
  const view = mountDrawerOnly();
  try {
    assert.equal(view.toggle('音乐'), null);
    assert.ok(view.tag('音乐'), '主标签仍可直接点选');
  } finally {
    await view.close();
  }
});
