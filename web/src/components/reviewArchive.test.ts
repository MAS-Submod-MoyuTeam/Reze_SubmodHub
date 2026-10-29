import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { reviewArchiveErrorText, triggerArchiveSave } from './reviewArchive';

test('every archive download failure names the next step, not just a code', () => {
  assert.match(reviewArchiveErrorText(new Error('archive_not_found')), /没有保留这个版本的归档字节/);
  assert.match(reviewArchiveErrorText(new Error('platform_required')), /请先选择要核对的平台/);
  assert.match(reviewArchiveErrorText(new Error('platform_not_found')), /没有提供所选平台的归档/);
  assert.match(reviewArchiveErrorText(new Error('forbidden')), /没有审核权限/);
  assert.match(reviewArchiveErrorText(new Error('unauthenticated')), /登录已失效/);
  assert.match(reviewArchiveErrorText(new Error('download_size_mismatch')), /字节数与归档记录不一致/);
  assert.match(reviewArchiveErrorText(new Error('download_hash_mismatch')), /SHA-256 校验不通过/);
  assert.equal(reviewArchiveErrorText(new Error('http_500')), 'http_500');
  assert.equal(reviewArchiveErrorText('not an error'), '未知错误');
});

test('saves the verified archive under the name the server chose, then drops the link', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
  const oldDocument = globalThis.document;
  const mutableURL = URL as unknown as { createObjectURL?: (blob: Blob) => string; revokeObjectURL?: (url: string) => void };
  const oldCreate = mutableURL.createObjectURL;
  const oldRevoke = mutableURL.revokeObjectURL;
  const created: Blob[] = [];
  mutableURL.createObjectURL = (blob: Blob) => { created.push(blob); return 'blob:review-archive'; };
  mutableURL.revokeObjectURL = () => undefined;
  const clicks: Array<{ href: string | null; download: string }> = [];
  const prototype = dom.window.HTMLAnchorElement.prototype;
  const oldClick = prototype.click;
  prototype.click = function (this: HTMLAnchorElement) { clicks.push({ href: this.getAttribute('href'), download: this.download }); };
  Object.assign(globalThis, { document: dom.window.document });
  try {
    triggerArchiveSave(new Blob(['zip-bytes']), 'm1_1.2.3_windows.zip');
    assert.equal(created.length, 1, 'the blob is handed to the browser exactly once');
    assert.deepEqual(clicks, [{ href: 'blob:review-archive', download: 'm1_1.2.3_windows.zip' }]);
    assert.equal(dom.window.document.querySelectorAll('a').length, 0, 'the temporary link does not stay in the page');
    // A server that names no file must still produce a usable download.
    triggerArchiveSave(new Blob(['zip-bytes']), '');
    assert.equal(clicks[1].download, 'archive.zip');
  } finally {
    prototype.click = oldClick;
    mutableURL.createObjectURL = oldCreate;
    mutableURL.revokeObjectURL = oldRevoke;
    Object.assign(globalThis, { document: oldDocument });
    dom.window.close();
  }
});

// A server that names no file must still produce a usable download.
function TriggerFallbackName() {
  triggerArchiveSave(new Blob(['zip-bytes']), '');
}
