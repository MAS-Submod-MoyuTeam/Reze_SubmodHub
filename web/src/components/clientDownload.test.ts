import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAssetName,
  detectDevicePlatform,
  githubDownloadURL,
  isTrustedHostedLink,
  linkExpiringSoon,
  listClientDownloads,
  pickSameReleaseAsset,
  resolveDownloadRoute,
  shortHash,
} from './clientDownload';
import type { AppRelease, AppReleaseAsset } from '../../../ui/app-release-api';

const asset = (name: string, patch: Partial<AppReleaseAsset> = {}): AppReleaseAsset => ({
  name,
  size_bytes: 1024,
  delivery_type: 'github',
  url: `https://github.com/o/r/releases/download/v1/${name}`,
  allowed_download_origins: [],
  github_url: `https://github.com/o/r/releases/download/v1/${name}`,
  ...patch,
});

const hosted = (patch: Partial<AppReleaseAsset> = {}): AppReleaseAsset =>
  asset('submodhub-windows-amd64.exe', {
    delivery_type: 'cloudreve',
    node_id: 'cloud',
    url: 'https://cdn.example/win.exe?sign=x',
    expires_at: '2026-10-23T10:05:00Z',
    allowed_download_origins: ['https://cdn.example'],
    ...patch,
  });

const now = Date.parse('2026-10-23T10:00:00Z');

const release = (assets: AppReleaseAsset[], patch: Partial<AppRelease> = {}): AppRelease => ({
  tag_name: 'v0.9.11',
  version: '0.9.11',
  name: 'RezeHub 0.9.11',
  notes: '',
  prerelease: false,
  snapshot_age_seconds: 12,
  assets,
  ...patch,
});

test('classifyAssetName keeps the updater out of the installer list', () => {
  assert.equal(classifyAssetName('submodhub-windows-amd64.exe'), 'windows');
  assert.equal(classifyAssetName('submodhub-android-arm64-0.9.11.apk'), 'android');
  assert.equal(classifyAssetName('updater.exe'), 'other');
  assert.equal(classifyAssetName('SHA256SUMS.txt'), 'other');
});

test('listClientDownloads puts the browsing device first and keeps the other platform', () => {
  const assets = [asset('updater.exe'), asset('submodhub-windows-amd64.exe'), asset('submodhub-android-arm64-0.9.11.apk')];

  const onPhone = listClientDownloads(assets, 'android');
  assert.deepEqual(onPhone.map((option) => option.platform), ['android', 'windows']);

  const onDesktop = listClientDownloads(assets, 'windows');
  assert.deepEqual(onDesktop.map((option) => option.platform), ['windows', 'android']);

  // Unknown preference falls back to the desktop-first order.
  assert.deepEqual(listClientDownloads(assets, 'other').map((option) => option.platform), ['windows', 'android']);
});

test('listClientDownloads returns nothing when the release has no installers', () => {
  assert.deepEqual(listClientDownloads([asset('updater.exe')], 'windows'), []);
});

test('detectDevicePlatform reads the user agent without guessing', () => {
  assert.equal(detectDevicePlatform('Mozilla/5.0 (Linux; Android 14; Pixel)'), 'android');
  assert.equal(detectDevicePlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), 'windows');
  assert.equal(detectDevicePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), 'other');
});

test('linkExpiringSoon treats a missing expiry as long-lived and an unparseable one as expiring', () => {
  assert.equal(linkExpiringSoon(undefined, now), false);
  assert.equal(linkExpiringSoon('2026-10-23T10:04:00Z', now), false);
  assert.equal(linkExpiringSoon('2026-10-23T10:00:10Z', now), true);
  assert.equal(linkExpiringSoon('2026-10-23T09:59:00Z', now), true);
  // 解析不了的过期时间按「即将过期」处理：宁可多换一次链接。
  assert.equal(linkExpiringSoon('not-a-timestamp', now), true);
});

test('resolveDownloadRoute serves the node link while it is fresh', () => {
  const route = resolveDownloadRoute(hosted(), now);
  assert.equal(route.source, 'cloudreve');
  assert.equal(route.href, 'https://cdn.example/win.exe?sign=x');
  assert.equal(route.needsFreshLink, false);
});

test('resolveDownloadRoute never hands out an expiring node link', () => {
  const route = resolveDownloadRoute(hosted({ expires_at: '2026-10-23T10:00:05Z' }), now);
  assert.equal(route.source, 'github');
  assert.equal(route.needsFreshLink, true);
  // 过期直链绝不作为兜底：宁可去 GitHub，也不要把用户送到死链上。
  assert.equal(route.href, 'https://github.com/o/r/releases/download/v1/submodhub-windows-amd64.exe');
});

test('resolveDownloadRoute rejects node links the allowlist does not cover', () => {
  const route = resolveDownloadRoute(hosted({ allowed_download_origins: ['https://other.example'] }), now);
  assert.equal(route.source, 'github');
  assert.equal(route.needsFreshLink, false);
});

test('isTrustedHostedLink only accepts https public origins', () => {
  assert.equal(isTrustedHostedLink(hosted()), true);
  // 白名单为空不当作可疑：服务端已读回校验镜像，浏览器跳转也不带凭据。
  assert.equal(isTrustedHostedLink(hosted({ allowed_download_origins: [] })), true);
  assert.equal(isTrustedHostedLink(hosted({ url: 'http://cdn.example/win.exe' })), false);
  assert.equal(isTrustedHostedLink(hosted({ url: 'https://localhost/win.exe', allowed_download_origins: [] })), false);
  assert.equal(isTrustedHostedLink(hosted({ url: 'https://192.168.1.9/win.exe', allowed_download_origins: [] })), false);
  assert.equal(isTrustedHostedLink(hosted({ url: 'https://user:pw@cdn.example/win.exe' })), false);
  assert.equal(isTrustedHostedLink(hosted({ url: 'not a url' })), false);
  // 非节点交付的资产不参与这套判定。
  assert.equal(isTrustedHostedLink(asset('submodhub-windows-amd64.exe')), true);
});

test('githubDownloadURL keeps working for old descriptors', () => {
  assert.equal(githubDownloadURL(asset('x.exe')), 'https://github.com/o/r/releases/download/v1/x.exe');
  assert.equal(
    githubDownloadURL({ ...asset('x.exe'), delivery_type: 'github', github_url: '' }),
    'https://github.com/o/r/releases/download/v1/x.exe',
  );
});

test('pickSameReleaseAsset refuses to swap in another release', () => {
  const fresh = release([hosted({ expires_at: '2026-10-23T10:04:00Z' })]);
  assert.equal(pickSameReleaseAsset(fresh, 'v0.9.11', 'submodhub-windows-amd64.exe')?.name, 'submodhub-windows-amd64.exe');
  // tag 变了：整份描述作废，调用方会退回 GitHub 直链。
  assert.equal(pickSameReleaseAsset(fresh, 'v0.9.10', 'submodhub-windows-amd64.exe'), undefined);
  // 没有同名资产同样作废。
  assert.equal(pickSameReleaseAsset(fresh, 'v0.9.11', 'missing.apk'), undefined);
});

test('shortHash keeps both ends of the digest', () => {
  const digest = '0123456789abcdef'.repeat(4);
  assert.equal(shortHash(digest), '01234567…89abcdef');
  assert.equal(shortHash(undefined), '');
});
