export interface Session {
  user: { id: string; username: string; display_name: string; avatar_url?: string } | null;
  roles: string[];
  csrf_token: string;
}

export function ensureSecureLoginOrigin(pageURL: string, endpointURL: string, allowInsecure = false): void {
  const page = new URL(pageURL);
  const endpoint = new URL(endpointURL, page);
  if (!allowInsecure && (page.protocol !== 'https:' || endpoint.protocol !== 'https:')) throw new Error('https_required');
  if (endpoint.origin !== page.origin) throw new Error('same_origin_required');
}

async function checkedJSON(response: Response): Promise<Session> {
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { code?: string } | null;
    throw new Error(error?.code || `http_${response.status}`);
  }
  const session = await response.json() as Session;
  if (!Array.isArray(session.roles) || typeof session.csrf_token !== 'string') throw new Error('invalid_session_response');
  return session;
}

export async function readSession(base = '/api/v1', fetcher: typeof fetch = fetch): Promise<Session> {
  return checkedJSON(await fetcher(`${base.replace(/\/$/, '')}/session`, { credentials: 'same-origin' }));
}

export async function loginFlarum(identification: string, password: string, base = '/api/v1', fetcher: typeof fetch = fetch): Promise<Session> {
  const endpoint = `${base.replace(/\/$/, '')}/auth/flarum/login`;
  if (typeof window !== 'undefined') ensureSecureLoginOrigin(window.location.href, endpoint, import.meta.env.VITE_ALLOW_INSECURE_AUTH === 'true');
  return checkedJSON(await fetcher(endpoint, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identification, password }),
  }));
}

export async function logout(csrf: string, base = '/api/v1', fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`${base.replace(/\/$/, '')}/auth/logout`, {
    method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf },
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
}

export async function setFlarumUserRoles(userID: string, roles: Array<'author' | 'reviewer'>, csrf: string, base = '/api/v1', fetcher: typeof fetch = fetch): Promise<{ user_id: string; roles: Array<'author' | 'reviewer'> }> {
  if (!/^[1-9]\d*$/.test(userID)) throw new Error('invalid_flarum_user_id');
  if (roles.some((role) => role !== 'author' && role !== 'reviewer') || new Set(roles).size !== roles.length) throw new Error('invalid_role');
  if (!csrf) throw new Error('csrf_invalid');
  const response = await fetcher(`${base.replace(/\/$/, '')}/admin/users/${encodeURIComponent(`flarum:${userID}`)}/roles`, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ roles }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { code?: string } | null;
    throw new Error(error?.code || `http_${response.status}`);
  }
  return response.json();
}

export async function getFlarumUserRoles(userID: string, base = '/api/v1', fetcher: typeof fetch = fetch): Promise<{ user_id: string; roles: Array<'author' | 'reviewer'> }> {
  if (!/^[1-9]\d*$/.test(userID)) throw new Error('invalid_flarum_user_id');
  const response = await fetcher(`${base.replace(/\/$/, '')}/admin/users/${encodeURIComponent(`flarum:${userID}`)}/roles`, { credentials: 'same-origin' });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { code?: string } | null;
    throw new Error(error?.code || `http_${response.status}`);
  }
  const result = await response.json() as { user_id?: string; roles?: string[] };
  if (result.user_id !== `flarum:${userID}` || !Array.isArray(result.roles) || result.roles.some((role) => role !== 'author' && role !== 'reviewer')) throw new Error('invalid_roles_response');
  return { user_id: result.user_id, roles: result.roles as Array<'author' | 'reviewer'> };
}
