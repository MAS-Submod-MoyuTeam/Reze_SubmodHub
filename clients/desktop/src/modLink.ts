import type { ModSummary } from './types/client';

/**
 * 深链与剪贴板提示的判断逻辑。
 *
 * 放在组件外是因为它们决定「要不要打扰用户」和「跳过去有没有真实数据」，
 * 是最容易写成隐式条件的地方，值得单独用测试锁住。
 */

/** 从目录里按 id 找模组；找不到返回 null，调用方负责说清楚原因。 */
export function findCatalogMod(modID: string, catalogMods: ModSummary[]): ModSummary | null {
  if (!modID) return null;
  return catalogMods.find((mod) => mod.id === modID) ?? null;
}

/**
 * 剪贴板里发现站内链接时该不该提示。
 *
 * 不提示的三种情况：
 * - 同一条链接已经提示过（用户可能已经忽略，不该反复弹）；
 * - 当前正开着这个模组的详情（提示是纯打扰）；
 * - 上一个提示还没被处理（不叠加第二个）。
 */
export function shouldPromptClipboardLink(
  modID: string,
  state: { lastPromptedModID: string | null; openModID: string | null; promptOpen: boolean },
): boolean {
  if (!modID) return false;
  if (state.promptOpen) return false;
  if (state.lastPromptedModID === modID) return false;
  if (state.openModID === modID) return false;
  return true;
}

export type DeepLinkResolution =
  | { kind: 'open'; mod: ModSummary }
  | { kind: 'missing'; modID: string }
  | { kind: 'none' };

/**
 * 深链里的 mod id 要在当前目录里换成真实对象。
 *
 * 不伪造一个只有 id 的 ModSummary 塞给详情：那个对象会一路流进安装链路，
 * 期间标题、版本、平台都是假的。查不到就明说「不在目录里」。
 */
export function resolveDeepLinkMod(
  modID: string | null | undefined,
  catalogMods: ModSummary[],
  options: { catalogLoaded: boolean },
): DeepLinkResolution {
  if (!modID) return { kind: 'none' };
  const mod = findCatalogMod(modID, catalogMods);
  if (mod) return { kind: 'open', mod };
  // 目录还在加载时不能下「已下架」的结论，等目录到了再说。
  if (!options.catalogLoaded) return { kind: 'none' };
  return { kind: 'missing', modID };
}

/** 提示里给用户看的名称：目录里有标题就用标题，没有才退回 id。 */
export function describeLinkedMod(modID: string, catalogMods: ModSummary[]): string {
  const title = findCatalogMod(modID, catalogMods)?.title?.trim();
  return title ? title : modID;
}
