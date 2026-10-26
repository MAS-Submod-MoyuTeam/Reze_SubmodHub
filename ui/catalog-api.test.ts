import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { fetchDownloadDescriptor, fetchModVersion, fetchPublishedCatalog, fetchSpriteManifest, fetchSpriteSets, fetchVerifiedArchive, fetchVerifiedSpriteSelection } from './catalog-api';

test('external archive requires declared origin and omits credentials', async () => {
 const bytes=new TextEncoder().encode('zip');const hash=createHash('sha256').update(bytes).digest('hex');
 let allowed=true;let downloads=0;
 const fetcher: typeof fetch=async (input,init)=>{
 if(String(input).includes('/versions/'))return Response.json({url:'https://cdn.example/archive',expires_at:new Date(Date.now()+60000).toISOString(),sha256:hash,size_bytes:3,allowed_download_origins:allowed?['https://cdn.example']:[]});
 downloads++;assert.equal(init?.credentials,'omit');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).has('Authorization'),false);return new Response(bytes);
 };
 await fetchVerifiedArchive('v','https://api.example/api/v1',fetcher);assert.equal(downloads,1);
 allowed=false;await assert.rejects(fetchVerifiedArchive('v','https://api.example/api/v1',fetcher),/download_origin_forbidden/);assert.equal(downloads,1);
});

test('rejects private and reserved external origins even when declared',async()=>{
 for(const host of ['172.16.0.1','172.31.255.255','100.64.0.1','100.127.255.255','[fd00::1]','[::1]']){
 let requests=0;const fetcher:typeof fetch=async()=>{requests++;return Response.json({url:`https://${host}/archive`,expires_at:new Date(Date.now()+60000).toISOString(),sha256:'a'.repeat(64),size_bytes:3,allowed_download_origins:[`https://${host}`]});};
 await assert.rejects(fetchVerifiedArchive('v','https://api.example/api/v1',fetcher),/download_origin_forbidden/);assert.equal(requests,1);
 }
});

test('loads sprite manifest with version_id and verifies a selected ZIP hash', async () => {
  const bytes = new TextEncoder().encode('selected sprite ZIP');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const requests: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    requests.push(String(input));
    if (String(input).endsWith('/spritepacks/m1')) {
      return Response.json({ version_id: 'v_manifest_1', sets: [{ id: 'set_a', name: 'Set A', items: [{ display_name: '和服', preview_url: '/api/v1/spritepacks/m1/preview?set=set_a&item=0' }] }] });
    }
    return new Response(bytes, { headers: { 'X-Archive-SHA256': hash, 'Content-Length': String(bytes.length), 'X-Version-ID': 'v_manifest_1' } });
  };
  const manifest = await fetchSpriteManifest('m1', '/api/v1', fetcher as typeof fetch);
  assert.equal(manifest.version_id, 'v_manifest_1');
  assert.equal(manifest.sets[0].items[0].display_name, '和服');

  const sets = await fetchSpriteSets('m1', '/api/v1', fetcher as typeof fetch);
  assert.equal(sets[0].items[0].display_name, '和服');

  const result = await fetchVerifiedSpriteSelection('m1', ['set_a'], '/api/v1', fetcher as typeof fetch, undefined, undefined, 'v_manifest_1');
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), bytes);
  assert.equal(result.version_id, 'v_manifest_1');
  assert.equal(requests[2], 'http://localhost/api/v1/spritepacks/m1/download?sets=set_a&version_id=v_manifest_1');
});

test('fetchVerifiedSpriteSelection detects version mismatch from server headers or 409 status', async () => {
  const bytes = new TextEncoder().encode('data');
  const hash = createHash('sha256').update(bytes).digest('hex');

  // Mismatched X-Version-ID header
  const mismatchedFetcher = async () => new Response(bytes, {
    headers: { 'X-Archive-SHA256': hash, 'Content-Length': String(bytes.length), 'X-Version-ID': 'v_newer' },
  });
  await assert.rejects(
    fetchVerifiedSpriteSelection('m1', ['set_a'], '/api/v1', mismatchedFetcher as typeof fetch, undefined, undefined, 'v_older'),
    /sprite_version_changed/,
  );

  // 409 sprite_version_changed response
  const conflictFetcher = async () => Response.json({ code: 'sprite_version_changed', message: 'version changed' }, { status: 409 });
  await assert.rejects(
    fetchVerifiedSpriteSelection('m1', ['set_a'], '/api/v1', conflictFetcher as typeof fetch, undefined, undefined, 'v_older'),
    /sprite_version_changed/,
  );
});

test('rejects a sprite selection with an invalid server hash', async () => {
  const fetcher = async () => new Response('bytes', { headers: { 'X-Archive-SHA256': '0'.repeat(64), 'Content-Length': '5' } });
  await assert.rejects(fetchVerifiedSpriteSelection('m1', ['set_a'], '/api/v1', fetcher as typeof fetch), /download_hash_mismatch/);
});

test('verifies a sprite ZIP when insecure HTTP disables Web Crypto', async () => {
  const bytes = new TextEncoder().encode('HTTP sprite ZIP');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
  try {
    const fetcher = async () => new Response(bytes, { headers: { 'X-Archive-SHA256': hash, 'Content-Length': String(bytes.length) } });
    const result = await fetchVerifiedSpriteSelection('m1', ['set_a'], '/api/v1', fetcher as typeof fetch);
    assert.equal(result.sha256, hash);
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    else delete (globalThis as { crypto?: Crypto }).crypto;
  }
});

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

