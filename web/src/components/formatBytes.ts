/**
 * 字节大小的唯一格式化实现：安装列表、模组详情和客户端下载都从这里取。
 *
 * 之前这里有三份各自为政的拷贝（0 B / 1.0 KB / 5.00 MB 三种口径），
 * 同一个文件在不同弹窗里会显示成不同大小，所以统一到一处。
 *
 * 这是个纯格式化函数，拿不到 hook，所以「未知」这类需要翻译的兜底文案由
 * 调用方通过 `unknownLabel` 传入（通常就是 `t('common.unknown')`）。
 */
export function formatBytes(bytes: number, unknownLabel = ''): string {
  if (!Number.isFinite(bytes) || bytes < 0) return unknownLabel;
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
