/**
 * 审核页的「下载归档核对」：把服务端保留的待审 ZIP 交给浏览器保存。
 *
 * 归档接口要求管理员会话，所以不能直接给一个 <a href>：失败会变成一页 JSON，
 * 也没法在保存前核对字节。这里先取回并校验，再交给浏览器下载。
 */

/** 把已经过大小与 SHA-256 校验的归档交给浏览器保存。 */
export function triggerArchiveSave(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'archive.zip';
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // 立刻 revoke 会让部分浏览器取消尚未开始的保存；一秒足够下载启动，也不至于让
  // object URL 一直占着这份归档。
  setTimeout(() => URL.revokeObjectURL?.(url), 1000);
}

/** 下载失败时告诉管理员下一步做什么，而不是只抛一个错误码。 */
export function reviewArchiveErrorText(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  switch (code) {
    case 'archive_not_found':
      return '服务端没有保留这个版本的归档字节，无法下载核对。';
    case 'platform_required':
      return '请先选择要核对的平台，再下载该平台的归档。';
    case 'platform_not_found':
      return '这个版本没有提供所选平台的归档。';
    case 'forbidden':
      return '当前会话没有审核权限，无法下载待审归档。';
    case 'unauthenticated':
      return '登录已失效，请重新登录后再下载。';
    case 'download_size_mismatch':
      return '下载到的字节数与归档记录不一致，这次下载已丢弃。';
    case 'download_hash_mismatch':
      return 'SHA-256 校验不通过，这次下载已丢弃；请重新下载或检查服务端归档。';
    default:
      return code || '未知错误';
  }
}
