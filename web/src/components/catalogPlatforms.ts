/**
 * 目录页的平台筛选项。只保留实际会发布客户端的平台：Linux / macOS 暂无计划，
 * 展示出来只会让用户筛到一个永远为空的分类。
 *
 * 单独成模块而不是放在 CatalogView 里：筛选项是页面契约的一部分，测试只需要
 * 这份清单，不该为了它把整个页面（含 AppContext）的依赖图拉进 Node 测试。
 */
export const CATALOG_PLATFORM_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'windows', label: 'Windows' },
  { id: 'android', label: 'Android' },
] as const;
