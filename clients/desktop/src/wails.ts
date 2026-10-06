import { ApplyArchive, GetMASStatus, Recover, ScanLocalSubmods, SetMASRoot, Uninstall } from '@wails-bindings/desktopservice.js';

export { ApplyArchive, GetMASStatus, Recover, ScanLocalSubmods, SetMASRoot, Uninstall };

export type LocalSubmod = { directory: string; name: string; version: string; files: Array<{ path: string; sha256: string; size: number }> };
