import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderToStaticMarkup } from 'react-dom/server';
import { AppContext, type AppContextType } from '../context/AppContext';
import { LoginModal } from './LoginModal';
import { createMockContext } from '../test/appContextMock';
import type { User } from '../types/submodhub';

const adminUser: User = {
  id: 'admin_1',
  username: 'admin',
  display_name: '管理员',
  roles: ['admin'],
};

function renderLoginModal(overrides: Partial<AppContextType> = {}): string {
  return renderToStaticMarkup(
    <AppContext.Provider value={createMockContext(overrides)}>
      <LoginModal isOpen onClose={() => {}} />
    </AppContext.Provider>
  );
}

// Flarum 是唯一登录提供方：GitHub OAuth 按钮、分隔线与其文案已移除。
test('logged-out login modal offers Flarum credentials only', () => {
  const markup = renderLoginModal();

  assert.match(markup, />登录<\/button>/);
  assert.match(markup, /DCC论坛凭据登录/);
  assert.match(markup, /<label[^>]*>密码<\/label>/);
  assert.doesNotMatch(markup, /密码仅由服务端代验/);
  assert.doesNotMatch(markup, /GitHub/i);
  assert.doesNotMatch(markup, /OAuth/i);
});

// 回归护栏：账号关联入口是死链（后端没有 /identity-links，Flarum 又是唯一身份来源），
// 不允许再长出「绑定 / 关联」按钮或表单。
test('logged-in login modal exposes no account-linking entry point', () => {
  const markup = renderLoginModal({ currentUser: adminUser });

  assert.match(markup, /管理员/);
  assert.match(markup, /退出当前会话/);
  assert.doesNotMatch(markup, /绑定/);
  assert.doesNotMatch(markup, /关联/);
  assert.doesNotMatch(markup, /GitHub/i);
});

test('closed login modal renders nothing', () => {
  const markup = renderToStaticMarkup(
    <AppContext.Provider value={createMockContext()}>
      <LoginModal isOpen={false} onClose={() => {}} />
    </AppContext.Provider>
  );

  assert.equal(markup, '');
});
