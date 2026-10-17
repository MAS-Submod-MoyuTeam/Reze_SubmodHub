import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StorageAccessBanner } from './StorageAccessBanner';

test('StorageAccessBanner: renders permission prompt when state is denied', () => {
  const html = renderToStaticMarkup(
    <StorageAccessBanner
      isAndroid={true}
      storageState="denied"
      onRequestAccess={() => {}}
      onRefreshStatus={() => {}}
    />
  );

  assert.match(html, /所有文件访问权限/);
  assert.match(html, /去设置授权/);
  assert.match(html, /刷新状态/);
  assert.match(html, /支持远程商店浏览/);
});

test('StorageAccessBanner: renders unsupported warning when state is unsupported', () => {
  const html = renderToStaticMarkup(
    <StorageAccessBanner
      isAndroid={true}
      storageState="unsupported"
      onRequestAccess={() => {}}
      onRefreshStatus={() => {}}
    />
  );

  assert.match(html, /当前系统版本不支持/);
  assert.match(html, /Android 11\+/);
});

test('StorageAccessBanner: returns empty when granted or not on android', () => {
  const htmlGranted = renderToStaticMarkup(
    <StorageAccessBanner
      isAndroid={true}
      storageState="granted"
      onRequestAccess={() => {}}
      onRefreshStatus={() => {}}
    />
  );
  assert.equal(htmlGranted, '');

  const htmlDesktop = renderToStaticMarkup(
    <StorageAccessBanner
      isAndroid={false}
      storageState="denied"
      onRequestAccess={() => {}}
      onRefreshStatus={() => {}}
    />
  );
  assert.equal(htmlDesktop, '');
});
