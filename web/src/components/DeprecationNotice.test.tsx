import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { DeprecationNotice } from './DeprecationNotice';

test('shows the reason for a discouraged version', () => {
  const markup = renderToStaticMarkup(<DeprecationNotice deprecated reason="太旧了" />);
  assert.match(markup, /不推荐使用/);
  assert.match(markup, /太旧了/);
});

test('does not show a warning for a recommended version', () => {
  assert.equal(renderToStaticMarkup(<DeprecationNotice deprecated={false} reason="" />), '');
});

test('does not render a blank warning when a legacy reason is missing', () => {
  assert.match(renderToStaticMarkup(<DeprecationNotice deprecated reason="" />), /未提供原因/);
});
