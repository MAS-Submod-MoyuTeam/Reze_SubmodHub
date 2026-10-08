/**
 * GitHub Releases 源配置辅助函数与校验逻辑
 */

export interface GitHubSourceInput {
  owner?: string;
  repo?: string;
  assetRegex?: string;
  sourceCode?: boolean;
}

export function validateGitHubSourceInput(input: GitHubSourceInput): { valid: boolean; error?: string } {
  const owner = (input.owner || '').trim();
  const repo = (input.repo || '').trim();
  const assetRegex = (input.assetRegex || '').trim();
  const sourceCode = Boolean(input.sourceCode);

  if (!owner) {
    return { valid: false, error: 'GitHub 组织/用户名 (Owner) 不能为空' };
  }
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(owner)) {
    return { valid: false, error: 'GitHub Owner 格式不合法，仅支持字母、数字和连字符' };
  }

  if (!repo) {
    return { valid: false, error: 'GitHub 仓库名 (Repo) 不能为空' };
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(repo)) {
    return { valid: false, error: 'GitHub Repo 格式不合法，仅支持字母、数字、点、下划线和连字符' };
  }

  if (!assetRegex && !sourceCode) {
    return { valid: false, error: '必须配置 Release 资产文件名正则或勾选允许使用源码包 ZIP' };
  }

  if (assetRegex) {
    try {
      new RegExp(assetRegex);
    } catch {
      return { valid: false, error: 'Release 资产匹配正则表达式语法错误' };
    }
  }

  return { valid: true };
}

export function isCandidateVersionAllowed(mod?: { source_type?: string } | null): boolean {
  if (!mod) return true;
  return mod.source_type !== 'github_releases';
}

export function formatLastSyncTime(isoString?: string): string {
  if (!isoString) return '从未同步';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '从未同步';
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return '从未同步';
  }
}

export function getGitHubRepoUrl(owner?: string, repo?: string): string {
  if (!owner || !repo) return '';
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}
