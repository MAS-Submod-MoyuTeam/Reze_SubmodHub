/**
 * 令牌用量统计行的两种状态必须说清楚自己是什么。
 *
 * 这里钉的是「口径串味」：把本地滚动计数和 GitHub 回报的配额混成一句，或者在没有
 * 新到配额时显示 0——两者都会让管理员误判配额还剩多少，而这正是这一行存在的理由。
 */
import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { LangProvider } from '../i18n';
import { GitHubTokenUsageRow } from './GitHubTokenUsageRow';
import type { GitHubTokenUsage } from '../../../ui/settings-api';

const observedMinutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function render(usage: GitHubTokenUsage, lang: 'zh' | 'en' = 'zh') {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = {
    window: globals.window,
    document: globals.document,
    IS_REACT_ACT_ENVIRONMENT: globals.IS_REACT_ACT_ENVIRONMENT,
  };
  globals.window = dom.window;
  globals.document = dom.window.document;
  globals.IS_REACT_ACT_ENVIRONMENT = true;

  const root = createRoot(dom.window.document.getElementById('root')!);

  return {
    async paint() {
      await act(async () => {
        root.render(
          <LangProvider initialLang={lang}>
            <GitHubTokenUsageRow usage={usage} />
          </LangProvider>
        );
      });
    },
    text() {
      return dom.window.document.getElementById('root')?.textContent ?? '';
    },
    async restore() {
      await act(async () => {
        root.unmount();
      });
      globals.window = saved.window;
      globals.document = saved.document;
      globals.IS_REACT_ACT_ENVIRONMENT = saved.IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

test('有官方配额时同时显示本小时请求数与配额', async () => {
  const view = render({
    requests_last_hour: 7,
    rate_limit: { limit: 5000, used: 1234, observed_at: observedMinutesAgo(5) },
  });
  await view.paint();
  const text = view.text();
  await view.restore();

  assert.match(text, /近 1 小时请求：7 次/);
  assert.match(text, /官方配额已用 1234 \/ 5000/);
  assert.match(text, /· 5 分钟前观测/);
});

test('还没有官方配额时说等待回源，而不是显示 0', async () => {
  const view = render({ requests_last_hour: 3 });
  await view.paint();
  const text = view.text();
  await view.restore();

  assert.match(text, /近 1 小时请求：3 次/);
  assert.match(text, /官方配额：等待下一次回源/);
  assert.doesNotMatch(text, /官方配额已用/);
});

test('英文界面用英文口径，且占位符都被替换', async () => {
  const view = render(
    {
      requests_last_hour: 12,
      rate_limit: { limit: 5000, used: 4888, observed_at: observedMinutesAgo(12) },
    },
    'en'
  );
  await view.paint();
  const text = view.text();
  await view.restore();

  assert.match(text, /Last-hour requests: 12/);
  assert.match(text, /Official quota used: 4888 \/ 5000/);
  assert.match(text, /· observed 12 min ago/);
  assert.doesNotMatch(text, /\{.*\}/);
});

test('观测时间不可解析时不显示「几分钟前」，其余数字照常', async () => {
  const view = render({
    requests_last_hour: 1,
    rate_limit: { limit: 5000, used: 1, observed_at: 'not-a-timestamp' },
  });
  await view.paint();
  const text = view.text();
  await view.restore();

  assert.match(text, /官方配额已用 1 \/ 5000/);
  assert.doesNotMatch(text, /分钟前观测/);
});
