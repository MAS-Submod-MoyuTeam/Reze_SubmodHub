/**
 * Web 端「详情页的地址」。
 *
 * 详情弹窗原本只是内存里的一个 state（`detailModalModId`），所以它没有地址、
 * 不能分享、也没法从外部打开。这里把地址变成详情的一个等价表示：
 * `/mod/<mod_id>` 就是「这个详情是打开的」。
 *
 * 只做纯函数，历史操作留在调用方（`App.tsx`）：弹窗自己的开关逻辑不该被
 * history API 的细节污染，测试也能直接断言路径与动作。
 */

import { isModID, modLinkPath } from '../../ui/mod-link';

/** 目录页地址；关闭详情就回到这里。 */
export const CATALOG_PATH = '/';

/** 从当前地址取出应该打开的 mod id；不是详情地址就返回 null。 */
export function modIDFromLocation(location: { pathname: string } | null | undefined): string | null {
  if (!location || typeof location.pathname !== 'string') return null;
  const match = /^\/mod\/([^/]+)\/?$/.exec(location.pathname);
  if (!match) return null;
  const id = match[1];
  return isModID(id) ? id : null;
}

/** 详情打开时的地址。 */
export function pathForMod(modID: string): string {
  return modLinkPath(modID);
}

/**
 * 我们压进历史的那条记录带一个标记。
 *
 * 有了它才能区分两种「当前地址是详情」：一种是我们自己 push 出来的（关闭时
 * 应该 `back()` 退回上一条），另一种是用户直接用分享链接落地的（浏览器历史里
 * 没有上一条可退，`back()` 会把用户带出站点，只能 `replace` 换成目录）。
 */
export interface ModDetailHistoryState {
  modDetail: string;
}

export function modDetailHistoryState(modID: string): ModDetailHistoryState {
  return { modDetail: modID };
}

export function isOwnModDetailEntry(state: unknown): boolean {
  return Boolean(state) && typeof state === 'object' && 'modDetail' in (state as Record<string, unknown>);
}

export type HistoryAction =
  | { kind: 'push'; path: string; state: ModDetailHistoryState }
  | { kind: 'back' }
  | { kind: 'replace'; path: string }
  | { kind: 'none' };

/**
 * 详情状态变化后应该做的历史操作。
 *
 * - 打开详情：压一条带标记的新历史，「后退」自然就是关掉它；
 * - 关闭我们自己压出来的详情：`back()` 回目录，不在历史里多留一条同样的地址
 *   （否则「后退」会把用户刚关掉的详情重新打开）；
 * - 关闭「用户自己落地的那条」详情（分享链接直接进站）：没有可退的上一页，
 *   用 `replace` 换成目录，避免 `back()` 把用户带出站点；
 * - 当前地址本来就不是详情：什么都不做，别把站点首页压成两条一样的记录。
 */
export function historyActionFor(
  modID: string | null,
  location: { pathname: string; state?: unknown },
): HistoryAction {
  if (modID) {
    const next = pathForMod(modID);
    // 同一个详情地址（含结尾斜杠的写法）已经在地址栏里，压历史只会让「后退」空转。
    if (trimTrailingSlash(location.pathname) === trimTrailingSlash(next)) return { kind: 'none' };
    return { kind: 'push', path: next, state: modDetailHistoryState(modID) };
  }
  if (modIDFromLocation(location) === null) return { kind: 'none' };
  return isOwnModDetailEntry(location.state) ? { kind: 'back' } : { kind: 'replace', path: CATALOG_PATH };
}

function trimTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}
