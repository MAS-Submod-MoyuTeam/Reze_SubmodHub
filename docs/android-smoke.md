# Android Wails v3 / All files access feasibility gate

Status (2026-10-17): Cross-compilation and native host integration gate **PASSED** on Linux build server `100.72.137.92`.
Physical device verification gate: **PENDING SIDELOAD TEST** on physical arm64 Android 11+ device.

The sideloaded Android 11+ APK targets `/storage/emulated/0/MAS/`, with game
files under `/storage/emulated/0/MAS/game`. The path is a validation target,
not an access grant. The app declares `MANAGE_EXTERNAL_STORAGE`, opens the
app-specific All files access Settings page on explicit user action, and queries
`Environment.isExternalStorageManager()` on launch, return from Settings (`onResume`),
and before every managed file operation via Go backend `StorageAccessGuard`. A manifest
declaration or successful Settings launch is never reported as `granted`. Denial or revocation
returns `permission_lost` and prevents managed reads/writes. No silent SAF or
other-directory fallback is permitted.

## Build Environment (100.72.137.92)

- **Host OS**: Ubuntu 26.04 x86_64 (`Linux sirphomesv 7.0.0-34-generic`).
- **Go**: `go1.26.8 linux/amd64`.
- **JDK**: OpenJDK 21 (`21.0.12.1+1-1-26.04.4-Ubuntu`).
- **Android SDK**: `/opt/android-sdk` (API 35, Build-tools 35.0.0, platform-tools 35).
- **Android NDK**: `/opt/android-sdk/ndk/26.3.11579264` (NDK r26d).
- **Wails CLI**: `v3.0.0-beta.27`.
- **Node.js / npm**: `v22.22.1` / `9.2.0`.
- **Gradle**: `9.2.1`.

## Built Artifact

- **Application ID**: `com.reze.submodhub`
- **Version**: `1.0` (versionCode `1`)
- **minSdkVersion**: `30` (Android 11+)
- **targetSdkVersion**: `35`
- **Output APK**: `cmd/client/SubmodHub/bin/submodhub.apk` (`submodhub-debug.apk`)
- **Size**: ~42.5 MB (44,573,534 bytes)
- **SHA-256**: `B864DA416BE128610B350E46DF4EEA17B711B57449E60AE7BE796F5FA7150A26`
- **Native Architecture**: `arm64-v8a` (`lib/arm64-v8a/libwails.so`, ELF 64-bit LSB shared object)
- **Core Permissions**:
  - `android.permission.MANAGE_EXTERNAL_STORAGE`
  - `android.permission.INTERNET`
  - `android.permission.ACCESS_NETWORK_STATE`

## Native Integration Contract

1. Java host: `com.wails.app.SubmodHubStorageAccess` implements:
   - `getStorageAccessState()`: checks `Build.VERSION.SDK_INT >= 30` and `Environment.isExternalStorageManager()`.
   - `requestStorageAccess()`: fires `Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION` with package URI fallback to general all-files settings.
   - `onResume()`: forwards event `submodhub:storage_state_changed` to WebView.
2. Go client: `StorageAccessGuard` default-denies operations unless real-time state is `"granted"`.
   - Operations returning `permission_lost`: `ScanLocalSubmods`, `ListInstalledArchives`, `ListInstalledModFiles`, `ScanInstalledSpritepacks`, `CreateSpriteGift`, `DeleteSpritepack`, `PreviewArchive`, `PreviewAdopt`, `PreviewUninstall`, `PreviewRepair`, `PreviewPriority`, `GetPriorityOverview`, `ExecutePlan`, `ApplyArchive`, `Uninstall`, `Recover`, `RollbackOperation`.
   - Fixed instance: on Android, `ListMASInstances()` exposes only `/storage/emulated/0/MAS/` as `android-mas`. Manual adding/browsing/removing instances and launching `DDLC.exe` are disabled.
3. Frontend UI:
   - `StorageAccessBanner`: prompts for All files access when denied/unsupported, allows catalog browsing, offers direct button to open system settings.
   - `MobileNavBar`: responsive bottom navigation bar replacing fixed sidebar on mobile screens (< 768px).

## Physical Device Verification Gate Checklist

1. Record device model, Android version, Wails version, Go/JDK/SDK/NDK versions,
   build command, APK path, and SHA-256.
2. Sideload and launch `submodhub-debug.apk` on an arm64 Android 11+ physical device.
3. Before granting access, confirm `GetAndroidStorageAccess` returns `denied` and managed file operations fail with `permission_lost`, while remote catalog browsing remains functional.
4. Tap "去设置授权" (`RequestAndroidStorageAccess`); confirm system Settings opens SubmodHub's permission toggle.
5. Turn on permission, switch back to SubmodHub: confirm `onResume` auto-detects `granted`.
6. Run disposable test directory check: verify create, read, replace, list, delete.
7. Confirm `/storage/emulated/0/MAS/` detection: if missing or lacks `game/`, report `mas_game_directory_missing` or `invalid_mas_root` without crashing or writing false files.
8. Revoke permission in Settings, switch back: confirm status updates to `denied` immediately and further writes halt with `permission_lost`.
