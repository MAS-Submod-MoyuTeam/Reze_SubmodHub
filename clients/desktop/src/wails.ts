import * as native from '@wails-bindings/desktopservice.js';
import { Call } from '@wailsio/runtime';
import type { Operation } from './types/client';

const browserMode = Boolean(import.meta.env?.VITE_BROWSER_MODE === '1');

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
  files: Array<{ path: string; sha256: string; size: number }>;
  warnings?: string[];
  incomplete?: boolean;
};
export type MASInstancesState = { instances: Array<{ id: string; label: string; root: string; status: { valid: boolean; game_exists: boolean; submods: number; available_bytes?: number; diagnostic?: string; diagnostic_detail?: string } }>; active_id: string };
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
