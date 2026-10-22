import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { TagPicker } from './TagPicker';
import type { TagGroup } from '../../../ui/tags-api';

const groups: TagGroup[] = [
  { name: '工具', children: ['绘图', '脚本'] },
  { name: '音乐' },
];

test('renders main tags with their children and no free-text input', () => {
  const html = renderToStaticMarkup(<TagPicker groups={groups} value={[]} onChange={() => {}} />);
  assert.match(html, /#工具/);
  assert.match(html, /#绘图/);
  assert.match(html, /#脚本/);
  assert.match(html, /已选 0\/8/);
  assert.match(html, /至少选择一个标签/);
  assert.equal(html.includes('<input'), false, 'the picker must not offer a free-form tag input');
});

test('a selected child also highlights its main tag', () => {
  const html = renderToStaticMarkup(<TagPicker groups={groups} value={['工具', '绘图']} onChange={() => {}} />);
  const pressed = (html.match(/aria-pressed="true"/g) || []).length;
  assert.equal(pressed, 2, html);
  assert.match(html, /已选 2\/8/);
});

test('the cap disables unselected chips', () => {
  const full = Array.from({ length: 8 }, (_, index) => `t${index}`);
  const html = renderToStaticMarkup(<TagPicker groups={groups} value={full} onChange={() => {}} />);
  assert.match(html, /已选 8\/8/);
  // Every chip in the fixture catalog is unselected and therefore disabled.
  assert.equal((html.match(/disabled=""/g) || []).length, 4);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 0);
});

test('a loading catalog and a failed catalog are reported instead of chips', () => {
  const loading = renderToStaticMarkup(<TagPicker groups={[]} value={[]} onChange={() => {}} loading />);
  assert.match(loading, /正在读取标签目录/);
  const failed = renderToStaticMarkup(<TagPicker groups={[]} value={[]} onChange={() => {}} error="标签目录读取失败，请稍后重试" />);
  assert.match(failed, /role="alert"/);
  assert.match(failed, /标签目录读取失败/);
  const empty = renderToStaticMarkup(<TagPicker groups={[]} value={[]} onChange={() => {}} />);
  assert.match(empty, /标签目录为空/);
});
