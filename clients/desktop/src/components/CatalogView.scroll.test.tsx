import { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogView } from './CatalogView';
import type { Installation, ModSummary } from '../types/client';
import { FakeIntersectionObserver, mountTestDom } from './testDom';

/**
 * 目录续页必须与 Web 版语义一致：滚动到列表底部自动加载下一页，页脚用「已渲染 xx / 共 yy」收尾。
 * 这里用假 IntersectionObserver + jsdom 覆盖真实挂载、滚动触发与页脚状态。
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

const mods = (count: number) => Array.from({ length: count }, (_, i) => makeMod(i + 1));

function mount() {
  const ctx = mountTestDom('<div id="root"></div>');
  FakeIntersectionObserver.install();

  /** 记录目录滚动面板上真正被调用过的 scrollTo。 */
  const scrollCalls: unknown[] = [];

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
    const pane = ctx.document.querySelector('[data-testid="catalog-scroll-pane"]') as HTMLElement | null;
    if (pane && !('scrollTo' in (pane as unknown as Record<string, unknown>))) {
      Object.defineProperty(pane, 'scrollTo', {
        value: (options: unknown) => scrollCalls.push(options),
        configurable: true,
      });
    }
    return pane;
  };

  return {
    ctx,
    scrollCalls,
    render,
    text: () => ctx.document.body.textContent ?? '',
    footer: () => ctx.document.querySelector('[data-testid="catalog-load-footer"]'),
    cardTitles: () =>
      Array.from(ctx.document.querySelectorAll('h4')).map((node) => node.textContent ?? ''),
    /** 目录滚动哨兵：最后一张卡片之后的续页锚点。 */
    sentinel: () => ctx.document.querySelector('[data-testid="catalog-load-more"]') as HTMLElement | null,
    backToTop: () => ctx.document.querySelector('[data-testid="catalog-back-to-top"]') as HTMLButtonElement | null,
    /** 模拟用户在面板内滚动：改 scrollTop 并派发面板自己的 scroll 事件。 */
    async scrollPaneTo(top: number) {
      const pane = ctx.document.querySelector('[data-testid="catalog-scroll-pane"]') as HTMLElement;
      pane.scrollTop = top;
      await act(async () => {
        pane.dispatchEvent(new ctx.window.Event('scroll'));
      });
    },
    click: async (select: (doc: Document) => HTMLElement | null, label: string) => {
      const node = select(ctx.document);
      assert.ok(node, `expected a control labelled ${label}`);
      await act(async () => {
        node.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
      });
    },
    clickButton: async (label: string) => {
      const button = Array.from(ctx.document.querySelectorAll('button')).find(
        (node) => (node.textContent ?? '').includes(label),
      );
      assert.ok(button, `expected a button labelled ${label}`);
      await act(async () => {
        button.dispatchEvent(new ctx.window.MouseEvent('click', { bubbles: true }));
      });
    },
    close: () => ctx.close(),
  };
}

test('首屏渲染第一页时，页脚报已渲染与总数并提示滚动查看更多', async () => {
  const view = mount();
  try {
    await view.render(mods(14));

    assert.equal(view.cardTitles().length, 6, 'first paint must not render every page at once');
    // 全部条目早已在内存里：页脚只说已渲染多少、还剩多少，不说「正在加载」。
    assert.match(view.text(), /已渲染\s*6\s*\/\s*共\s*14\s*个子模组，滚动查看更多/);
    assert.doesNotMatch(view.text(), /正在加载/, 'nothing is actually loading');
  } finally {
    await view.close();
  }
});

