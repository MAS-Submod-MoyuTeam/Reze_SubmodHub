import { act } from 'react';
import type { ReactElement } from 'react';
import { JSDOM } from 'jsdom';
import { createRoot, type Root } from 'react-dom/client';

/**
 * 组件测试的公共 DOM 装载：jsdom + React root + 全局替换与还原。
 *
 * React 首次导入时就会读 `window`/`document`，所以每个需要真实 DOM 的组件测试
 * （`CatalogView.scroll`、`usePaneScrolled`、`useLoadMoreOnScroll`）都要走这一份装载，
 * 并且必须在 finally 里 `close()`：否则替换过的全局会留给同一个进程里的后续用例。
 * 每个测试文件各建一份 DOM，互不共享。
 */
export interface TestDom {
  root: Root;
  window: JSDOM['window'];
  document: Document;
  paint: (element: ReactElement) => Promise<void>;
  /** 卸载并还原 globals；每个用例的 finally 里调用。 */
  close: () => Promise<void>;
}

/**
 * 装载期间被替换的全局。`IntersectionObserver` 必须在列表里：假观察器桩是
 * `FakeIntersectionObserver.install()` 直接挂到全局上的，漏掉它就会在 `close()` 之后
 * 继续留着，让同进程里后续的用例误以为观察器可用。
 */
const KEYS = ['window', 'document', 'HTMLElement', 'IntersectionObserver', 'IS_REACT_ACT_ENVIRONMENT'] as const;

/**
 * 像用户那样往受控输入框里打字。
 *
 * React 19 的受控 input 在 jsdom 下不认手工派发的 `input` 事件：事件确实冒泡到了 document，
 * 但它的 change 模拟没把它当成本次输入，`onChange` 不会执行。直接赋 `input.value` 也不行——
 * React 装的那层 setter 会把 value tracker 一并同步成新值，于是被判成「没有变化」。
 *
 * 因此这里直接调用 React 挂在该节点上的 `onChange`，参数形状与它收到合成事件时一致。
 * 语义仍然是「用户把值改成了 value」，只是绕开了 jsdom 不可靠的事件模拟。
 */
export function typeIntoInput(input: HTMLInputElement, value: string): void {
  const key = Object.keys(input).find((name) => name.startsWith('__reactProps'));
  const props = key ? (input as unknown as Record<string, { onChange?: (e: unknown) => void }>)[key] : undefined;
  if (!props?.onChange) {
    throw new Error('typeIntoInput: the input is not React-controlled (no onChange handler found)');
  }
  props.onChange({ target: { value } });
}

export function mountTestDom(body: string): TestDom {
  const dom = new JSDOM(body, { url: 'http://localhost/' });
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = new Map<string, { present: boolean; value: unknown }>();
  for (const key of KEYS) saved.set(key, { present: key in globalThis, value: globals[key] });

  globals.window = dom.window;
  globals.document = dom.window.document;
  globals.HTMLElement = dom.window.HTMLElement;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom 不实现 IntersectionObserver；先置空，让 `install()` 安装的桩也走前面记下的还原值，
  // 而不是在用例之间互相透传。
  delete globals.IntersectionObserver;

  const root = createRoot(dom.window.document.getElementById('root')!);
  return {
    root,
    window: dom.window,
    document: dom.window.document,
    async paint(element) {
      await act(async () => root.render(element));
    },
    async close() {
      await act(async () => root.unmount());
      dom.window.close();
      for (const key of KEYS) {
        const { present, value } = saved.get(key)!;
        if (present) globals[key] = value;
        else delete globals[key];
      }
    },
  };
}

/** jsdom 没有 IntersectionObserver；用例按需安装，安装后可通过 `emit` 驱动回调。 */
export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed: Element[] = [];
  readonly options: IntersectionObserverInit | undefined;
  disconnected = false;
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    FakeIntersectionObserver.instances.push(this);
  }

  static install() {
    FakeIntersectionObserver.instances = [];
    (globalThis as unknown as Record<string, unknown>).IntersectionObserver = FakeIntersectionObserver;
  }

  observe(target: Element) {
    this.observed.push(target);
  }

  unobserve() {}

  disconnect() {
    this.disconnected = true;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  emit(isIntersecting: boolean) {
    // 浏览器在 disconnect 之后不会再派发回调；桩必须照抄这条语义，
    // 否则「旧观察器不该再续页」的用例测的就是一个不存在的情况。
    if (this.disconnected) return;
    if (this.observed.length === 0) throw new Error('emit() before observe()');
    const entry = { isIntersecting, target: this.observed[0] } as IntersectionObserverEntry;
    this.callback([entry], this as unknown as IntersectionObserver);
  }
}
