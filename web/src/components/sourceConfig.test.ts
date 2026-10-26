import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateGitHubSourceInput,
  validatePlatformRule,
  validatePlatformRules,
  isPlatformRuleConfigured,
  configuredPlatformsForRules,
  supportedPlatformsForSource,
  guessPlatformFromFileName,
  platformModeTradeoff,
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

test('per-platform rules accept one or both platforms', () => {
  // A blank regex is only acceptable when that platform may fall back to source.
  assert.equal(validatePlatformRule('windows', '', false).valid, false);
  assert.equal(validatePlatformRule('windows', '', true).valid, true);
  assert.equal(validatePlatformRule('android', '   ', false).valid, false);
  assert.equal(validatePlatformRule('android', '[broken', false).valid, false);
  assert.equal(validatePlatformRule('android', 'MyMod-android\\.zip$', false).valid, true);

  // The message names the platform so the author knows which box is wrong.
  assert.ok(validatePlatformRule('android', '', false).error?.includes('Android'));
  assert.ok(validatePlatformRule('windows', '', false).error?.includes('Windows'));

  // A platform with neither a regex nor the source fallback is not configured.
  assert.equal(isPlatformRuleConfigured({ platform: 'windows' }), false);
  assert.equal(isPlatformRuleConfigured({ platform: 'windows', regex: '   ' }), false);
  assert.equal(isPlatformRuleConfigured({ platform: 'android', source_code: true }), true);
  assert.equal(isPlatformRuleConfigured({ platform: 'android', regex: 'a\\.zip$' }), true);

  // Splitting assets can support only Windows or only Android: whatever is left
  // blank is a platform this mod does not publish for.
  assert.equal(validatePlatformRules([]).valid, false);
  assert.equal(validatePlatformRules([{ platform: 'windows', regex: 'w\\.zip$' }]).valid, true);
  assert.equal(validatePlatformRules([{ platform: 'android', regex: 'a\\.zip$' }]).valid, true);
  assert.equal(validatePlatformRules([{ platform: 'android', source_code: true }]).valid, true);
  assert.equal(validatePlatformRules([{ platform: 'android' }]).valid, false);
  assert.equal(validatePlatformRules([
    { platform: 'windows', regex: 'MyMod-windows\\.zip$' },
    { platform: 'android', regex: 'MyMod-android\\.zip$' },
  ]).valid, true);
  // One bad rule fails the whole set, not just its own platform.
  assert.equal(validatePlatformRules([
    { platform: 'windows', regex: 'MyMod-windows\\.zip$' },
    { platform: 'android', regex: '[broken' },
  ]).valid, false);

  // The configured set is the supported platform set: filling only Android
  // means the mod supports only Android, not "Windows with nothing to download".
  assert.deepEqual(configuredPlatformsForRules({
    windows: { regex: '', sourceCode: false },
    android: { regex: 'a\\.zip$', sourceCode: false },
  }), ['android']);
  assert.deepEqual(configuredPlatformsForRules({
    windows: { regex: 'w\\.zip$', sourceCode: false },
    android: { regex: '', sourceCode: true },
  }), ['windows', 'android']);
  assert.deepEqual(configuredPlatformsForRules({
    windows: { regex: '', sourceCode: false },
    android: { regex: '', sourceCode: false },
  }), []);
});

test('shared regex stays optional when per-platform rules exist', () => {
  // Per-platform mode replaces the shared regex, so an empty shared regex with
  // platform rules must pass validation instead of demanding a matcher.
  assert.equal(validateGitHubSourceInput({
    owner: 'octocat',
    repo: 'hello',
    assetRegex: '',
    sourceCode: false,
    platformRules: [{ platform: 'windows', regex: 'w\\.zip$' }, { platform: 'android', regex: 'a\\.zip$' }],
  }).valid, true);
  // Choosing split mode without any platform must name that problem instead of
  // falling back to the unrelated "configure a shared regex" error.
  const empty = validateGitHubSourceInput({
    owner: 'octocat',
    repo: 'hello',
    platformMode: true,
    platformRules: [],
  });
  assert.equal(empty.valid, false);
  assert.ok(empty.error?.includes('至少需要配置一个平台'));
});

test('guesses a file name platform only when the tag is unambiguous', () => {
  assert.equal(guessPlatformFromFileName('MyMod-1.2.0-windows.zip'), 'windows');
  assert.equal(guessPlatformFromFileName('MyMod_1.2.0_Android.zip'), 'android');
  assert.equal(guessPlatformFromFileName('setup.exe'), 'windows');
  assert.equal(guessPlatformFromFileName('MyMod.apk'), 'android');
  // Names carrying both tags, or neither, stay unresolved rather than guessing.
  assert.equal(guessPlatformFromFileName('MyMod-windows-android.zip'), null);
  assert.equal(guessPlatformFromFileName('MyMod-1.2.0.zip'), null);
  assert.equal(guessPlatformFromFileName(''), null);
});

test('the submitted platform set is derived from the source configuration', () => {
  // Only Android configured means the mod only supports Android.
  assert.deepEqual(
    supportedPlatformsForSource({ sourceType: 'github_releases', splitPlatforms: true, configuredPlatforms: ['android'], declaredPlatforms: ['windows', 'android'] }),
    ['android'],
  );
  // A shared archive (and a manifest listing) serves every platform: narrowing a
  // shared file would hide installable mods from a platform filter.
  assert.deepEqual(
    supportedPlatformsForSource({ sourceType: 'github_releases', splitPlatforms: false, configuredPlatforms: [], declaredPlatforms: ['android'] }),
    ['windows', 'android'],
  );
  // Local sources keep the author's declared set.
  assert.deepEqual(
    supportedPlatformsForSource({ sourceType: 'local', splitPlatforms: false, configuredPlatforms: [], declaredPlatforms: ['android'] }),
    ['android'],
  );
});

test('platform tradeoff copy states one-platform and all-or-nothing rules', () => {
  const copy = platformModeTradeoff();
  // The benefit must not keep claiming both platforms always ship.
  assert.ok(!copy.benefit.includes('Windows 与 Android'));
  assert.ok(copy.cost.includes('只支持'));
  assert.ok(copy.cost.includes('整体跳过'));
});
