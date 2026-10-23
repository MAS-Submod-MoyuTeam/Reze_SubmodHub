import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAppRelease, type AppRelease } from './app-release-api.js';

const descriptor = {
  tag_name: 'v0.9.11',
  version: '0.9.11',
  name: 'RezeHub 0.9.11',
  notes: 'notes',
  prerelease: false,
  published_at: '2026-10-20T10:00:00Z',
  checksum_url: 'https://github.com/o/r/releases/download/v0.9.11/SHA256SUMS.txt',
  release_url: 'https://github.com/o/r/releases/tag/v0.9.11',
  snapshot_age_seconds: 12,
  assets: [
    {
      name: 'submodhub-windows-amd64.exe',
      size_bytes: 42,
      sha256: 'a'.repeat(64),
      delivery_type: 'cloudreve',
      node_id: 'cloud',
      url: 'https://cdn.example/win.exe?sign=x',
      expires_at: '2026-10-20T10:05:00Z',
      allowed_download_origins: ['https://cdn.example'],
      github_url: 'https://github.com/o/r/releases/download/v0.9.11/submodhub-windows-amd64.exe',
    },
    {
      name: 'submodhub-android-arm64-0.9.11.apk',
      size_bytes: 7,
      delivery_type: 'github',
      url: 'https://github.com/o/r/releases/download/v0.9.11/a.apk',
      allowed_download_origins: [],
      github_url: 'https://github.com/o/r/releases/download/v0.9.11/a.apk',
    },
  ],
};

test('fetchAppRelease reads the public descriptor with its delivery plan', async () => {
  let requested: string | undefined;
  const fetcher: typeof fetch = async (input) => {
    requested = String(input);
    return Response.json(descriptor);
  };

  const release: AppRelease = await fetchAppRelease('http://127.0.0.1:8080/api/v1', fetcher);
  assert.equal(requested, 'http://127.0.0.1:8080/api/v1/app-update');
  assert.equal(release.version, '0.9.11');
  assert.equal(release.release_url, 'https://github.com/o/r/releases/tag/v0.9.11');
  assert.equal(release.snapshot_age_seconds, 12);
  assert.equal(release.assets.length, 2);
  assert.equal(release.assets[0].delivery_type, 'cloudreve');
  assert.equal(release.assets[0].expires_at, '2026-10-20T10:05:00Z');
  assert.equal(release.assets[1].delivery_type, 'github');
  assert.deepEqual(release.assets[1].allowed_download_origins, []);
});

test('fetchAppRelease surfaces the app_release_unavailable code', async () => {
  const fetcher: typeof fetch = async () =>
    new Response(JSON.stringify({ code: 'app_release_unavailable', message: 'not yet' }), { status: 503 });
  await assert.rejects(async () => fetchAppRelease('/api/v1', fetcher), /app_release_unavailable/);
});

test('fetchAppRelease rejects a descriptor without assets', async () => {
  const fetcher: typeof fetch = async () => Response.json({ tag_name: 'v1' });
  await assert.rejects(async () => fetchAppRelease('/api/v1', fetcher), /invalid_app_release_response/);
});

test('fetchAppRelease rejects an unknown delivery type', async () => {
  const fetcher: typeof fetch = async () =>
    Response.json({ tag_name: 'v1', assets: [{ name: 'x.exe', url: 'https://e/x', delivery_type: 'builtin', size_bytes: 1 }] });
  await assert.rejects(async () => fetchAppRelease('/api/v1', fetcher), /invalid_app_release_response/);
});

test('fetchAppRelease defaults optional fields instead of failing', async () => {
  const fetcher: typeof fetch = async () =>
    Response.json({ tag_name: 'v1.2.3', assets: [{ name: 'x.exe', url: 'https://e/x', delivery_type: 'github', size_bytes: 1 }] });
  const release = await fetchAppRelease('/api/v1', fetcher);
  assert.equal(release.version, '1.2.3');
  assert.equal(release.snapshot_age_seconds, 0);
  assert.equal(release.release_url, undefined);
  assert.equal(release.assets[0].github_url, 'https://e/x');
  assert.equal(release.assets[0].sha256, undefined);
});
