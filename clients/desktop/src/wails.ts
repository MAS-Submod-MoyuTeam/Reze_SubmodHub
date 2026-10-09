import { ApplyArchive, GetMASStatus, Recover, ScanLocalSubmods, SetMASRoot, Uninstall } from '@wails-bindings/desktopservice.js';
import { AddMASInstance, BrowseMASDirectory, ListMASInstances, RemoveMASInstance, SelectMASInstance } from '@wails-bindings/desktopservice.js';

export { ApplyArchive, GetMASStatus, Recover, ScanLocalSubmods, SetMASRoot, Uninstall };
export { AddMASInstance, BrowseMASDirectory, ListMASInstances, RemoveMASInstance, SelectMASInstance };

export type LocalSubmod = { directory: string; name: string; version: string; files: Array<{ path: string; sha256: string; size: number }> };
export type MASInstancesState = { instances: Array<{ id: string; label: string; root: string; status: { valid: boolean; game_exists: boolean; submods: number } }>; active_id: string };
