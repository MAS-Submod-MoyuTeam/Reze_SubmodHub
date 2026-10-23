/**
 * 前端 API base 的唯一来源。
 *
 * `VITE_API_BASE_URL` 允许把 Web 指向另一个后端，未设置时就是同源的 `/api/v1`。
 * 在此之前这段拼接在 web/src 里被复制了三十多次，改一处就得改三十处。
 */
export function apiBase(): string {
  return `${(import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
}
