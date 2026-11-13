/**
 * 设置导入导出文档的客户端解析。
 *
 * 服务端已经做了权威校验（格式、版本、每个字段的规则），这里只做**尽早失败**：
 * 让管理员在文件选择器关掉之后、动到线上配置之前就知道「这个文件不对」，
 * 而不是等一次 200 KiB 的 POST 换回一个错误码。
 *
 * 纯函数，不碰 DOM 也不碰 fetch，所以可以直接被测试覆盖。
 */

import {
  SETTINGS_TRANSFER_FORMAT,
  SETTINGS_TRANSFER_MAX_BYTES,
  SETTINGS_TRANSFER_VERSION,
  type SettingsTransferDocument,
} from './settings-api.js';

export type SettingsTransferIssue =
  | 'file_too_large'
  | 'invalid_json'
  | 'not_settings_document'
  | 'unsupported_version'
  | 'invalid_shape';

export type SettingsTransferParse =
  | { ok: true; document: SettingsTransferDocument }
  | { ok: false; issue: SettingsTransferIssue };

/** 文件大小上限：与服务端请求体上限同一个数，超了会被 413 掉。 */
export const MAX_TRANSFER_BYTES = SETTINGS_TRANSFER_MAX_BYTES;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 解析一个用户选中的 JSON 文件。
 *
 * 只检查「能不能安全地交给服务端」：格式标识、版本、以及 `settings` 是对象。
 * 字段级规则（代理模板、刷新窗口、标签目录、节点形状）一律留给服务端，
 * 因为两边一旦各写一份就必然会漂移。
 */
export function parseSettingsTransfer(raw: string, byteSize = new TextEncoder().encode(raw).length): SettingsTransferParse {
  if (byteSize > MAX_TRANSFER_BYTES) return { ok: false, issue: 'file_too_large' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, issue: 'invalid_json' };
  }
  if (!isObject(parsed) || parsed.format !== SETTINGS_TRANSFER_FORMAT) {
    return { ok: false, issue: 'not_settings_document' };
  }
  if (parsed.version !== SETTINGS_TRANSFER_VERSION) {
    return { ok: false, issue: 'unsupported_version' };
  }
  if (!isObject(parsed.settings) || !Array.isArray(parsed.settings.tag_catalog)) {
    return { ok: false, issue: 'invalid_shape' };
  }
  return { ok: true, document: parsed as unknown as SettingsTransferDocument };
}

/** 导入确认条上的一句话概览：管理员点「替换」前应该知道会动到什么。 */
export interface SettingsTransferSummary {
  tagGroupCount: number;
  tagChildCount: number;
  nodeCount: number;
  /** 文档里没有 `download_nodes`：节点列表保持不动。 */
  nodesUnchanged: boolean;
  /** 文档里带了令牌（会替换现有令牌）。 */
  includesToken: boolean;
  proxy: string;
  syncMaxAge: string;
}

export function summarizeSettingsTransfer(doc: SettingsTransferDocument): SettingsTransferSummary {
  const groups = doc.settings.tag_catalog ?? [];
  const nodes = doc.download_nodes;
  return {
    tagGroupCount: groups.length,
    tagChildCount: groups.reduce((total, group) => total + (group.children?.length ?? 0), 0),
    nodeCount: Array.isArray(nodes) ? nodes.length : 0,
    nodesUnchanged: !Array.isArray(nodes),
    includesToken: typeof doc.settings.github_token === 'string' && doc.settings.github_token !== '',
    proxy: doc.settings.github_proxy_template?.trim() ?? '',
    syncMaxAge: doc.settings.github_sync_max_age?.trim() ?? '',
  };
}
