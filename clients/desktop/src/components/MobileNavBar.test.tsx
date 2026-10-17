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
