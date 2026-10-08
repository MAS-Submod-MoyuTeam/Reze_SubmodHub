import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchSettings, updateSettings, testGitHubProxy, type SiteSettings, type ProxyTestResponse } from './settings-api.js';

test('fetchSettings returns settings from endpoint', async () => {
  const mockResponse: SiteSettings = {
    github_proxy_template: 'https://proxy.example/{url}',
    revision: 2,
  };

  const customFetch: typeof fetch = async (input, init) => {
    assert.equal(String(input), 'http://127.0.0.1:8080/api/v1/admin/settings');
    assert.equal(init?.method ?? 'GET', 'GET');
    return new Response(JSON.stringify(mockResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const res = await fetchSettings('http://127.0.0.1:8080/api/v1', customFetch);
  assert.deepEqual(res, mockResponse);
});

test('fetchSettings throws on forbidden / unauthorized', async () => {
  const customFetch: typeof fetch = async () => {
    return new Response(JSON.stringify({ code: 'forbidden', message: 'admin required' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await assert.rejects(
    async () => fetchSettings('http://127.0.0.1:8080/api/v1', customFetch),
    /forbidden/
  );
});

test('updateSettings sends PATCH with CSRF and revision', async () => {
  let capturedHeaders: HeadersInit | undefined;
  let capturedBody: string | undefined;

  const customFetch: typeof fetch = async (input, init) => {
    assert.equal(String(input), '/api/v1/admin/settings');
    assert.equal(init?.method, 'PATCH');
    capturedHeaders = init?.headers;
    capturedBody = String(init?.body);

    const updated: SiteSettings = {
      github_proxy_template: 'https://new-proxy.com/{url}',
      revision: 3,
    };
    return new Response(JSON.stringify(updated), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const res = await updateSettings(
    'https://new-proxy.com/{url}',
    2,
    'my-csrf-token',
    '/api/v1',
    customFetch
  );

  assert.equal(res.revision, 3);
  assert.equal(res.github_proxy_template, 'https://new-proxy.com/{url}');
  const headers = new Headers(capturedHeaders);
  assert.equal(headers.get('X-CSRF-Token'), 'my-csrf-token');
  assert.equal(headers.get('Content-Type'), 'application/json');
  assert.deepEqual(JSON.parse(capturedBody || '{}'), {
    github_proxy_template: 'https://new-proxy.com/{url}',
    revision: 2,
  });
});

test('updateSettings throws on conflict 409', async () => {
  const customFetch: typeof fetch = async () => {
    return new Response(JSON.stringify({ code: 'settings_conflict', message: 'revision mismatch' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  await assert.rejects(
    async () => updateSettings('https://proxy.example/{url}', 1, 'csrf', '/api/v1', customFetch),
    /settings_conflict/
  );
});

test('testGitHubProxy sends POST and returns test results', async () => {
  const mockTestResp: ProxyTestResponse = {
    api: { ok: true, elapsed_ms: 120 },
    asset: { ok: true, elapsed_ms: 250 },
  };

  let capturedBody: string | undefined;
  const customFetch: typeof fetch = async (input, init) => {
    assert.equal(String(input), '/api/v1/admin/settings/github-proxy/test');
    assert.equal(init?.method, 'POST');
    capturedBody = String(init?.body);
    return new Response(JSON.stringify(mockTestResp), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const res = await testGitHubProxy(
    'https://proxy.example/{url}',
    'csrf-123',
    '/api/v1',
    customFetch
  );

  assert.deepEqual(res, mockTestResp);
  assert.deepEqual(JSON.parse(capturedBody || '{}'), {
    github_proxy_template: 'https://proxy.example/{url}',
  });
});
