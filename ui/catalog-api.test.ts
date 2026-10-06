import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fetchDownloadDescriptor, fetchPublishedCatalog, fetchVerifiedArchive } from './catalog-api';

test('loads the published catalog and its latest versions', async () => {
  const paths: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    const path = String(input);
    paths.push(path);
    if (path.endsWith('/mods')) {
      return Response.json({ items: [{ id: 'm1', title: 'Rain', latest_version_id: 'v1' }], next_cursor: null });
    }
    return Response.json({ id: 'v1', mod_id: 'm1', state: 'published', version: '1.0.0', sha256: 'a'.repeat(64), size_bytes: 8 });
  };
  const result = await fetchPublishedCatalog('/api/v1', fetcher as typeof fetch);
  assert.equal(result.length, 1);
  assert.equal(result[0].version.version, '1.0.0');
  assert.deepEqual(paths, ['/api/v1/mods', '/api/v1/mods/m1/versions/v1']);
});

test('does not replace failed API responses with demo content', async () => {
  const fetcher = async () => Response.json({ code: 'storage_error', message: 'unavailable' }, { status: 503 });
  await assert.rejects(fetchPublishedCatalog('/api/v1', fetcher as typeof fetch), /storage_error/);
});

test('loads a real archive descriptor without inventing a signed URL', async () => {
  const fetcher = async (input: RequestInfo | URL) => {
    assert.equal(String(input), '/api/v1/versions/v1/download');
    return Response.json({ url: '/api/v1/archives/v1', expires_at: '2026-10-04T12:00:00Z', sha256: 'b'.repeat(64), size_bytes: 42 });
  };
  const descriptor = await fetchDownloadDescriptor('v1', '/api/v1', fetcher as typeof fetch);
  assert.equal(descriptor.url, '/api/v1/archives/v1');
  assert.equal(descriptor.size_bytes, 42);
});

test('loads every catalog page for web and desktop consumers', async () => {
  const paths: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    const path = String(input);
    paths.push(path);
    if (path === '/api/v1/mods') return Response.json({ items: [{ id: 'm1', latest_version_id: 'v1' }], next_cursor: 'next-page' });
    if (path === '/api/v1/mods?cursor=next-page') return Response.json({ items: [{ id: 'm2', latest_version_id: 'v2' }], next_cursor: null });
    const id = path.endsWith('/v1') ? '1' : '2';
    return Response.json({ id: `v${id}`, mod_id: `m${id}`, state: 'published', size_bytes: 1, sha256: 'a'.repeat(64) });
  };
  const result = await fetchPublishedCatalog('/api/v1', fetcher as typeof fetch);
  assert.deepEqual(result.map(({ mod }) => mod.id), ['m1', 'm2']);
  assert(paths.includes('/api/v1/mods?cursor=next-page'));
});

test('returns archive bytes only after size and SHA-256 verification', async () => {
  const bytes = new TextEncoder().encode('fixture ZIP bytes');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const fetcher = async (input: RequestInfo | URL) => String(input).endsWith('/download')
    ? Response.json({ url: '/api/v1/archives/v1', expires_at: '2099-01-01T00:00:00Z', sha256, size_bytes: bytes.length })
    : new Response(bytes);
  const result = await fetchVerifiedArchive('v1', '/api/v1', fetcher as typeof fetch);
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), bytes);
  assert.equal(result.sha256, sha256);
});

test('rejects changed archive size or hash before saving', async () => {
  const bytes = new TextEncoder().encode('bad bytes');
  for (const [size, sha256, code] of [
    [bytes.length + 1, createHash('sha256').update(bytes).digest('hex'), 'download_size_mismatch'],
    [bytes.length, '0'.repeat(64), 'download_hash_mismatch'],
  ] as const) {
    const fetcher = async (input: RequestInfo | URL) => String(input).endsWith('/download')
      ? Response.json({ url: '/api/v1/archives/v1', expires_at: '2099-01-01T00:00:00Z', sha256, size_bytes: size })
      : new Response(bytes);
    await assert.rejects(fetchVerifiedArchive('v1', '/api/v1', fetcher as typeof fetch), new RegExp(code));
  }
});

test('resolves archive paths against the configured API origin', async () => {
  const bytes = new TextEncoder().encode('zip');
  const requests: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return String(input).endsWith('/download')
      ? Response.json({ url: '/api/v1/archives/v1', expires_at: '2099-01-01T00:00:00Z', sha256: createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length })
      : new Response(bytes);
  };
  await fetchVerifiedArchive('v1', 'https://api.example.test/api/v1', fetcher as typeof fetch);
  assert.equal(requests[1], 'https://api.example.test/api/v1/archives/v1');
});

test('rejects protocol-relative archive URLs and oversized browser downloads', async () => {
  for (const descriptor of [
    { url: '//other.example.test/zip', size_bytes: 1 },
    { url: '/api/v1/archives/v1', size_bytes: 65 * 1024 * 1024 },
  ]) {
    let archiveRequested = false;
    const fetcher = async (input: RequestInfo | URL) => {
      if (!String(input).endsWith('/download')) archiveRequested = true;
      return Response.json({ ...descriptor, expires_at: '2099-01-01T00:00:00Z', sha256: 'a'.repeat(64) });
    };
    await assert.rejects(fetchVerifiedArchive('v1', '/api/v1', fetcher as typeof fetch));
    assert.equal(archiveRequested, false);
  }
});
