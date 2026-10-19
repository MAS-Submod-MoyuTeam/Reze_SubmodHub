import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppUpdateModal } from './AppUpdateModal';
import type { AppUpdateState } from '../types/client';

function render(status: AppUpdateState['status'], error?: string, android = false, requiresPermission = false, requiresConfirmation = false) {
  return renderToStaticMarkup(<AppUpdateModal isOpen isAndroid={android} onOpenSettings={() => {}} onClose={() => {}} onCheckUpdate={() => {}}
    onDownloadUpdate={() => {}} onInstallUpdate={() => {}} onCancelUpdate={() => {}}
    updateState={{ status, current_version: '1.0.0', download_progress: 1, downloaded_bytes: 10,
      total_bytes: 10, can_install: true, requires_user_action: requiresConfirmation,
      requires_install_permission: requiresPermission, error }} />);
}

test('installation occupancy disables actions and explains the pending step', () => {
  for (const status of ['installing', 'awaiting_user'] as const) {
    const html = render(status);
    assert.match(html, /disabled=""/);
    assert.doesNotMatch(html, /立即替换并重启|检查更新<\/span>/);
    assert.match(html, status === 'installing' ? /正在启动更新/ : /等待系统安装确认/);
  }
});

test('failed handoff in ready state displays its error and permits retry', () => {
  const html = render('ready', 'installer unavailable');
  assert.match(html, /installer unavailable/);
  assert.match(html, /立即替换并重启/);
  assert.doesNotMatch(html, /disabled=""/);
});

test('Android cancellation preserves the staged APK and offers installation retry', () => {
  const html = render('ready', '用户取消了安装，请重试', true);
  assert.match(html, /用户取消了安装，请重试/);
  assert.match(html, /启动系统安装/);
  assert.doesNotMatch(html, /disabled=""|下载更新<\/span>|去授权/);
});

test('Android permission hint depends only on actual install permission', () => {
  for (const status of ['ready', 'awaiting_user'] as const) {
    assert.doesNotMatch(render(status, undefined, true, false, true), /未知应用权限|去授权/);
    assert.match(render(status, undefined, true, true, false), /未知应用权限/);
    assert.match(render(status, undefined, true, true, false), /去授权/);
    assert.doesNotMatch(render(status, undefined, false, true, true), /未知应用权限|去授权/);
  }
});
