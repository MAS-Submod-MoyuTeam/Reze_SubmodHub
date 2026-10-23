import type { AppRelease, AppReleaseAsset } from '../../../ui/app-release-api';

export type DownloadPlatform = 'windows' | 'android' | 'other';

/** 资产的实际交付来源：节点直链，或 GitHub 直链。 */
export type DownloadSource = 'cloudreve' | 'github';

export interface ClientDownloadOption {
  platform: 'windows' | 'android';
  asset: AppReleaseAsset;
}

export interface DownloadRoute {
  /** 最终跳转地址；空串表示两个来源都给不出可用地址。 */
  href: string;
  source: DownloadSource;
  /** 这份描述已经不能直接交付（节点直链临期）：值得换一份新描述再试。 */
  needsFreshLink: boolean;
}

const PLATFORM_LABELS: Record<'windows' | 'android', string> = {
  windows: 'Windows',
  android: 'Android',
};

/** 安全标识：不认识的资产（如独立更新器）不会被当作可安装客户端。 */
export function classifyAssetName(name: string): DownloadPlatform {
  const lower = name.toLowerCase();
  if (lower.endsWith('.apk')) return 'android';
  if (lower.endsWith('.exe') && lower.includes('windows')) return 'windows';
  return 'other';
}

export function platformLabel(platform: DownloadPlatform): string {
  return platform === 'other' ? '其他' : PLATFORM_LABELS[platform];
}

/**
 * 只保留可安装的客户端资产，并把当前设备排在前面：手机访客先看到 APK，
 * 桌面访客先看到 EXE，另一平台仍然可见而不是被隐藏。
 */
export function listClientDownloads(assets: AppReleaseAsset[], preferred: DownloadPlatform): ClientDownloadOption[] {
  const options: ClientDownloadOption[] = [];
  for (const asset of assets) {
    const platform = classifyAssetName(asset.name);
    if (platform === 'other') continue;
    options.push({ platform, asset });
  }
  const rank = (platform: 'windows' | 'android') => {
    if (platform === preferred) return 0;
    return platform === 'windows' ? 1 : 2;
  };
  return options.sort((left, right) => rank(left.platform) - rank(right.platform));
}

export function detectDevicePlatform(userAgent: string): DownloadPlatform {
  const agent = userAgent.toLowerCase();
  if (agent.includes('android')) return 'android';
  if (agent.includes('windows')) return 'windows';
  return 'other';
}

/**
 * Cloudreve 直链的有效期只有几分钟。即将过期（或已经过期）时必须重新取一次
 * 描述，否则用户读完说明再点下载会拿到死链。
 */
export function linkExpiringSoon(expiresAt: string | undefined, now = Date.now(), leadMs = 30_000): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return true;
  return expiry - now <= leadMs;
}

/** 始终存在的 GitHub 直链；老服务端缺字段时退回该资产自己的 url。 */
export function githubDownloadURL(asset: AppReleaseAsset): string {
  return asset.github_url || (asset.delivery_type === 'github' ? asset.url : '');
}

const PRIVATE_HOST =
  /^(?:localhost$|.*\.localhost$|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/i;

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (PRIVATE_HOST.test(host)) return true;
  return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80');
}

/**
 * 节点直链是否可信到可以让浏览器直接跳过去：https、不带凭据、不是本机/私网地址。
 *
 * 白名单为空时不做假设。这一点与桌面端「白名单为空即拒绝」不同，是有意为之：
 * 浏览器跳转不携带任何 API 凭据、也不由服务端出站，而镜像在上传后已由服务端
 * 读回校验 SHA-256；把「节点没配白名单」当成可疑会让整站下载静默退回 GitHub。
 * 白名单非空时则必须命中，与 `internal/delivery` 的口径一致。
 */
export function isTrustedHostedLink(asset: AppReleaseAsset): boolean {
  if (asset.delivery_type !== 'cloudreve') return true;
  if (!asset.url) return false;
  let target: URL;
  try {
    target = new URL(asset.url);
  } catch {
    return false;
  }
  if (target.protocol !== 'https:') return false;
  if (target.username || target.password) return false;
  if (isPrivateHostname(target.hostname)) return false;
  const allowed = asset.allowed_download_origins.filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.some((origin) => origin.toLowerCase() === target.origin.toLowerCase());
}

/**
 * 依据一份描述决定点击下载后到底跳哪里。
 *
 * 过期或不可信的节点直链一律不返回：宁可当场走 GitHub，也不要把用户送到死链上；
 * 需要换链接时用 `needsFreshLink` 表达，由调用方决定要不要重取描述。
 */
export function resolveDownloadRoute(asset: AppReleaseAsset, now = Date.now()): DownloadRoute {
  const github = githubDownloadURL(asset);
  if (asset.delivery_type !== 'cloudreve' || !asset.url || !isTrustedHostedLink(asset)) {
    return { href: github, source: 'github', needsFreshLink: false };
  }
  if (linkExpiringSoon(asset.expires_at, now)) {
    return { href: github, source: 'github', needsFreshLink: true };
  }
  return { href: asset.url, source: 'cloudreve', needsFreshLink: false };
}

/**
 * 重取描述只允许替换同一个 release 的直链。tag 变了说明站点已经滚到新版本，
 * 这份新描述不能用来交付用户点开的那个版本——否则会出现「说明是 A、装上的是 B」。
 */
export function pickSameReleaseAsset(
  fresh: AppRelease,
  expectedTag: string,
  name: string,
): AppReleaseAsset | undefined {
  if (expectedTag && fresh.tag_name !== expectedTag) return undefined;
  return fresh.assets.find((candidate) => candidate.name === name);
}

export function deliveryLabel(source: DownloadSource): string {
  return source === 'cloudreve' ? '本站节点（Cloudreve）' : 'GitHub Releases';
}

export function shortHash(sha256: string | undefined): string {
  if (!sha256 || sha256.length < 16) return '';
  return `${sha256.slice(0, 8)}…${sha256.slice(-8)}`;
}
