import * as native from '@wails-bindings/desktopservice.js';
import { Call } from '@wailsio/runtime';
import type { Operation } from './types/client';

const browserMode = Boolean(import.meta.env?.VITE_BROWSER_MODE === '1');

/** 浏览器调试模式（没有 Wails 运行时，也没有系统调起/剪贴板能力）。 */
export const isBrowserMode = (): boolean => browserMode;

async function invoke<T>(method: string, callNative: () => Promise<T>, args: unknown[] = []): Promise<T> {
  if (!browserMode) return callNative();
  const response = await fetch(`/local/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `http_${response.status}`);
  return value as T;
}

export const ListMASInstances = () => invoke('ListMASInstances', () => native.ListMASInstances());
export const AddMASInstance = (label: string, root: string) => invoke('AddMASInstance', () => native.AddMASInstance(label, root), [label, root]);
export const SelectMASInstance = (id: string) => invoke('SelectMASInstance', () => native.SelectMASInstance(id), [id]);
export const RemoveMASInstance = (id: string) => invoke('RemoveMASInstance', () => native.RemoveMASInstance(id), [id]);
export const LaunchMASInstance = (id: string) => invoke('LaunchMASInstance', () => native.LaunchMASInstance(id), [id]);
export const SetMASRoot = (root: string) => invoke('SetMASRoot', () => native.SetMASRoot(root), [root]);
export const GetMASStatus = () => invoke('GetMASStatus', () => native.GetMASStatus());
export const ScanLocalSubmods = () => invoke('ScanLocalSubmods', () => native.ScanLocalSubmods());
export async function fetchRegistrationMatches(names: string[], apiBase: string): Promise<Response> {
  if (isAndroid() && !browserMode) {
    const body = await Call.ByName('main.DesktopService.MatchRegistrations', names) as string;
    return new Response(body, { headers: { 'Content-Type': 'application/json' } });
  }
  return fetch(`${apiBase}/registrations/match`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names }),
  });
}
export const ListInstalledArchives = () => invoke('ListInstalledArchives', () => native.ListInstalledArchives());
export const ListInstalledModFiles = (installationID: string, modID: string) => invoke('ListInstalledModFiles', () => native.ListInstalledModFiles(installationID, modID), [installationID, modID]);
export const ScanInstalledSpritepacks = () => invoke('ScanInstalledSpritepacks', () => native.ScanInstalledSpritepacks());
export const CreateSpriteGift = (file: string) => invoke('CreateSpriteGift', () => native.CreateSpriteGift(file), [file]);
export const DeleteSpritepack = (file: string) => invoke('DeleteSpritepack', () => native.DeleteSpritepack(file), [file]);
import { normalizeSpriteSetIDs as utilsNormalizeSpriteSetIDs } from './spritepackUtils';

export function normalizeSpriteSetIDs(ids?: string[]): string[] {
  if (!ids) return [];
  return utilsNormalizeSpriteSetIDs(ids);
}

export const StageArchive = (request: Parameters<typeof native.StageArchive>[0]) => {
  const req = { ...request };
  if (req.sprite_set_ids) {
    req.sprite_set_ids = normalizeSpriteSetIDs(req.sprite_set_ids);
  }
  return invoke('StageArchive', () => native.StageArchive(req), [req]);
};
export const GetStageProgress = (operationID: string) => invoke('GetStageProgress', () => native.GetStageProgress(operationID), [operationID]);
export const CancelStage = (operationID: string) => invoke('CancelStage', () => native.CancelStage(operationID), [operationID]);
export const ReleaseArchive = (archiveID: string) => invoke('ReleaseArchive', () => native.ReleaseArchive(archiveID), [archiveID]);
export const PreviewArchive = (request: Parameters<typeof native.PreviewArchive>[0]) => {
  const req = { ...request };
  if (req.sprite_set_ids) {
    req.sprite_set_ids = normalizeSpriteSetIDs(req.sprite_set_ids);
  }
  return invoke('PreviewArchive', () => native.PreviewArchive(req), [req]);
};
export const PreviewAdopt = (request: {
  instance_id?: string;
  scan_item_id?: string;
  mod_id: string;
  candidate_id?: string;
  candidate_registrations?: string[];
  version_id?: string;
  version: string;
  title: string;
  priority: number;
  files: string[];
}) => invoke<Awaited<ReturnType<typeof native.PreviewArchive>>>('PreviewAdopt', () => Call.ByName('main.DesktopService.PreviewAdopt', request), [request]);
export const PreviewUninstall = (targetID: string) => invoke('PreviewUninstall', () => native.PreviewUninstall(targetID), [targetID]);
export const PreviewRepair = (targetID: string) => invoke<Awaited<ReturnType<typeof native.PreviewArchive>>>('PreviewRepair', () => Call.ByName('main.DesktopService.PreviewRepair', targetID), [targetID]);
export const GetPriorityOverview = () => invoke('GetPriorityOverview', () => native.GetPriorityOverview());
export const PreviewPriority = (priorities: Record<string, number>) => invoke('PreviewPriority', () => native.PreviewPriority(priorities), [priorities]);
export const ExecutePlan = (request: Parameters<typeof native.ExecutePlan>[0]) => invoke('ExecutePlan', () => native.ExecutePlan(request), [request]);
export const ApplyArchive = (request: Parameters<typeof native.ApplyArchive>[0]) => invoke('ApplyArchive', () => native.ApplyArchive(request), [request]);
export const Uninstall = (operationID: string, uninstallID: string) => invoke('Uninstall', () => native.Uninstall(operationID, uninstallID), [operationID, uninstallID]);
export const Recover = (operationID: string) => invoke('Recover', () => native.Recover(operationID), [operationID]);
export const ListOperations = () => invoke<Operation[]>('ListOperations', () => (native as any).ListOperations ? (native as any).ListOperations() : Promise.resolve([]));
export const GetOperation = (operationID: string) => invoke<Operation>('GetOperation', () => (native as any).GetOperation ? (native as any).GetOperation(operationID) : Promise.reject(new Error('not_implemented')), [operationID]);
export const RollbackOperation = (operationID: string) => invoke<void>('RollbackOperation', () => (native as any).RollbackOperation ? (native as any).RollbackOperation(operationID) : (native as any).Recover(operationID), [operationID]);
export const BrowseMASDirectory = () => browserMode ? Promise.reject(new Error('浏览器模式请手动输入 MAS 根目录')) : native.BrowseMASDirectory();

export type AndroidStorageAccessStatus = {
  state: 'granted' | 'denied' | 'unsupported' | 'error' | string;
  root: string;
  game_path: string;
};

export type AndroidStorageAccessRequestResult = {
  opened: boolean;
  error?: string;
};

export const GetAndroidStorageAccess = () =>
  invoke<AndroidStorageAccessStatus>('GetAndroidStorageAccess', () => Call.ByName('main.DesktopService.GetAndroidStorageAccess'));

export const RequestAndroidStorageAccess = () =>
  invoke<AndroidStorageAccessRequestResult>('RequestAndroidStorageAccess', () => Call.ByName('main.DesktopService.RequestAndroidStorageAccess'));

export const ConfirmAppUpdateStartup = () =>
  browserMode ? Promise.resolve() : Call.ByName('main.DesktopService.ConfirmAppUpdateStartup');

export const CheckForAppUpdate = () =>
  invoke<any>('CheckForAppUpdate', () => Call.ByName('main.DesktopService.CheckForAppUpdate'));

export const DownloadAppUpdate = () =>
  invoke<any>('DownloadAppUpdate', () => Call.ByName('main.DesktopService.DownloadAppUpdate'));

export const CancelAppUpdate = () =>
  invoke<any>('CancelAppUpdate', () => Call.ByName('main.DesktopService.CancelAppUpdate'));

export const GetAppUpdateStatus = () =>
  invoke<any>('GetAppUpdateStatus', () => Call.ByName('main.DesktopService.GetAppUpdateStatus'));

export const InstallAppUpdate = () =>
  invoke<any>('InstallAppUpdate', () => Call.ByName('main.DesktopService.InstallAppUpdate'));

export const OpenAppUpdateSettings = () =>
  invoke<boolean>('OpenAppUpdateSettings', () => Call.ByName('main.DesktopService.OpenAppUpdateSettings'));

// ---- 分享链接与深链 ----------------------------------------------------
// 链接规则本身在 ui/mod-link.ts，这里只负责过桥：分享链接由 Go 生成（与 web 端
// 同一套规则），深链与剪贴板检查由 Go 侧的系统能力提供。

/** 领走页面加载完成前到达的深链（冷启动时点链接就属于这种）。 */
export const TakePendingModLink = () =>
  invoke<string>('TakePendingModLink', () => Call.ByName('main.DesktopService.TakePendingModLink'));

/**
 * 深链事件的名称，必须与 Go 侧 `DeepLinkEventName` 一字不差：
 * 客户端已在运行时点链接，Go 单实例把 argv 转成这个事件送进前端。
 */
export const DeepLinkEventName = 'submodhub:deep_link';

/**
 * 「应用回到前台」事件的名称，必须与 Android 侧 `APP_FOREGROUND_EVENT` 一字不差。
 *
 * 为什么不能只靠 window 的 `focus`：WebView 被切到后台再切回来时，`focus` 与
 * `visibilitychange` 是否触发取决于 WebView 自己有没有被 pause、焦点有没有真的
 * 交给别的窗口——实测/不同版本并不一致，不能当作可靠的触发点。剪贴板又只有前台
 * 应用能读（Android 10+），所以「切回来」这一刻由原生层在 onResume 显式告诉我们，
 * 才是确定的。桌面端收不到这个事件，监听挂着无害。
 */
export const AppForegroundEventName = 'submodhub:app_foreground';

/**
 * 领走 Android 侧留在 window 上的深链（读走即清空）。
 *
 * Android 的原生层在 onPageFinished 时就把链接交出来，而那一刻 React 可能还没
 * 挂载、事件监听还没注册。所以它同时把链接写进这个 window 变量，前端挂载后领一次，
 * 冷启动的那一次点击就不会丢。桌面端没有这个变量，返回空串。
 */
export const TakeNativeDeepLinkURL = (): string => {
  const holder = window as unknown as { __submodhubDeepLink?: string | null };
  const raw = holder.__submodhubDeepLink;
  if (!raw) return '';
  holder.__submodhubDeepLink = null;
  return raw;
};

/** 剪贴板里若是一条站内 mod 链接，返回它的 mod id；否则空串。 */
export const ClipboardModLink = () =>
  invoke<string>('ClipboardModLink', () => Call.ByName('main.DesktopService.ClipboardModLink'));

/** 生成可以被浏览器粘贴打开的分享链接。 */
export const ModShareLink = (modID: string) =>
  invoke<string>('ModShareLink', () => Call.ByName('main.DesktopService.ModShareLink', modID), [modID]);

export const isAndroid = (): boolean => {
  if (typeof window !== 'undefined') {
    if ((window as any).wails?.platform?.() === 'android') return true;
    if (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)) return true;
  }
  return false;
};

export type LocalSubmod = {
  id?: string;
  directory: string;
  name: string;
  author?: string;
  version: string;
  registrations?: Array<{
    name: string;
    author?: string;
    version?: string;
    source: string;
    unknown: boolean;
    dependencies_unknown?: boolean;
  }>;
  files: Array<{ path: string; sha256: string; size: number; derived_from?: string }>;
  /** 已托管安装中，实际拥有该目录内文件的项目；为空表示这是纯未托管目录。 */
  managed_owners?: Array<{ installation_id: string; mod_id?: string; title?: string }>;
  warnings?: string[];
  incomplete?: boolean;
};
export type MASInstancesState = { instances: Array<{ id: string; label: string; root: string; status: { valid: boolean; game_exists: boolean; submods: number; mas_version?: string; available_bytes?: number; total_bytes?: number; diagnostic?: string; diagnostic_detail?: string } }>; active_id: string };
export type Spritepack = { file: string; name: string; author: string; kind: string; group: string; giftname: string; complete: boolean; missing: string[]; preview: string };
export type InstalledArchive = {
  mod_id: string;
  version_id: string;
  version: string;
  title: string;
  author?: string;
  category?: string;
  operation_id: string;
  priority: number;
  files: number;
  size_bytes: number;
  sha256: string;
  installed_at: string;
  submod_dirs: string[];
  sprite_set_ids?: string[];
  sprite_selection_hash?: string;
  selected_sprite_set_count?: number;
};

export type PriorityModInfo = {
  installation_id: string;
  mod_id: string;
  title: string;
  version: string;
  priority: number;
  order: number;
  total_files: number;
  active_files: number;
  overridden_files: number;
};

export type PriorityLayerInfo = {
  installation_id: string;
  mod_id: string;
  priority: number;
  order: number;
  hash: string;
};

export type PriorityPathEntry = {
  path: string;
  key: string;
  active_owner: string;
  active_hash: string;
  drifted: boolean;
  original_exists: boolean;
  original_hash?: string;
  layers: PriorityLayerInfo[] | null;
};

export type PriorityOverview = {
  generation: number;
  mods: PriorityModInfo[] | null;
  paths: PriorityPathEntry[] | null;
};
