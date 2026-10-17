# Android review fixes

## Scope

Fix the browser test build constraint, preserve encoded Android API URLs, and
route registration matching through a Go binding because WebView request
interception does not expose POST bodies. Preserve the existing internal-storage
lock mapping and do not execute mod installation during device verification.

## Changes

- Add the non-browser constraint to the API bridge test.
- Preserve encoded paths and queries in Android request interception.
- Send registration names as JSON through MatchRegistrations on native Android;
  keep browser and desktop fetch behavior unchanged.
- Isolate the exported JNI API bridge from the storage JNI preamble to avoid
  duplicate JNI_OnLoad/JNI_OnUnload symbols, and use zero-valued JNI handles.
- Avoid duplicate Content-Type response headers and separate MIME parameters.

## Evidence

- Root module: go test -count=1 ./... passed.
- Client module: default and browser-tagged tests passed with -count=1.
- Frontend: TypeScript checking and production build passed.
- Android arm64 native compilation and Gradle APK assembly passed.
- Installed the APK with adb install -r on 100.100.193.117:5555.
- SetMASRoot returned success against the real shared-storage MAS directory.
- Preview returned HTTP 200, a single image/png Content-Type, and 59,921 bytes.
  All four displayed sprite thumbnails decoded to 180 by 180 pixels.
- Clicking install for MAS Ignore TL Conflicts Submod reached the plan preview
  with one CREATE action and all safety checks passing. Cancelled the plan;
  did not confirm mod file writes.

## Remaining boundary

The configured test backend returns HTTP 404 for registration matching. Client
POST payload delivery is covered by mock-backend tests, but successful matching
against that deployment remains unverified. No backend deployment was changed.
Actual mod writes, rollback, and crash recovery were not exercised on the device.

APK: cmd/client/SubmodHub/bin/submodhub-review-fixed.apk
SHA-256: 6735C79687F7512316A9A793C7C11FDB921B2FB0DEC114C549020E4D8F59C988