test('滚动到列表底部自动续页，并持续更新已渲染数量', async () => {
  const view = mount();
  try {
    await view.render(mods(14));
    const sentinel = view.sentinel();
    assert.ok(sentinel, 'the grid must end with a load-more anchor placed in the scroll pane');

    const observer = FakeIntersectionObserver.instances[0];
    assert.ok(observer, 'the anchor is watched while pages remain');
    assert.equal(observer.observed[0], sentinel, 'it watches the anchor after the last card');
    assert.match(String(observer.options?.rootMargin), /240px/, 'it prefetches before the anchor is on screen');

    await act(async () => observer.emit(true));
    assert.equal(view.cardTitles().length, 12, 'scrolling to the bottom appends the next page');
    assert.match(view.text(), /已渲染\s*12\s*\/\s*共\s*14\s*个子模组/);

    // A load re-arms the observer; otherwise a page that still fits on screen dies there.
    const next = FakeIntersectionObserver.instances[1];
    assert.ok(next, 'the observer is re-armed after a page lands');
    await act(async () => next.emit(true));
    assert.equal(view.cardTitles().length, 14, 'the remainder fills in without another scroll');
    assert.match(view.text(), /共\s*14\s*个子模组/);
    assert.doesNotMatch(view.text(), /已渲染/, 'everything is rendered, so the footer only reports the total');
  } finally {
    await view.close();
  }
});

test('全部子模组渲染完成后，底部给出总数且不再提示滚动', async () => {
  const view = mount();
  try {
    await view.render(mods(9));
    assert.match(view.text(), /已渲染\s*6\s*\/\s*共\s*9\s*个子模组/);

    await act(async () => FakeIntersectionObserver.instances[0].emit(true));
    assert.equal(view.cardTitles().length, 9);

    assert.match(view.text(), /共\s*9\s*个子模组/);
    assert.doesNotMatch(view.text(), /滚动查看更多/);
    assert.doesNotMatch(view.text(), /正在加载/);
    assert.equal(view.sentinel()?.getAttribute('data-has-more'), 'false', 'the list is complete');
    assert.equal(
      FakeIntersectionObserver.instances.length,
      1,
      'nothing is observed once every row is shown',
    );
  } finally {
    await view.close();
  }
});

test('续页用重新挂载后的观察器推进，旧的已释放回调不再计数', async () => {
  const view = mount();
  try {
    await view.render(mods(14));

    const stale = FakeIntersectionObserver.instances[0];
    await act(async () => stale.emit(true));
    assert.equal(view.cardTitles().length, 12, 'first page appends the second');

    // 旧观察器在行数变化时被 disconnect；即便它再回调也不该继续叠页。
    const armed = FakeIntersectionObserver.instances[1];
    assert.ok(armed, 'a fresh observer takes over after the page lands');
    await act(async () => stale.emit(true));
    assert.equal(view.cardTitles().length, 12, 'the released observer is ignored');
    await act(async () => armed.emit(true));

    assert.equal(view.cardTitles().length, 14, 'the armed observer loads the remainder');
    assert.match(view.text(), /共\s*14\s*个子模组/);
    assert.doesNotMatch(view.text(), /滚动查看更多/);
  } finally {
    await view.close();
  }
});

test('筛选后按新的命中总数收敛已渲染条数，不保留看不见的旧页', async () => {
  const view = mount();
  try {
    await view.render(mods(14));
    await act(async () => FakeIntersectionObserver.instances[0].emit(true));
    assert.equal(view.cardTitles().length, 12, 'two pages are loaded before filtering');

    // 只剩 7 条匹配（其中 2 条是外观礼包）：页数收敛到能覆盖 7 条的两页，而不是残留 12 条。
    const mixed = [...mods(5), makeMod(101, { category: 'spritepack' }), makeMod(102, { category: 'spritepack' })];
    await view.render(mixed);
    assert.equal(view.cardTitles().length, 7, 'no stale rows survive the filter');
    assert.match(view.text(), /已渲染\s*7\s*\/\s*共\s*7\s*个子模组/);
  } finally {
    await view.close();
  }
});

