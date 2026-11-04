/**
 * 写剪贴板的唯一入口，Web 站点与客户端共用。
 *
 * 三种环境都可能缺异步剪贴板：
 * - 客户端跑在 WebView 里（旧内核 WebView2 / Android WebView）；
 * - 站点通过 http 局域网地址访问时不是安全上下文，`navigator.clipboard` 不存在；
 * - 异步 API 存在但被拒绝（document 没有焦点、用户/浏览器策略拒绝写入）。
 *
 * 第三种最容易漏：API 在、调用抛错，如果不兜底就只剩一句「复制失败」。
 * 所以统一成「先试新 API，失败就退回 textarea + execCommand」。
 * 返回值表示「文本到底有没有进了剪贴板」，调用方据此决定要不要把链接显示出来。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下面的旧方案
  }
  return copyWithTextarea(text);
}

/** 旧方案：一个不可见 textarea 选中后 `execCommand('copy')`。 */
function copyWithTextarea(text: string): boolean {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    // fixed + 透明：不改变布局，也不造成滚动跳动。
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}
