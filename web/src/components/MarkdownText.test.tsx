import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownText } from './MarkdownText';

test('fenced code preserves language, indentation and line breaks', () => {
  const html = renderToStaticMarkup(<MarkdownText value={'```python\ndef greet():\n    print("hello")\n```'} />);
  assert.match(html, /<pre[^>]*><code[^>]*class="[^"]*language-python[^"]*"/);
  assert.ok(html.includes('def greet():\n    print(&quot;hello&quot;)\n'));
  assert.ok(!html.includes('```'));
  assert.match(html, /overflow-x-auto/);
});

test('GFM tables, nested lists and links render as structured elements', () => {
  const html = renderToStaticMarkup(<MarkdownText value={'| Version | Status |\n| --- | --- |\n| 1.0 | **Released** |\n\n- Parent\n  - Child\n\n[Project](https://github.com/example/repo)'} />);
  assert.match(html, /<table/);
  assert.match(html, /<strong>Released<\/strong>/);
  assert.match(html, /<ul[^>]*>[\s\S]*<ul/);
  assert.match(html, /href="https:\/\/github.com\/example\/repo"/);
});

test('raw HTML and unsafe links cannot execute', () => {
  const html = renderToStaticMarkup(<MarkdownText value={'<script>alert(1)</script>\n\n[click](javascript:alert%281%29)'} />);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
});
