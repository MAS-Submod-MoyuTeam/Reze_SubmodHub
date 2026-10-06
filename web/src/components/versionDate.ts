export function formatVersionCreatedAt(value?: string): string {
  if (!value) return '创建时间未记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '创建时间未记录' : date.toLocaleDateString();
}
