// Wails 生成的原生绑定桥。
//
// 生成物 `@wails-bindings/desktopservice.js` 只有 wails 构建与 tsconfig 的路径映射
// 解析得到；node 测试进程里没有这层映射，静态 import 会让任何间接引用到 `wails.ts`
// 的测试文件直接加载失败。因此这里把它做成「能解析就是真绑定，解析不到就是空壳」：
// 空壳上的每个方法都返回 `browser_mode_manual_path`，与浏览器模式的语义一致。
import type * as DesktopService from '@wails-bindings/desktopservice.js';

/** 浏览器模式（含 node 测试）下的统一错误码：调用方按它提示用户手动指定路径。 */
export const BROWSER_MODE_ERROR = 'browser_mode_manual_path';

/** 真实绑定；解析不到时为 null。`wails.ts` 只在 `native` 为 null 时才走浏览器分支。 */
export function loadNative(): Partial<typeof DesktopService> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('@wails-bindings/desktopservice.js') as typeof DesktopService;
  } catch {
    return null;
  }
}

/** 任何原生方法在绑定缺席时的统一行为：拒绝，而不是静默成功。 */
export function rejectBrowserMode(): Promise<never> {
  return Promise.reject(new Error(BROWSER_MODE_ERROR));
}
