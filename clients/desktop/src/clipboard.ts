/**
 * 客户端写剪贴板的入口，转出共享实现。
 *
 * 实现放在 `ui/clipboard.ts`，因为 Web 站点也要做同一件事（详情页「复制分享
 * 链接」）。客户端跑在 WebView 里最容易遇上「异步 Clipboard API 在、但调用被
 * 拒绝」这一种，共享实现已经覆盖并有用例锁定。
 */
export { copyToClipboard } from '../../../ui/clipboard';
