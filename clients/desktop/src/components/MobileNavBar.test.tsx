import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MobileNavBar } from './MobileNavBar';

test('MobileNavBar: renders mobile tabs and highlights active tab', () => {
  const html = renderToStaticMarkup(
    <MobileNavBar
      activeTab="catalog"
      onTabChange={() => {}}
      updatesCount={2}
      activeOperationsCount={1}
    />
  );

  assert.match(html, /商店/);
  assert.match(html, /已安装/);
  assert.match(html, /优先级/);
  assert.match(html, /任务/);
  assert.match(html, /实例/);
  assert.match(html, /grid-cols-5/);
  assert.match(html, /text-primary/); // active tab highlight
  assert.match(html, />2</); // updates badge
});

test('MobileNavBar: highlights priority tab when active', () => {
  const html = renderToStaticMarkup(
    <MobileNavBar
      activeTab="priority"
      onTabChange={() => {}}
    />
  );

  assert.match(html, /优先级/);
  assert.match(html, /text-primary/);
});

test('MobileNavBar: 每个页签都有悬停、按下与键盘焦点反馈', () => {
  const html = renderToStaticMarkup(
    <MobileNavBar activeTab="catalog" onTabChange={() => {}} updatesCount={0} activeOperationsCount={0} />
  );
  // 底部导航在 Android 上没有鼠标，`active:` 是唯一的即时反馈；
  // `hover:` 只在真指针设备生效（Tailwind 用 @media (hover:hover) 包住）。
  assert.match(html, /hover:/);
  assert.match(html, /active:brightness-95/);
  assert.match(html, /focus-visible:outline-2/);
  assert.match(html, /aria-current="page"/);
});
