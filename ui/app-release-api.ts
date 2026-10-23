/**
 * `GET /api/v1/app-update` 的客户端读取层。
 *
 * 该描述是客户端自更新与 Web「下载客户端」入口共同的交付契约：版本、逐资产
 * SHA-256、以及每个资产的交付直链（Cloudreve 节点直链或 GitHub 直链）。这里
 * 只做读取与结构校验，不判断版本新旧，也不代替服务端选择交付来源。
 */

export type AppAssetDelivery = 'cloudreve' | 'github';

export interface AppReleaseAsset {
  name: string;
  size_bytes: number;
  sha256?: string;
  delivery_type: AppAssetDelivery;
  node_id?: string;
  /** 当前交付类型的下载地址；`cloudreve` 时是带签名的短期直链。 */
  url: string;
  expires_at?: string;
  allowed_download_origins: string[];
  /** 始终存在的 GitHub 直链，用于回落。 */
  github_url: string;
}

export interface AppRelease {
  tag_name: string;
  version: string;
  name: string;
  notes: string;
  prerelease: boolean;
  published_at?: string;
  checksum_url?: string;
  /** GitHub Release 页面（说明与全部资产）。 */
  release_url?: string;
  /** 服务端快照年龄；超过 30 分钟说明它可能已经看不到更新版本。 */
  snapshot_age_seconds: number;
  assets: AppReleaseAsset[];
}

const ASSET_DELIVERIES: readonly string[] = ['cloudreve', 'github'];

export async function fetchAppRelease(base = '/api/v1', fetcher: typeof fetch = fetch): Promise<AppRelease> {
  const response = await fetcher(`${base.replace(/\/$/, '')}/app-update`, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  const payload = await readPayload(response);
  if (!response.ok) {
    const code = typeof payload?.code === 'string' && payload.code ? payload.code : `http_${response.status}`;
    const message = typeof payload?.message === 'string' ? payload.message : response.statusText;
    throw new Error(`${code}: ${message}`);
  }

  const release = payload as Partial<AppRelease> | null;
  if (!release || typeof release !== 'object') throw new Error('invalid_app_release_response');
  if (typeof release.tag_name !== 'string' || release.tag_name === '') throw new Error('invalid_app_release_response');
  if (!Array.isArray(release.assets)) throw new Error('invalid_app_release_response');

  const assets: AppReleaseAsset[] = [];
  for (const raw of release.assets) {
    const asset = raw as Partial<AppReleaseAsset> | null;
    if (!asset || typeof asset.name !== 'string' || asset.name === '') throw new Error('invalid_app_release_response');
    if (typeof asset.url !== 'string' || asset.url === '') throw new Error('invalid_app_release_response');
    if (typeof asset.delivery_type !== 'string' || !ASSET_DELIVERIES.includes(asset.delivery_type)) {
      throw new Error('invalid_app_release_response');
    }
    if (!Number.isSafeInteger(asset.size_bytes)) throw new Error('invalid_app_release_response');
    assets.push({
      name: asset.name,
      size_bytes: asset.size_bytes as number,
      sha256: typeof asset.sha256 === 'string' ? asset.sha256 : undefined,
      delivery_type: asset.delivery_type as AppAssetDelivery,
      node_id: typeof asset.node_id === 'string' ? asset.node_id : undefined,
      url: asset.url,
      expires_at: typeof asset.expires_at === 'string' ? asset.expires_at : undefined,
      allowed_download_origins: Array.isArray(asset.allowed_download_origins)
        ? asset.allowed_download_origins.filter((origin): origin is string => typeof origin === 'string')
        : [],
      github_url: typeof asset.github_url === 'string' ? asset.github_url : asset.url,
    });
  }

  return {
    tag_name: release.tag_name,
    version: typeof release.version === 'string' && release.version ? release.version : release.tag_name.replace(/^v/, ''),
    name: typeof release.name === 'string' ? release.name : '',
    notes: typeof release.notes === 'string' ? release.notes : '',
    prerelease: release.prerelease === true,
    published_at: typeof release.published_at === 'string' ? release.published_at : undefined,
    checksum_url: typeof release.checksum_url === 'string' ? release.checksum_url : undefined,
    release_url: typeof release.release_url === 'string' && release.release_url ? release.release_url : undefined,
    snapshot_age_seconds: Number.isFinite(release.snapshot_age_seconds) ? (release.snapshot_age_seconds as number) : 0,
    assets,
  };
}

async function readPayload(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
