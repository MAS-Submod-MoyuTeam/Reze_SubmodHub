import * as native from '@wails-bindings/desktopservice.js';

const browserMode = import.meta.env.VITE_BROWSER_MODE === '1';

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
export const ListInstalledArchives = () => invoke('ListInstalledArchives', () => native.ListInstalledArchives());
export const ScanInstalledSpritepacks = () => invoke('ScanInstalledSpritepacks', () => native.ScanInstalledSpritepacks());
export const CreateSpriteGift = (file: string) => invoke('CreateSpriteGift', () => native.CreateSpriteGift(file), [file]);
export const DeleteSpritepack = (file: string) => invoke('DeleteSpritepack', () => native.DeleteSpritepack(file), [file]);
export const ApplyArchive = (request: Parameters<typeof native.ApplyArchive>[0]) => invoke('ApplyArchive', () => native.ApplyArchive(request), [request]);
export const Uninstall = (operationID: string, uninstallID: string) => invoke('Uninstall', () => native.Uninstall(operationID, uninstallID), [operationID, uninstallID]);
export const Recover = (operationID: string) => invoke('Recover', () => native.Recover(operationID), [operationID]);
export const BrowseMASDirectory = () => browserMode ? Promise.reject(new Error('浏览器模式请手动输入 MAS 根目录')) : native.BrowseMASDirectory();

export type LocalSubmod = { directory: string; name: string; version: string; files: Array<{ path: string; sha256: string; size: number }> };
export type MASInstancesState = { instances: Array<{ id: string; label: string; root: string; status: { valid: boolean; game_exists: boolean; submods: number } }>; active_id: string };
export type Spritepack = { file: string; name: string; author: string; kind: string; giftname: string; complete: boolean; missing: string[]; preview: string };
export type InstalledArchive = { mod_id: string; version_id: string; version: string; title: string; operation_id: string; files: number; size_bytes: number; sha256: string; installed_at: string; submod_dirs: string[] };
