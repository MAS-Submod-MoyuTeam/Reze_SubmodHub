import assert from 'node:assert/strict';
import test from 'node:test';
import { loginFlarum, readSession, logout, ensureSecureLoginOrigin, getFlarumUserRoles, setFlarumUserRoles } from './auth-api';

test('rejects plaintext or cross-origin browser login targets', () => {
  assert.throws(() => ensureSecureLoginOrigin('http://127.0.0.1:3003/', '/api/v1/auth/flarum/login'), /https_required/);
  assert.throws(() => ensureSecureLoginOrigin('https://submodhub.example/', 'https://other.example/api/v1/auth/flarum/login'), /same_origin_required/);
  assert.doesNotThrow(() => ensureSecureLoginOrigin('https://submodhub.example/', '/api/v1/auth/flarum/login'));
});

test('Flarum login uses same-origin credentials and returns server roles', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Response.json({ user: { id: 'flarum:17', username: 'alice', display_name: 'Alice' }, roles: ['admin'], csrf_token: 'csrf' });
  };
  const session = await loginFlarum('alice', 'secret', '/api/v1', fetcher as typeof fetch);
  assert.deepEqual(session.roles, ['admin']);
  assert.equal(calls[0].url, '/api/v1/auth/flarum/login');
  assert.equal(calls[0].init?.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { identification: 'alice', password: 'secret' });
});

test('failed login does not create a local persona', async () => {
  const fetcher = async () => Response.json({ code: 'invalid_flarum_credentials' }, { status: 401 });
  await assert.rejects(loginFlarum('alice', 'wrong', '/api/v1', fetcher as typeof fetch), /invalid_flarum_credentials/);
});

test('reads and clears the server session', async () => {
  const paths: string[] = [];
  const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
    paths.push(String(url));
    assert.equal(init?.credentials, 'same-origin');
    if (init?.method === 'POST') {
      assert.equal(new Headers(init.headers).get('X-CSRF-Token'), 'csrf');
      return new Response(null, { status: 204 });
    }
    return Response.json({ user: null, roles: [], csrf_token: '' });
  };
  const session = await readSession('/api/v1', fetcher as typeof fetch);
  assert.equal(session.user, null);
  await logout('csrf', '/api/v1', fetcher as typeof fetch);
  assert.deepEqual(paths, ['/api/v1/session', '/api/v1/auth/logout']);
});

test('admin role update sends only author/reviewer roles with CSRF', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Response.json({ user_id: 'flarum:23', roles: ['author'] });
  };
  const result = await setFlarumUserRoles('23', ['author'], 'csrf', '/api/v1', fetcher as typeof fetch);
  assert.deepEqual(result.roles, ['author']);
  assert.equal(calls[0].url, '/api/v1/admin/users/flarum%3A23/roles');
  assert.equal(calls[0].init?.credentials, 'same-origin');
  assert.equal(new Headers(calls[0].init?.headers).get('X-CSRF-Token'), 'csrf');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { roles: ['author'] });
  await assert.rejects(setFlarumUserRoles('23', ['admin' as 'author'], 'csrf', '/api/v1', fetcher as typeof fetch), /invalid_role/);
  assert.equal(calls.length, 1);
});

test('admin role lookup reads current grants before editing', async () => {
  const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(url), '/api/v1/admin/users/flarum%3A23/roles');
    assert.equal(init?.credentials, 'same-origin');
    return Response.json({ user_id: 'flarum:23', roles: ['author'] });
  };
  assert.deepEqual(await getFlarumUserRoles('23', '/api/v1', fetcher as typeof fetch), { user_id: 'flarum:23', roles: ['author'] });
  await assert.rejects(getFlarumUserRoles('0', '/api/v1', fetcher as typeof fetch), /invalid_flarum_user_id/);
});
