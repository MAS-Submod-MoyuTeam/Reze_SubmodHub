/**
 * Web 端的「在客户端打开」。
 *
 * 浏览器没有办法问「这个客户端装了没有」：自定义 scheme 找不到处理器时，页面既
 * 拿不到错误也拿不到回调，只是一次什么都没发生的导航。所以策略是「尽力跳一次 +
 * 超时兜底」：跳转真的成功时页面通常已经失去可见性；页面还可见，就当没客户端，
 * 提示下载。
 *
 * Android 优先用 `intent://`：它带得动 package，命中已安装的应用时不会弹选择框。
 * 其它平台用自定义 scheme。
 */

import { MOD_LINK_SCHEME, isModID, modDeepLink } from '../../ui/mod-link';

/** Android 应用的 applicationId（见 build/android/app/build.gradle）。 */
export const ANDROID_PACKAGE = 'com.reze.submodhub';

export type ClientLaunchPlan =
  | { target: 'intent' | 'scheme'; url: string }
  | { target: 'invalid_mod_id' };

/** 纯函数：给定 mod id 与 UA，产出该用哪种跳转形态。 */
export function planClientLaunch(modID: string, userAgent: string): ClientLaunchPlan {
  if (!isModID(modID)) return { target: 'invalid_mod_id' };
  if (/android/i.test(userAgent)) {
    // intent:// 的 scheme 段之后是 host+path，fragment 里放 Intent 参数。
    const payload = modDeepLink(modID).replace(`${MOD_LINK_SCHEME}://`, '');
    return {
      target: 'intent',
      url: `intent://${payload}#Intent;scheme=${MOD_LINK_SCHEME};package=${ANDROID_PACKAGE};end`,
    };
  }
  return { target: 'scheme', url: modDeepLink(modID) };
}

export interface OpenInClientOptions {
  /** 判定「跳转后页面是否还活着」的等待时间；还活着说明大概率没调起客户端。 */
  timeoutMs?: number;
  userAgent?: string;
  navigate?: (url: string) => void;
  /** 页面仍在可见状态时的回调：调用方据此提示「未检测到客户端」并给下载入口。 */
  onNoClient?: () => void;
  setTimeoutFn?: typeof setTimeout;
}

/**
 * 尝试用客户端打开这个 mod。
 *
 * 返回时只代表「已发起跳转」，不代表客户端起来了——浏览器不给这个答案。因此用
 * 「一段时间后页面是否仍然可见」作经验判据：页面切到后台 = 客户端接管了。
 *
 * 跳转本身抛错（个别浏览器对未知 scheme 直接拒绝）时不等待：那已经是明确的
 * 「没有客户端」，立刻走兜底，别让用户先干等一秒多。
 */
export function openInClient(modID: string, options: OpenInClientOptions = {}): ClientLaunchPlan {
  const userAgent = options.userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const plan = planClientLaunch(modID, userAgent);
  if (plan.target === 'invalid_mod_id') return plan;

  const navigate = options.navigate ?? ((url: string) => { window.location.href = url; });
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;

  try {
    navigate(plan.url);
  } catch {
    options.onNoClient?.();
    return plan;
  }

  setTimeoutFn(() => {
    const stillVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
    if (stillVisible) options.onNoClient?.();
  }, options.timeoutMs ?? 1200);
  return plan;
}
