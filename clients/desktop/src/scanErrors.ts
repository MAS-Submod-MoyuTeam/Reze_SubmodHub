/**
 * 已安装视图的两个读取入口（已安装列表与未收纳扫描）共用同一个账本错误码。
 * `manifest_corrupt` 是不可自愈态：账本没有备份可回退，刷新或重新扫描只会再
 * 失败一次，所以文案必须给出账本路径并说明只能人工修复或重建，不能只写
 * 「请重新扫描」。其他错误原样返回，避免吞掉真实原因。
 */
export const MANIFEST_LEDGER_PATH = '.submodhub/state/manifest.json';

export function describeScanFailure(message: string): string {
  if (message.includes('manifest_corrupt')) {
    return `安装账本（${MANIFEST_LEDGER_PATH}）无法解析，已保留上一次读取结果。该状态不会自愈：刷新或重新扫描仍会失败，只能人工修复或重建这个文件。`;
  }
  return message;
}
