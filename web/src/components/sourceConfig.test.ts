import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateGitHubSourceInput,
  isCandidateVersionAllowed,
  formatLastSyncTime,
  getGitHubRepoUrl,
  manifestModeTradeoff,
  onDemandModeTradeoff,
  DEFAULT_REFRESH_WINDOW_MINUTES,
  describeRefreshWindow,
  refreshWindowText,
  MANIFEST_FILE_NAME,
  MANIFEST_SNIPPET,
} from './sourceConfig';

test('validates required github owner and repo', () => {
  assert.equal(validateGitHubSourceInput({ owner: '', repo: 'test', assetRegex: '.*\\.zip' }).valid, false);
  assert.equal(validateGitHubSourceInput({ owner: 'octo/cat', repo: 'test', assetRegex: '.*\\.zip' }).valid, false);
  assert.equal(validateGitHubSourceInput({ owner: 'octocat', repo: '', assetRegex: '.*\\.zip' }).valid, false);
  assert.equal(validateGitHubSourceInput({ owner: 'octocat', repo: 'hello/world', assetRegex: '.*\\.zip' }).valid, false);
});

test('validates regex syntax and source fallback combinations', () => {
  // Neither asset regex nor source code
  assert.equal(validateGitHubSourceInput({ owner: 'octocat', repo: 'hello', assetRegex: '', sourceCode: false }).valid, false);

  // Invalid regex syntax
  assert.equal(validateGitHubSourceInput({ owner: 'octocat', repo: 'hello', assetRegex: '[unclosed' }).valid, false);

  // Valid asset regex
  assert.equal(validateGitHubSourceInput({ owner: 'octocat', repo: 'hello', assetRegex: '^MyMod.*\\.zip$' }).valid, true);

  // Only source code fallback
  assert.equal(validateGitHubSourceInput({ owner: 'octocat', repo: 'hello', assetRegex: '', sourceCode: true }).valid, true);
});

test('checks whether candidate version creation is allowed based on source_type', () => {  assert.equal(isCandidateVersionAllowed(undefined), true);
  assert.equal(isCandidateVersionAllowed({ source_type: 'local' }), true);
  assert.equal(isCandidateVersionAllowed({ source_type: undefined }), true);
  assert.equal(isCandidateVersionAllowed({ source_type: 'github_releases' }), false);
});

test('formats last sync time', () => {
  assert.equal(formatLastSyncTime(undefined), '从未同步');
  assert.equal(formatLastSyncTime('invalid-date'), '从未同步');
  const formatted = formatLastSyncTime('2026-10-08T12:00:00Z');
  assert.notEqual(formatted, '从未同步');
});

test('builds github repository URL', () => {
  assert.equal(getGitHubRepoUrl('', 'repo'), '');
  assert.equal(getGitHubRepoUrl('owner', ''), '');
  assert.equal(getGitHubRepoUrl('octocat', 'hello-world'), 'https://github.com/octocat/hello-world');
});

test('manifest mode does not require an asset regex', () => {
  assert.equal(
    validateGitHubSourceInput({ owner: 'octocat', repo: 'hello', assetRegex: '', sourceCode: false, manifest: true }).valid,
    true,
  );
  // Owner and repo stay mandatory in both modes.
  assert.equal(validateGitHubSourceInput({ owner: '', repo: 'hello', manifest: true }).valid, false);
  // A broken regex is still rejected when one is supplied.
  assert.equal(validateGitHubSourceInput({ owner: 'octocat', repo: 'hello', assetRegex: '[bad', manifest: true }).valid, false);
  // Without the manifest flag the regex/fallback requirement still applies.
  assert.equal(validateGitHubSourceInput({ owner: 'octocat', repo: 'hello', assetRegex: '' }).valid, false);
});

test('tradeoff copy tells the author what each mode costs', () => {
  const manifest = manifestModeTradeoff();
  assert.ok(manifest.benefit.includes(MANIFEST_FILE_NAME));
  assert.ok(manifest.cost.includes(MANIFEST_FILE_NAME));
  assert.ok(manifest.cost.includes('维护'));

  // The copy quotes the server's window, so the default text is the default value.
  const defaultText = describeRefreshWindow(DEFAULT_REFRESH_WINDOW_MINUTES * 60);
  const onDemand = onDemandModeTradeoff(defaultText);
  assert.ok(onDemand.cost.includes(defaultText));
  // The sweep means an idle mod is no longer permanently stale.
  assert.ok(onDemand.cost.includes('后台巡检'));
  // A different server-side window must reach the copy verbatim.
  assert.ok(onDemandModeTradeoff('15 分钟').cost.includes('15 分钟'));
  assert.ok(onDemandModeTradeoff('已关闭自动刷新').cost.includes('已关闭自动刷新'));

  // Second-level durations render as readable Chinese, never as raw seconds.
  assert.equal(describeRefreshWindow(60 * 60), '1 小时');
  assert.equal(describeRefreshWindow(90 * 60), '1 小时 30 分钟');
  assert.equal(describeRefreshWindow(15 * 60), '15 分钟');
  assert.equal(describeRefreshWindow(0), '已关闭自动刷新');
  assert.equal(refreshWindowText(null), '1 小时');
  assert.equal(refreshWindowText({ github_sync_max_age: '5400s', github_sync_max_age_seconds: 5400, github_sync_max_age_configured: true }), '1 小时 30 分钟');
});

test('manifest snippet matches the document the server parses', () => {
  assert.ok(MANIFEST_SNIPPET.includes('schema: 1'));
  assert.ok(MANIFEST_SNIPPET.includes('releases:'));
  assert.ok(MANIFEST_SNIPPET.includes('version:'));
  assert.ok(MANIFEST_SNIPPET.includes('.zip'));
});
