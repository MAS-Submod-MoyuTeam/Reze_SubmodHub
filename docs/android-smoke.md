# Android Wails v3 / All files access feasibility gate

Status (2026-10-04): pending native host integration and physical-device test.
This is a joint Windows/Android release blocker, not evidence that storage
access works.

The sideloaded Android 11+ APK targets `/storage/emulated/0/MAS/`, with game
files under `/storage/emulated/0/MAS/game`. The path is a validation target,
not an access grant. The app must declare `MANAGE_EXTERNAL_STORAGE`, open the
app-specific All files access Settings page on explicit user action, and query
`Environment.isExternalStorageManager()` on launch, return from Settings, and
before every managed file operation. A manifest declaration or successful
Settings launch must never be reported as `granted`. Denial or revocation
returns `permission_lost` and prevents managed reads/writes. No silent SAF or
other-directory fallback is approved.

## Local environment

- Go: `go1.25.3 windows/amd64`.
- JDK 21 is installed.
- Android SDK directories exist at `J:\Renpy\renpy-8.2.3-sdk\rapt\Sdk` and
  `C:\Users\Administrator.DESKTOP-465SP1L\AppData\Local\Android\Sdk`.
- `adb devices -l` returned no connected device on 2026-10-04.
- Wails CLI `v3.0.0-beta.27` is available in the Go bin directory.
- `wails3 doctor` finds Android SDK/platform-tools but reports Android NDK
  26.3.x missing.
- This Wails version's Android Go shared-library task supports Darwin/Linux
  hosts only; this Windows host cannot run that task as-is. Use a compatible
  Linux/macOS build host with the pinned NDK, or revise the build task with a
  separately verified Windows toolchain before claiming an APK build.

## Native integration contract

The generated Wails Android `AndroidManifest.xml` does not declare
`MANAGE_EXTERNAL_STORAGE`, and its Java host has no SubmodHub permission
bridge. A project-local generated Android host must add both. On Android 11+,
`GetAndroidStorageAccess` queries `Environment.isExternalStorageManager()`;
`RequestAndroidStorageAccess` opens
`Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION` with
`Uri.parse("package:" + getPackageName())`. If the app-specific intent cannot
be handled, it may open `Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION`.
The settings call reports only whether a page opened. `onResume` refreshes the
observable state. Unsupported Android versions report `unsupported`; Android
10 and older have no automatic storage-permission fallback in this design.

The Go filesystem adapter must check the grant again before reads/writes,
validate the fixed MAS root and `game/`, and reject paths that escape that root.
The permission bridge and adapter must be tested independently of UI state.
Google Play policy may reject this special permission; distribution is by
sideloaded APK for this release.

## Device test, disposable shared-storage tree only

1. Record device model, Android version, Wails version, Go/JDK/SDK/NDK versions,
   build command, APK path, and SHA-256.
2. Build, sideload, and launch the Wails APK. Before granting access, confirm
   `GetAndroidStorageAccess` returns `denied` and managed file operations fail
   with `permission_lost`, even if `/storage/emulated/0/MAS/` already exists.
3. Trigger `RequestAndroidStorageAccess`; confirm the Android Settings page is
   for this app. Grant access, return to the app, and confirm the fresh status
   is `granted`. Cancel/deny once as a separate branch and confirm it remains
   `denied` without a write.
4. In an explicitly created disposable directory such as
   `/storage/emulated/0/SubmodHubSmoke/`, create, read, replace, list, and
   delete a test file through the same grant-gated adapter. Assert bytes and
   listing after each operation. Do not test writes/deletes in the real MAS
   installation.
5. Force-stop and relaunch. Confirm the grant is still observed and read from
   the disposable tree works without opening Settings again.
6. Revoke All files access in Android Settings, return/relaunch, and confirm
   status changes to `denied`, the UI offers reauthorization, and managed
   reads/writes fail with `permission_lost` rather than writing elsewhere.
7. After those checks, probe `/storage/emulated/0/MAS/` read-only and validate
   `game/`. Report `invalid_mas_root` if absent or malformed.

If the native bridge or real-device filesystem operations fail, stop the joint
release path and revise the approved design with the user. No APK or device
behavior is considered verified until the above results are recorded.
