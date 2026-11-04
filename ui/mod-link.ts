/**
 * 站内 mod 详情链接的唯一规则来源。
 *
 * Web 端用它把地址栏变成「详情页的地址」，客户端用它把分享链接写进剪贴板、
 * 也用它判断剪贴板里的东西是不是一条站内链接。规则只允许两种形状：
 *
 * - `rezehub://mod/<mod_id>`：给系统 / 浏览器去调起客户端的协议链接；
 * - `https://<任意站点>/mod/<mod_id>`：可以直接粘到浏览器、也能被浏览器交给客户端的分享链接。
 *
 * 这里刻意不校验站点 origin：客户端可能被指向自建/测试服务器（VITE_API_BASE_URL、
 * SUBMODHUB_API_URL），把 origin 写死会让那些实例分享出来的链接在客户端里认不出来。
 * 真正的判别条件是「路径就是 /mod/<一个合法 id>」，误判成本极低。
 */

export const MOD_LINK_SCHEME = 'rezehub';

/** 分享链接默认落到正式站点；调用方可以按当前 API 来源覆盖。 */
export const DEFAULT_SITE_URL = 'https://rezehub.0721play.icu';

const MOD_PATH_PREFIX = '/mod/';
const MOD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MOD_HOST = 'mod';

/** mod_id 是服务端生成的 `mod_` + 12 位随机串；这里只做形状校验，不猜格式。 */
export function isModID(value: unknown): value is string {
  return typeof value === 'string' && MOD_ID_PATTERN.test(value);
}

function normalizeModID(segment: string): string | null {
  // 调用方给的是 pathname 片段（可能带前导 `/` 或结尾 `/`），先削成裸 id 再判形状。
  const id = segment.replace(/^\/+/, '').replace(/\/+$/, '');
  if (id === '' || id.includes('/')) return null;
  return MOD_ID_PATTERN.test(id) ? id : null;
}

/**
 * 从一条链接里取出 mod_id：`rezehub://mod/<id>` 或 `<任意站点>/mod/<id>`。
 * 不是站内链接、或路径后面的段不是合法 id，都返回 `null`（而不是抛错）。
 */
export function modIDFromLink(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol === `${MOD_LINK_SCHEME}:`) {
    // `rezehub://mod/<id>`：协议链接里 host 段承载的是「这是个 mod 链接」。
    if (parsed.host.toLowerCase() !== MOD_HOST) return null;
    return normalizeModID(parsed.pathname);
  }
  if (protocol !== 'http:' && protocol !== 'https:') return null;
  if (!parsed.pathname.startsWith(MOD_PATH_PREFIX)) return null;
  return normalizeModID(parsed.pathname.slice(MOD_PATH_PREFIX.length));
}

/** 这条文本是不是一条站内 mod 链接。剪贴板检查用这个当闸门。 */
export function isModLink(raw: string | null | undefined): boolean {
  return modIDFromLink(raw) !== null;
}

/** `rezehub://mod/<id>`：交给操作系统去调起客户端。 */
export function modDeepLink(modID: string): string {
  return `${MOD_LINK_SCHEME}://${MOD_HOST}/${encodeURIComponent(modID)}`;
}

/** `/mod/<id>`：Web 端地址栏用的路径，客户端「站内跳转」也复用它。 */
export function modLinkPath(modID: string): string {
  return `${MOD_PATH_PREFIX}${encodeURIComponent(modID)}`;
}

/** 可直接粘贴到浏览器的分享链接。 */
export function modShareURL(modID: string, siteUrl: string = DEFAULT_SITE_URL): string {
  const base = (siteUrl || DEFAULT_SITE_URL).trim().replace(/\/+$/, '');
  return `${base}${modLinkPath(modID)}`;
}
