/**
 * 「本站上传」模组的归档分发形状。
 *
 * 一个版本要么用一个归档服务所有平台，要么每个平台各一个归档 —— 服务端按同一套
 * 二分法存盘（见 internal/httpapi/platform_assets.go），两者不能混用。这里只负责把
 * 版本数据翻译成作者工作台可以直接渲染的形状与平台列表，不重复服务端的校验。
 */

import { ASSET_PLATFORMS, type AssetPlatform, type ModVersion, type Platform } from '../types/submodhub';

export type ArchiveShape = 'none' | 'shared' | 'split';

/** 版本已经落盘的形状；`none` 表示这个版本还没有上传过任何归档。 */
export function versionArchiveShape(version: ModVersion): ArchiveShape {
  if ((version.platform_assets?.length ?? 0) > 0) return 'split';
  // 版本级哈希/大小只在收到共用归档后才有值；扫描报告是同一件事的第二处证据。
  if (version.sha256 || version.size_bytes > 0 || version.scan_report_id) return 'shared';
  return 'none';
}

/**
 * 模组声明里真的能单独出包的平台，按 Windows → Android 排序。
 * 声明为空的（早期草稿）按「全平台」处理，否则分平台上传会一个按钮都没有。
 */
export function uploadPlatforms(declared: readonly Platform[] | undefined): AssetPlatform[] {
  const out = ASSET_PLATFORMS.filter((platform) => (declared ?? []).includes(platform));
  return out.length > 0 ? out : [...ASSET_PLATFORMS];
}

/**
 * 这个版本可以上传的平台：模组声明的平台 ∪ 版本已有的平台。
 * 已有归档必须始终能重新上传，哪怕模组后来把该平台取消声明了。
 */
export function versionUploadPlatforms(version: ModVersion, declared: readonly Platform[] | undefined): AssetPlatform[] {
  const shipped = (version.platform_assets ?? []).map((asset) => asset.platform);
  const declaredPlatforms = uploadPlatforms(declared);
  return ASSET_PLATFORMS.filter((platform) => shipped.includes(platform) || declaredPlatforms.includes(platform));
}

/**
 * 分平台版本还缺哪些已声明平台的归档。
 *
 * 目录按 supported_platforms 展示模组，平台缺归档时那个平台点下载只会拿到 404，
 * 所以提交审核前必须补齐；共用形状只有一个归档，永远不缺。
 */
export function missingPlatformArchives(version: ModVersion, platforms: readonly AssetPlatform[]): AssetPlatform[] {
  const shipped = version.platform_assets ?? [];
  if (shipped.length === 0) return [];
  return platforms.filter((platform) => !shipped.some((asset) => asset.platform === platform));
}

/** 模组编辑器里回显的发布平台：只保留真的能单独出包的两个平台。 */
export function localPlatformDeclaration(declared: readonly Platform[] | undefined): Platform[] {
  return uploadPlatforms(declared);
}

/**
 * 勾选/取消一个发布平台，结果固定按 Windows → Android 排序。
 * 允许清空（保存时拦下来），这样「一个都不勾」是一个看得见的状态而不是静默兜底。
 */
export function toggleLocalPlatform(current: readonly Platform[], platform: AssetPlatform): Platform[] {
  const selected = ASSET_PLATFORMS.filter((item) => current.includes(item));
  const next = selected.includes(platform) ? selected.filter((item) => item !== platform) : [...selected, platform];
  return ASSET_PLATFORMS.filter((item) => next.includes(item));
}
