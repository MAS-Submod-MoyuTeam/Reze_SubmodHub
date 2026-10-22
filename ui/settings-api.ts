import type { TagGroup } from './tags-api.js';

export type DownloadNodeType = 'github_relay' | 'cloudreve';
export interface DownloadNodeInput {
 id: string; name: string; type: DownloadNodeType; enabled: boolean; weight: number;
 capabilities: string[]; base_url?: string; api_base_url?: string; username?: string;
 directory?: string; allowed_download_origins?: string[]; password: string;
}
export interface DownloadNode extends Omit<DownloadNodeInput, 'password' | 'type'> {
 type: DownloadNodeType | 'builtin'; credential_configured: boolean; revision: number;
 status: string; error_code?: string; last_checked_at?: string;
 mirror_states?: Partial<Record<'pending' | 'uploading' | 'ready' | 'failed', number>>;
}
export interface DownloadNodeSettings {
 items: DownloadNode[]; revision: number; builtin_fallback: boolean; master_key_configured: boolean;
}
export interface DownloadNodeTestResult { ok: boolean; error_code: string; elapsed_ms: number; scope: string; creates_temporary_files: boolean }
const nodeURL = (base: string, id?: string) => `${base.replace(/\/$/, '')}/admin/download-nodes${id ? `/${encodeURIComponent(id)}` : ''}`;
export async function fetchDownloadNodes(base = '/api/v1', fetcher: typeof fetch = fetch): Promise<DownloadNodeSettings> {
 return handleResponse<DownloadNodeSettings>(await fetcher(nodeURL(base), {headers:{Accept:'application/json'}}));
}
export async function saveDownloadNode(input: DownloadNodeInput, revision: number, csrf: string, editing: boolean, base = '/api/v1', fetcher: typeof fetch = fetch): Promise<DownloadNodeSettings> {
 const node: DownloadNodeInput = {id:input.id,name:input.name,type:input.type,enabled:input.enabled,weight:input.weight,capabilities:input.capabilities,password:input.password};
 if(input.type === 'github_relay') node.base_url=input.base_url;
 else {node.api_base_url=input.api_base_url;node.username=input.username;node.directory=input.directory;node.allowed_download_origins=input.allowed_download_origins?.map(origin=>origin.trim()).filter(Boolean);}
 return handleResponse<DownloadNodeSettings>(await fetcher(nodeURL(base, editing ? input.id : undefined), {method:editing?'PUT':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({revision,node})}));
}
export async function deleteDownloadNode(id: string, revision: number, csrf: string, base = '/api/v1', fetcher: typeof fetch = fetch): Promise<DownloadNodeSettings> {
 return handleResponse<DownloadNodeSettings>(await fetcher(nodeURL(base,id),{method:'DELETE',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({revision})}));
}
export async function retryDownloadMirrors(id: string, revision: number, csrf: string, base = '/api/v1', fetcher: typeof fetch = fetch): Promise<{retried: number}> {
 return handleResponse<{retried: number}>(await fetcher(`${nodeURL(base,id)}/retry-mirrors`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({revision})}));
}
export async function testDownloadNode(id: string, revision: number, csrf: string, base = '/api/v1', fetcher: typeof fetch = fetch): Promise<DownloadNodeTestResult> {
 return handleResponse<DownloadNodeTestResult>(await fetcher(`${nodeURL(base,id)}/test`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({revision})}));
}

export interface SiteSettings {
  github_proxy_template: string;
  /** 是否已保存 GitHub API 令牌；响应永远不回显令牌本身。 */
  github_token_configured: boolean;
  /** 令牌是否加密落盘（取决于部署是否配置了 master key）。 */
  github_token_encrypted: boolean;
  /** 已保存令牌的末四位，便于确认当前装的是哪一把。 */
  github_token_hint?: string;
  /** 实际生效的刷新窗口（Go duration，如 "4h30m0s"）；"0s" 表示已关闭自动刷新。 */
  github_sync_max_age: string;
  /** True when the deployment environment pins the refresh window. */
  github_sync_max_age_locked: boolean;
  /** 实际生效的标签目录（未配置时为服务端默认值）。 */
  tag_catalog: TagGroup[];
  master_key_configured: boolean;
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

/** PATCH 载荷：省略的字段保持原值，`github_token: ""` 表示清除令牌。 */
export interface SiteSettingsPatch {
  github_proxy_template?: string;
  github_token?: string;
  /** 传空字符串恢复默认 60 分钟；传 "0" 关闭自动刷新。 */
  github_sync_max_age?: string;
  /** 整份替换标签目录；至少一个主标签，名称全局唯一。 */
  tag_catalog?: TagGroup[];
}

export async function updateSettings(
  patch: SiteSettingsPatch,
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
    body: JSON.stringify({ ...patch, revision }),
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
