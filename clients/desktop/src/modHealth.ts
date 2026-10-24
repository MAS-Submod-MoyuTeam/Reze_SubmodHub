/**
 * 已安装侧的健康判定。
 *
 * 两件事都只允许回答能被证据支持的问题：
 * - `resolveHasUpdate`：目录里的最新版本是否确实比本地已安装的新；
 * - `summarizeIntegrity`：校验到底核对了什么、哪些对不上、哪些压根没有账本。
 *
 * 纯函数，便于在没有 Wails 原生层的情况下直接测。
 */

export interface UpdateComparisonInput {
  installedVersionId?: string;
  installedVersion?: string;
  latestVersionId?: string;
  latestVersion?: string;
}

const PLACEHOLDER_VERSIONS = new Set(['', '未托管', '未声明', 'unknown', 'n/a', 'null']);

function isPlaceholderVersion(value: string): boolean {
  return PLACEHOLDER_VERSIONS.has(value.trim().toLowerCase());
}

function parseVersion(value: string): number[] | null {
  const core = value.trim().replace(/^v/i, '').split(/[-+]/)[0];
  if (!core) return null;
  const segments: number[] = [];
  for (const part of core.split('.')) {
    if (!/^\d+$/.test(part)) return null;
    segments.push(Number(part));
  }
  return segments;
}

/** 按数字段比较版本；任一侧不可解析时返回 null（调用方不得据此臆断新旧）。 */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * 只回答「目录最新版本比本地新」。无法证明时一律 false：
 * 宁可少一个「可更新」标记，也不造一个后端没有的事实。
 */
export function resolveHasUpdate(input: UpdateComparisonInput): boolean {
  const installedId = (input.installedVersionId || '').trim();
  const latestId = (input.latestVersionId || '').trim();
  const installedVersion = (input.installedVersion || '').trim();
  const latestVersion = (input.latestVersion || '').trim();

  // 目录没给出可比对的版本号（未收录 / 未发布 / 字段缺失），无从判断。
  if (isPlaceholderVersion(latestVersion)) return false;
  // 同一版本标识：就是当前版本，不存在更新。
  if (installedId && latestId && installedId === latestId) return false;
  // 本地版本未知（未托管、散落项、旧账本缺字段）时不臆断。
  if (isPlaceholderVersion(installedVersion)) return false;

  const comparison = compareVersions(installedVersion, latestVersion);
  if (comparison !== null) return comparison < 0;
  // 两侧版本号都不可解析时，退到标识比较，且两侧标识都必须存在。
  return Boolean(installedId && latestId && installedId !== latestId);
}

export interface IntegrityTotals {
  /** 参与校验的已安装模组数（含未托管散落项）。 */
  modCount: number;
  /** 有账本可比对的托管文件数（intact + modified）。 */
  checkedFiles: number;
  /** 与账本哈希不一致的托管文件数。 */
  driftedFiles: number;
  /** 被其他模组覆盖的非活动文件数：是分层结果，不是漂移。 */
  overriddenFiles: number;
  /** 没有安装账本、未参与比对的散落文件数。 */
  unmanagedFiles: number;
  /** 读取文件清单失败的模组名称。 */
  unreadableMods: string[];
}

export interface IntegritySummary {
  text: string;
  tone: 'info' | 'warn';
}

export function summarizeIntegrity(totals: IntegrityTotals): IntegritySummary {
  if (totals.modCount === 0) {
    return { text: '完整性校验未执行：当前没有可校验的已安装模组。', tone: 'warn' };
  }

  const details: string[] = [];
  if (totals.checkedFiles > 0) {
    details.push(
      totals.driftedFiles > 0
        ? `托管文件 ${totals.checkedFiles} 个，其中 ${totals.driftedFiles} 个哈希与账本不一致`
        : `托管文件 ${totals.checkedFiles} 个，全部与账本一致`
    );
  } else {
    details.push('没有任何托管文件可供比对');
  }
  if (totals.overriddenFiles > 0) {
    details.push(`${totals.overriddenFiles} 个文件被其他模组覆盖（分层结果，非漂移）`);
  }
  if (totals.unmanagedFiles > 0) {
    details.push(`${totals.unmanagedFiles} 个散落文件没有安装账本，未参与比对`);
  }
  if (totals.unreadableMods.length > 0) {
    details.push(`${totals.unreadableMods.length} 个模组读取清单失败`);
  }

  const tone: IntegritySummary['tone'] =
    totals.driftedFiles > 0 || totals.unreadableMods.length > 0 || totals.checkedFiles === 0 ? 'warn' : 'info';
  return { text: `完整性校验完成：${details.join('；')}。`, tone };
}
