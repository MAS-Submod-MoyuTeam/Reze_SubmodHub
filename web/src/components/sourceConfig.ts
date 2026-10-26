/**
 * GitHub Releases 源配置辅助函数与校验逻辑
 */

import { ASSET_PLATFORMS, type AssetPlatform, type GitHubPlatformRule } from '../types/submodhub';

export interface GitHubSourceInput {
  owner?: string;
  repo?: string;
  assetRegex?: string;
  sourceCode?: boolean;
  /** true 表示版本由仓库根目录的 rezehub.yml 声明，而不是站内调用 releases API。 */
  manifest?: boolean;
  /**
   * 非空时分平台抓取：每个平台用自己的正则匹配同名 Release 中的资产，
   * 全平台共用正则 (assetRegex) 不再参与匹配。
   */
  platformRules?: GitHubPlatformRule[];
}

/** 作者需要自己维护的清单文件名（放在仓库根目录）。 */
export const MANIFEST_FILE_NAME = 'rezehub.yml';

/**
 * 服务端尚未返回策略时的兜底值，与服务端 GITHUB_SYNC_MAX_AGE 的默认值一致。
 * 真实文案必须用 describeRefreshWindow() 渲染服务端返回的实际值。
 */
export const DEFAULT_REFRESH_WINDOW_MINUTES = 60;

/** 服务端公开的源策略（不含任何凭据）。 */
export interface SourcePolicy {
  github_sync_max_age: string;
  github_sync_max_age_seconds: number;
  github_sync_max_age_configured: boolean;
}

/** 秒数转成作者可读的中文时长，例如 3600 -> "1 小时"、5400 -> "1 小时 30 分钟"。 */
export function describeRefreshWindow(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '已关闭自动刷新';
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} 分钟`;
  if (minutes === 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分钟`;
}

/** 从策略对象取出可读窗口，缺省时回退到默认值。 */
export function refreshWindowText(policy?: SourcePolicy | null): string {
  if (!policy) return describeRefreshWindow(DEFAULT_REFRESH_WINDOW_MINUTES * 60);
  return describeRefreshWindow(policy.github_sync_max_age_seconds);
}

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
  // 分平台模式下每个平台各自带正则，全平台共用正则不再参与匹配，同样不能强制要求。
  const splitPlatforms = Boolean(input.platformRules && input.platformRules.length > 0);
  if (!manifest && !splitPlatforms && !assetRegex && !sourceCode) {
    return { valid: false, error: '必须配置 Release 资产文件名正则或勾选允许使用源码包 ZIP' };
  }

  if (splitPlatforms && !manifest) {
    const rules = validatePlatformRules(input.platformRules || []);
    if (!rules.valid) return rules;
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

/** 单个平台正则的校验：为空时该平台只能靠源码包兜底。 */
export function validatePlatformRule(platform: AssetPlatform, regex: string, sourceCode: boolean): { valid: boolean; error?: string } {
  const pattern = regex.trim();
  if (!pattern) {
    if (sourceCode) return { valid: true };
    const label = platform === 'windows' ? 'Windows' : 'Android';
    return { valid: false, error: `${label} 平台需要填写文件名正则，或勾选该平台允许使用源码包 ZIP` };
  }
  try {
    new RegExp(pattern);
  } catch {
    return { valid: false, error: `${platform === 'windows' ? 'Windows' : 'Android'} 平台的资产正则语法错误` };
  }
  return { valid: true };
}

/**
 * 分平台模式必须覆盖每一个平台：分平台之后就再也不存在「全平台共用文件」，
 * 缺一个平台意味着该平台的用户拿不到任何东西。
 */
export function validatePlatformRules(rules: GitHubPlatformRule[]): { valid: boolean; error?: string } {
  for (const platform of ASSET_PLATFORMS) {
    const rule = rules.find((item) => item.platform === platform);
    if (!rule) {
      return { valid: false, error: `分平台分发需要同时配置 Windows 与 Android 平台` };
    }
    const result = validatePlatformRule(platform, rule.regex || '', Boolean(rule.source_code));
    if (!result.valid) return result;
  }
  return { valid: true };
}

/** 从示例文件名猜出它属于哪个平台，用于把正则预填成能匹配到它的形状。 */
export function guessPlatformFromFileName(fileName: string): AssetPlatform | null {
  const lower = fileName.trim().toLowerCase();
  if (!lower) return null;
  const tags = lower.split(/[-_.\s/\\]+/);
  const windows = tags.includes('windows') || tags.includes('win') || lower.endsWith('.exe');
  const android = tags.includes('android') || lower.endsWith('.apk');
  if (windows && !android) return 'windows';
  if (android && !windows) return 'android';
  return null;
}

/** 由平台给出一条宽松的示例正则，作者仍可自行收紧。 */
export function suggestPlatformRegex(platform: AssetPlatform): string {
  return platform === 'windows' ? 'windows' : 'android';
}

/**
 * 分平台分发的取舍：它换来「每个平台拿到自己的包」，代价是作者每次发版都要
 * 在同一次 Release 里传齐两个文件，缺一个这次同步就整体失败。
 */
export function platformModeTradeoff(): DiscoveryModeTradeoff {
  return {
    benefit: 'Windows 与 Android 各自下载对应的包，安装包里不会再混入另一平台的脚本与资源。',
    cost: '每次发版都要在同一个 Release 里同时上传两个平台的资产；缺少任一平台时这次 Release 会被整体跳过，不会只发布一半。',
  };
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
 * 窗口必须传入服务端实际生效的值，不能让作者看到与设置不符的文案。
 */
export function onDemandModeTradeoff(windowText: string): DiscoveryModeTradeoff {
  return {
    benefit: '不需要任何额外文件，站内会在有人查看该模组时自动去 GitHub 抓取 Releases。',
    cost: `距上次检查超过 ${windowText} 才会回源：有人打开该模组时立即补抓，无人访问时也会由后台巡检兜底。`,
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
