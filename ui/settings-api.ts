export interface SiteSettings {
  github_proxy_template: string;
  revision: number;
}

export interface ProxyTestItemResult {
  ok: boolean;
  elapsed_ms: number;
  error_code?: string;
}

export interface ProxyTestResponse {
  api: ProxyTestItemResult;
  asset: ProxyTestItemResult;
}

async function handleResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!res.ok) {
    const code = data?.code || `http_${res.status}`;
    const msg = data?.message || res.statusText || 'request failed';
    throw new Error(`${code}: ${msg}`);
  }
  return data as T;
}

export async function fetchSettings(
  base = '/api/v1',
  fetcher: typeof fetch = fetch
): Promise<SiteSettings> {
  const url = `${base.replace(/\/$/, '')}/admin/settings`;
  const res = await fetcher(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  return handleResponse<SiteSettings>(res);
}

export async function updateSettings(
  template: string,
  revision: number,
  csrfToken: string,
  base = '/api/v1',
  fetcher: typeof fetch = fetch
): Promise<SiteSettings> {
  const url = `${base.replace(/\/$/, '')}/admin/settings`;
  const res = await fetcher(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({
      github_proxy_template: template,
      revision,
    }),
  });
  return handleResponse<SiteSettings>(res);
}

export async function testGitHubProxy(
  template: string,
  csrfToken: string,
  base = '/api/v1',
  fetcher: typeof fetch = fetch
): Promise<ProxyTestResponse> {
  const url = `${base.replace(/\/$/, '')}/admin/settings/github-proxy/test`;
  const res = await fetcher(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({
      github_proxy_template: template,
    }),
  });
  return handleResponse<ProxyTestResponse>(res);
}
