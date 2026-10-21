/**
 * GitHub Releases 源配置辅助函数与校验逻辑
 */

export interface GitHubSourceInput {
  owner?: string;
  repo?: string;
  assetRegex?: string;
  sourceCode?: boolean;
  /** true 表示版本由仓库根目录的 rezehub.yml 声明，而不是站内调用 releases API。 */
  manifest?: boolean;
}

/** 作者需要自己维护的清单文件名（放在仓库根目录）。 */
export const MANIFEST_FILE_NAME = 'rezehub.yml';

/** 站内默认的按需抓取新鲜度窗口，与服务端 GITHUB_SYNC_TTL 的默认值一致。 */
export const DEFAULT_REFRESH_WINDOW_MINUTES = 30;

/** 可直接粘贴到仓库根目录的清单骨架。 */
export const MANIFEST_SNIPPET = `schema: 1
releases:
  - version: 1.2.0
    url: https://github.com/<owner>/<repo>/releases/download/v1.2.0/MyMod-1.2.0.zip
    notes: 本次更新的内容（可选）
`;

export function validateGitHubSourceInput(input: GitHubSourceInput): { valid: boolean; error?: string } {
  const owner = (input.owner || '').trim();
  const repo = (input.repo || '').trim();
  const assetRegex = (input.assetRegex || '').trim();
  const sourceCode = Boolean(input.sourceCode);
  const manifest = Boolean(input.manifest);

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

  // 清单模式直接按 rezehub.yml 下载，资产正则不再参与匹配，因此不能强制要求填写。
  if (!manifest && !assetRegex && !sourceCode) {
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

export interface DiscoveryModeTradeoff {
  benefit: string;
  cost: string;
}

/**
 * 清单模式的取舍，必须在前端如实展示：它把「更新延迟」换成「作者多维护一个文件」。
 */
export function manifestModeTradeoff(): DiscoveryModeTradeoff {
  return {
    benefit: `站内直接读取仓库里的 ${MANIFEST_FILE_NAME}，不消耗 GitHub API 配额，打开页面即可看到最新版本。`,
    cost: `需要你在仓库根目录额外维护一个 ${MANIFEST_FILE_NAME}，每次发版都要手动补一条记录；忘记更新时站内不会出现新版本。`,
  };
}

/**
 * 非清单模式（站内按需抓取）的取舍。这是默认模式，不需要作者做任何额外工作。
 */
export function onDemandModeTradeoff(refreshWindowMinutes: number = DEFAULT_REFRESH_WINDOW_MINUTES): DiscoveryModeTradeoff {
  return {
    benefit: '不需要任何额外文件，站内会在有人查看该模组时自动去 GitHub 抓取 Releases。',
    cost: `更新最多延迟约 ${refreshWindowMinutes} 分钟，并且需要有人打开该模组才会触发抓取；长时间无人访问时不会自动更新。`,
  };
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