test('fetchModVersion loads and validates specific published version details', async () => {
  const fetcher = async (input: RequestInfo | URL) => {
    assert.equal(String(input), '/api/v1/mods/m1/versions/v2');
    return Response.json({ id: 'v2', mod_id: 'm1', state: 'published', version: '2.0.0', sha256: 'b'.repeat(64), size_bytes: 1024 });
  };
  const ver = await fetchModVersion('m1', 'v2', '/api/v1', fetcher as typeof fetch);
  assert.equal(ver.id, 'v2');
  assert.equal(ver.version, '2.0.0');

  const mismatchedFetcher = async () => Response.json({ id: 'v_wrong', mod_id: 'm1', state: 'published', version: '2.0.0' });
  await assert.rejects(fetchModVersion('m1', 'v2', '/api/v1', mismatchedFetcher as typeof fetch), /invalid_version_response/);
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
  // A shared-archive version reports no platform, so callers keep the plain name.
  assert.equal(descriptor.platform, undefined);
});

test('asks for a platform file and reports which platform the bytes belong to', async () => {
  const bytes = new TextEncoder().encode('android build');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const paths: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    const path = String(input);
    paths.push(path);
    if (path.includes('/versions/')) {
      return Response.json({ url: '/api/v1/archives/v1-android', expires_at: new Date(Date.now() + 60_000).toISOString(), sha256: hash, size_bytes: bytes.length, platform: 'android' });
    }
    return new Response(bytes);
  };

  const descriptor = await fetchDownloadDescriptor('v1', '/api/v1', fetcher as typeof fetch, 'android');
  assert.equal(descriptor.platform, 'android');
  assert.equal(paths[0], '/api/v1/versions/v1/download?platform=android');

  // The verified download must carry the platform through so the caller can name
  // the saved file after the build it actually received.
  const archive = await fetchVerifiedArchive('v1', '/api/v1', fetcher as typeof fetch, undefined, undefined, 'android');
  assert.equal(archive.platform, 'android');
  assert.equal(archive.sha256, hash);
  assert.ok(paths[1].startsWith('/api/v1/versions/v1/download?platform=android'));
});

test('refuses a descriptor that resolves to a different platform than requested', async () => {
  const bytes = new TextEncoder().encode('windows build');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const fetcher = async (input: RequestInfo | URL) => {
    if (String(input).includes('/versions/')) {
      // The server answered with the wrong build; those bytes must never be used.
      return Response.json({ url: '/api/v1/archives/v1-windows', expires_at: new Date(Date.now() + 60_000).toISOString(), sha256: hash, size_bytes: bytes.length, platform: 'windows' });
    }
    return new Response(bytes);
  };

  await assert.rejects(
    fetchVerifiedArchive('v1', '/api/v1', fetcher as typeof fetch, undefined, undefined, 'android'),
    /wrong_platform_delivered/,
  );
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

test('reports connecting, downloading, and verifying stages with received bytes', async () => {
  const bytes = new TextEncoder().encode('fixture ZIP bytes');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const updates: Array<{ received: number; total: number; stage: string }> = [];
  const fetcher = async (input: RequestInfo | URL) => String(input).endsWith('/download')
    ? Response.json({ url: '/api/v1/archives/v1', expires_at: '2099-01-01T00:00:00Z', sha256: hash, size_bytes: bytes.length })
    : new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 4)); controller.enqueue(bytes.slice(4)); controller.close(); } }));
  await fetchVerifiedArchive('v1', '/api/v1', fetcher as typeof fetch, (update) => updates.push(update));
  assert.equal(updates[0].stage, 'connecting');
  assert.equal(updates.at(-1)?.stage, 'verifying');
  assert.equal(updates.at(-1)?.received, bytes.length);
  const stages = updates.map((u) => u.stage);
  assert(stages.includes('connecting'));
  assert(stages.includes('downloading'));
  assert(stages.includes('verifying'));
});

test('reports sprite selection transfer progress', async () => {
  const bytes = new TextEncoder().encode('selected sprite ZIP');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const updates: string[] = [];
  const fetcher = async () => new Response(bytes, { headers: { 'X-Archive-SHA256': hash, 'Content-Length': String(bytes.length) } });
  await fetchVerifiedSpriteSelection('mod', ['set'], '/api/v1', fetcher as typeof fetch, ({ stage }) => updates.push(stage));
  assert(updates.includes('connecting'));
  assert(updates.includes('downloading'));
  assert(updates.includes('verifying'));
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

test('parses pre-response JSON error codes from archive relay', async () => {
  const fetcher = async (input: RequestInfo | URL) => String(input).endsWith('/download')
    ? Response.json({ url: '/api/v1/archives/v1', expires_at: '2099-01-01T00:00:00Z', sha256: 'a'.repeat(64), size_bytes: 100 })
    : Response.json({ code: 'upstream_archive_changed', message: 'size mismatch' }, { status: 502 });
  await assert.rejects(fetchVerifiedArchive('v1', '/api/v1', fetcher as typeof fetch), /upstream_archive_changed/);
});

test('supports AbortSignal cancellation during archive download', async () => {
  const controller = new AbortController();
  const fetcher = async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/download')) {
      return Response.json({ url: '/api/v1/archives/v1', expires_at: '2099-01-01T00:00:00Z', sha256: 'a'.repeat(64), size_bytes: 100 });
    }
    controller.abort();
    return new Response(new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(10));
      },
    }));
  };
  await assert.rejects(fetchVerifiedArchive('v1', '/api/v1', fetcher as typeof fetch, undefined, controller.signal));
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
    { url: '/api/v1/archives/v1', size_bytes: 129 * 1024 * 1024 },
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
