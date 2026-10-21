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

  const onDemand = onDemandModeTradeoff();
  assert.ok(onDemand.cost.includes(`${DEFAULT_REFRESH_WINDOW_MINUTES} 分钟`));
  assert.ok(onDemand.cost.includes('延迟'));
  // A different server-side window must reach the copy.
  assert.ok(onDemandModeTradeoff(5).cost.includes('5 分钟'));
});

test('manifest snippet matches the document the server parses', () => {
  assert.ok(MANIFEST_SNIPPET.includes('schema: 1'));
  assert.ok(MANIFEST_SNIPPET.includes('releases:'));
  assert.ok(MANIFEST_SNIPPET.includes('version:'));
  assert.ok(MANIFEST_SNIPPET.includes('.zip'));
});
