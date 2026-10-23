import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClientDownloadPanel } from './ClientDownloadModal';
import type { AppRelease, AppReleaseAsset } from '../../../ui/app-release-api';

const windowsAsset: AppReleaseAsset = {
  name: 'submodhub-windows-amd64.exe',
  size_bytes: 5 * 1024 * 1024,
  sha256: '0123456789abcdef'.repeat(4),
  delivery_type: 'cloudreve',
  node_id: 'cloud',
  url: 'https://cdn.example/win.exe?sign=x',
  expires_at: '2099-01-01T00:00:00Z',
  allowed_download_origins: ['https://cdn.example'],
  github_url: 'https://github.com/o/r/releases/download/v0.9.11/submodhub-windows-amd64.exe',
};

const androidAsset: AppReleaseAsset = {
  name: 'submodhub-android-arm64-0.9.11.apk',
  size_bytes: 2048,
  delivery_type: 'github',
  url: 'https://github.com/o/r/releases/download/v0.9.11/submodhub-android-arm64-0.9.11.apk',
  allowed_download_origins: [],
  github_url: 'https://github.com/o/r/releases/download/v0.9.11/submodhub-android-arm64-0.9.11.apk',
};

const release = (assets: AppReleaseAsset[], patch: Partial<AppRelease> = {}): AppRelease => ({
  tag_name: 'v0.9.11',
  version: '0.9.11',
  name: 'RezeHub 0.9.11',
  notes: '',
  prerelease: false,
  published_at: '2026-10-20T10:00:00Z',
  checksum_url: 'https://github.com/o/r/releases/download/v0.9.11/SHA256SUMS.txt',
  release_url: 'https://github.com/o/r/releases/tag/v0.9.11',
  snapshot_age_seconds: 12,
  assets,
  ...patch,
});

const render = (element: React.ReactElement) => renderToStaticMarkup(element);

test('offers the site node first and keeps the GitHub fallback per asset', () => {
  const markup = render(
    <ClientDownloadPanel
      status="ready"
      release={release([windowsAsset, androidAsset])}
      device="windows"
      onDownload={() => {}}
      onRetry={() => {}}
    />,
  );

  assert.match(markup, /v0\.9\.11/);
  assert.match(markup, /submodhub-windows-amd64\.exe/);
  assert.match(markup, /从本站下载/);
  assert.match(markup, /来源：本站节点（Cloudreve）/);
  assert.match(markup, /href="https:\/\/github\.com\/o\/r\/releases\/download\/v0\.9\.11\/submodhub-windows-amd64\.exe"/);
  assert.match(markup, /submodhub-android-arm64-0\.9\.11\.apk/);
  assert.match(markup, /从 GitHub 下载/);
  assert.match(markup, /来源：GitHub Releases/);
  assert.match(markup, /5\.0 MB/);
  assert.match(markup, /2\.0 KB/);
  assert.match(markup, /SHA-256 01234567…89abcdef/);
  assert.match(markup, /前往 GitHub Releases/);
  assert.match(markup, /SHA256SUMS\.txt/);
  // The browsing device is marked, and it is rendered before the other platform.
  assert.match(markup, /当前设备/);
  assert.ok(markup.indexOf('Windows') < markup.indexOf('Android'));
});

test('falls back to GitHub when the node link is not trustworthy', () => {
  const markup = render(
    <ClientDownloadPanel
      status="ready"
      release={release([{ ...windowsAsset, allowed_download_origins: ['https://other.example'] }])}
      device="windows"
      onDownload={() => {}}
      onRetry={() => {}}
    />,
  );
  assert.match(markup, /来源：GitHub Releases/);
  assert.match(markup, /从 GitHub 下载/);
  assert.doesNotMatch(markup, /从本站下载/);
});

test('announces that an expiring node link is exchanged before download', () => {
  const markup = render(
    <ClientDownloadPanel
      status="ready"
      release={release([{ ...windowsAsset, expires_at: '2000-01-01T00:00:00Z' }])}
      device="windows"
      onDownload={() => {}}
      onRetry={() => {}}
    />,
  );
  assert.match(markup, /节点直链已临期/);
  // 过期直链不会被当成可点的来源展示。
  assert.match(markup, /来源：GitHub Releases/);
});

test('marks the phone when the visitor is on Android', () => {
  const markup = render(
    <ClientDownloadPanel
      status="ready"
      release={release([windowsAsset, androidAsset])}
      device="android"
      onDownload={() => {}}
      onRetry={() => {}}
    />,
  );
  assert.ok(markup.indexOf('submodhub-android-arm64-0.9.11.apk') < markup.indexOf('submodhub-windows-amd64.exe'));
});

test('warns when the server snapshot is too old to be authoritative', () => {
  const markup = render(
    <ClientDownloadPanel
      status="ready"
      release={release([windowsAsset], { snapshot_age_seconds: 45 * 60 })}
      device="windows"
      onDownload={() => {}}
      onRetry={() => {}}
    />,
  );
  assert.match(markup, /45 分钟没有成功读取 GitHub 发布信息/);
});

test('explains an unavailable descriptor and offers a retry', () => {
  const markup = render(
    <ClientDownloadPanel
      status="error"
      release={null}
      errorMessage="站点还没有取得最新 Release 的元数据，暂时无法给出下载地址。"
      device="windows"
      onDownload={() => {}}
      onRetry={() => {}}
    />,
  );
  assert.match(markup, /下载信息不可用/);
  assert.match(markup, /暂时无法给出下载地址/);
  assert.match(markup, /重试/);
  assert.doesNotMatch(markup, /从本站下载/);
});

test('reports a release without installable assets instead of rendering an empty list', () => {
  const markup = render(
    <ClientDownloadPanel
      status="ready"
      release={release([{ ...windowsAsset, name: 'updater.exe' }])}
      device="windows"
      onDownload={() => {}}
      onRetry={() => {}}
    />,
  );
  assert.match(markup, /当前发布没有可安装的 Windows \/ Android 资产/);
  assert.doesNotMatch(markup, /从本站下载/);
});

test('shows a loading state before the descriptor arrives', () => {
  const markup = render(
    <ClientDownloadPanel status="loading" release={null} device="windows" onDownload={() => {}} onRetry={() => {}} />,
  );
  assert.match(markup, /正在获取最新客户端版本信息/);
});