test('筛选放宽时页数保持收敛，不会把没滚动加载过的条目一次塞回首屏', async () => {
  const view = mount();
  try {
    await view.render(mods(14));
    await act(async () => FakeIntersectionObserver.instances[0].emit(true));
    assert.equal(view.cardTitles().length, 12, 'two pages are loaded');

    // 用搜索把命中压到 6 条（恰好一页），页数必须收敛到 1，而不是留在第 2 页继续渲染。
    const input = view.ctx.document.querySelector('input[type="text"]') as HTMLInputElement;
    assert.ok(input, 'the catalog renders a search box');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(view.ctx.window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'Submod 1');
      input.dispatchEvent(new view.ctx.window.Event('input', { bubbles: true }));
    });
    assert.equal(view.cardTitles().length, 6, 'a narrowed result set keeps only the first page');
    assert.match(view.text(), /共\s*6\s*个子模组/, 'the search really narrowed the result set');

    // 清空搜索：14 条回来。页数在命中变少时已经收敛到 1，筛选放宽不会把它复原到第 2 页，
    // 所以首屏仍是一页，而不是把用户没滚动加载过的那一页塞回来。
    await view.clickButton('✕');
    assert.equal(view.cardTitles().length, 6, 'the page count stays clamped, it is not restored');
    assert.match(view.text(), /已渲染\s*6\s*\/\s*共\s*14\s*个子模组/);
  } finally {
    await view.close();
  }
});

test('「加载更多」常驻在页脚，可在观察器之外手动续页', async () => {
  const view = mount();
  try {
    await view.render(mods(14));

    // 手动入口不能放在哨兵里：那里会随下一次续页被卸载，键盘焦点随之丢失。
    const sentinelButton = view.sentinel()?.querySelector('button') ?? null;
    assert.equal(sentinelButton, null, 'the sentinel is a bare anchor, not a button');

    const footer = view.footer();
    assert.ok(footer, 'the footer hosts the manual entry');
    const manual = Array.from(footer!.querySelectorAll('button')).find((n) => (n.textContent ?? '').includes('加载更多'));
    assert.ok(manual, 'the footer keeps a manual load-more entry');
    assert.equal(manual!.isConnected, true);

    await view.clickButton('加载更多');
    assert.equal(view.cardTitles().length, 12, 'the manual entry appends exactly one page');

    // 页数夹住上限：再点不会越过结果总数。
    await view.clickButton('加载更多');
    assert.equal(view.cardTitles().length, 14, 'the last page fills the remainder');
    assert.equal(view.footer()?.querySelector('button') ?? null, null, 'the entry disappears once nothing is left');
  } finally {
    await view.close();
  }
});

test('无匹配结果时页脚只报 0 个，不同时出现「已渲染」', async () => {
  const view = mount();
  try {
    await view.render(mods(14));

    // 切到「服装与外观」后没有任何匹配，列表回到首页状态。
    await view.clickButton('服装与外观');
    assert.match(view.text(), /未找到符合条件的模组/);
    assert.doesNotMatch(view.text(), /已渲染/, 'no rows means nothing was rendered');
    assert.match(view.text(), /共\s*0\s*个子模组/);
    assert.doesNotMatch(view.text(), /滚动查看更多/, 'an empty result has no next page');
  } finally {
    await view.close();
  }
});

test('「匹配当前 MAS」在兼容区间可解析之前保持禁用，不假装过滤生效', async () => {
  const view = mount();
  try {
    await view.render(mods(14));
    const toggle = Array.from(view.ctx.document.querySelectorAll('input[type="checkbox"]')).find((node) =>
      (node.parentElement?.textContent ?? '').includes('匹配当前 MAS'),
    ) as HTMLInputElement | undefined;
    assert.ok(toggle, 'the compatibility toggle is rendered');
    assert.equal(toggle.disabled, true, 'a filter with no implementation must not look usable');
    assert.equal(toggle.checked, false, 'a filter that cannot filter must not render as engaged');
    assert.match(toggle.parentElement?.textContent ?? '', /暂不可用/, 'and it must say so');
  } finally {
    await view.close();
  }
});

test('返回顶部只在离开顶部后出现，点击后面板滚回顶部', async () => {
  const view = mount();
  try {
    await view.render(mods(14));
    assert.equal(view.backToTop(), null, 'still at the top on first paint');

    await view.scrollPaneTo(900);
    const button = view.backToTop();
    assert.ok(button, 'the control appears once the pane leaves the top');
    assert.equal(button.getAttribute('aria-label'), '返回顶部');

    await view.click(() => view.backToTop(), '返回顶部');
    assert.deepEqual(view.scrollCalls, [{ top: 0, behavior: 'smooth' }], 'it scrolls the catalog pane itself');
  } finally {
    await view.close();
  }
});
