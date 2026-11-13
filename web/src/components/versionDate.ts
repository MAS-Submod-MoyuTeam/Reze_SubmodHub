/**
 * 版本创建时间的展示格式。
 *
 * 这是纯格式化函数，拿不到 hook，所以「未记录」的兜底文案由调用方传入，
 * 避免切到英文时这里仍吐中文。
 */
export function formatVersionCreatedAt(value?: string, unknownLabel = ''): string {
  if (!value) return unknownLabel;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? unknownLabel : date.toLocaleDateString();
}
