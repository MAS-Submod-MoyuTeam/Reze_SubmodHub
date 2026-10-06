# Execution Checkpoint

The Android SAF references below record an earlier decision and are superseded
by the All files access decision at the end of this checkpoint.

The approved plan is being executed in independent slices. The first slice is
the pure package scanner and MAS path mapper. Later slices cover installer state
and service APIs. Concrete frontend UI work is paused by user request;
`docs/frontend-contract.md` is the design handoff.

## Todo checkpoint, 2026-10-04

- [ ] M0: Wails v3 Android SAF tree proof on physical device. Device will be
  connected later; built-in directory dialog is currently unsupported.
- [x] M1: legacy ZIP scanner, static metadata, and path safety. `go test ./...`
  and `go vet ./...` pass for `internal/package` and `internal/maspath`.
- [x] Initial dependency/priority solver slice: `internal/solver` provides
  deterministic effective stacks, required dependency blockers, and install
  previews. Uninstall and semantic conflict extensions remain open.
- [ ] M2: journaled local installer and recovery.
- [ ] M3: service, storage, identity, moderation, and API.
- [ ] M4: Windows/Android Wails bindings and main journeys.
- [x] Frontend design input: `docs/frontend-contract.md` records target
  functions and interfaces. UI implementation is intentionally paused.

Evidence: `go test ./...` and `go vet ./...` exit 0 on 2026-10-04. `adb devices
-l` lists no device. The Wails v3 Android guide says open-directory dialogs
return errors, so a custom SAF tree bridge is part of M0, not an assumed
framework capability.

Drift check: work remains within the approved Go/Wails architecture and does
not modify MAS saves or the reference installation. Next evidence gate: add
installer journal tests and obtain Wails/SAF device evidence before claiming a
joint Windows/Android release.

## Resume checkpoint, 2026-10-04

- Public API now hides draft mods/versions and unpublished archive bytes, and
  omits internal `archive_path` from version responses. Focused tests pass.
- PostgreSQL mode no longer imports local `catalog.json`; it still uses a JSONB
  snapshot and a local archive volume, not the planned relational model/S3.
- Shared `ui/catalog-api.ts` loads public entries/latest versions and download
  descriptors. Web/desktop/Android shells read the real public catalog. Web
  fake login/role grants were disabled. Desktop/Android navigation to local
  installation workflows is blocked pending Go bindings. Their design-draft
  handlers remain in source but are not reachable from the current navigation;
  they must not be treated as product behavior.
- Remote PostgreSQL `initdb` was delayed in D state (`blk_mq_get_tag`) but later
  recovered. The fallback API container also started late. It was stopped and
  the newly built Compose API started against healthy PostgreSQL. Fresh smoke
  results: health 200, empty catalog 200, unknown download 404, uploads 503.
  Restart persistence and host storage health remain unverified.
- Next: finish M2 journaled installer and M3 identity/review/storage, then
  replace remaining mock client actions with real Wails bindings. M0 still
  needs a physical Android device and SAF evidence.

## Identity and Android decisions, 2026-10-04

- User confirmed MAS_UniSync's Flarum protocol and forum URL. Only Flarum
  group IDs `16` and `22` grant `admin`; other groups remain `user` until
  explicit role administration exists. GitHub OAuth is deferred.
- PostgreSQL metadata plus local ZIP volume is accepted for testing; MinIO is
  deferred, not removed from the approved release design.
- Android MAS root is fixed to `/storage/emulated/0/MAS/`; `game/` lives below
  it. SAF grant and physical-device test remain mandatory before writing.
- Flarum client and session API are implemented locally with fake-provider
  tests. The remote server still runs the previous API image; the new login
  endpoint has not been deployed there. TLS reverse-proxy configuration and
  end-to-end forum login are not yet verified. No credentials were copied
  from MAS_UniSync.

## Android permission decision and current M0 gate, 2026-10-04

- User approved a sideloaded Android 11+ APK using
  `MANAGE_EXTERNAL_STORAGE` for fixed `/storage/emulated/0/MAS/`, with `game/`
  below it. SAF tree selection is retired as the primary/fallback path.
- M0 remains open. The Wails beta.27 generated manifest lacks the permission
  and its Java host lacks a SubmodHub bridge. No project-local Android native
  host, APK, or device result exists yet. The Windows host lacks NDK 26.3.x;
  Wails' embedded Android Go build task supports Darwin/Linux hosts only.
- Current slice changed the approved spec, implementation plan, frontend
  contract, and smoke protocol. The native bridge must declare permission,
  open the app-specific Settings page, query
  `Environment.isExternalStorageManager()` on launch/return/pre-operation,
  and expose `GetAndroidStorageAccess`/`RequestAndroidStorageAccess`.
- Fresh checks for this documentation slice: `go test ./...`, `go vet ./...`,
  and `git diff --check` exited 0; `adb devices -l` listed no device. These
  checks do not verify an APK, permission prompt, or MAS filesystem access.
- Next: create the Wails client host and permission adapter with tests, then
  build on a compatible host and run the real-device disposable-tree smoke.
  The user can connect an Android device later. Do not write to the real MAS
  tree for M0.
- Drift check: fixed root and Wails v3 joint-release boundary are unchanged;
  only Android permission acquisition changed. Decision: continue, but M0
  remains unverified and blocks Android release claims.

## Web and Windows return, 2026-10-04

- Android M0 is paused at its existing unverified gate. No Android native work,
  remote deployment, or preview server is part of this slice.
- The public `/api/v1/mods` endpoint now filters published mods by query,
  category, platform, and tag, returns stable ID-ordered pages, and validates
  `limit`/`cursor`. The shared `ui/catalog-api.ts` loads every page before
  mapping latest versions, so Web and desktop catalog consumers see the full
  server result rather than silently stopping after the first page.
- Red/green evidence: new Go pagination tests failed with three unfiltered
  items and no cursor, then passed after implementation; the shared TypeScript
  test failed with only `m1` instead of `m1,m2`, then passed. Web and desktop
  `npm run lint` passed.
- Full verification: `go test ./...`, `go vet ./...`, eight shared TypeScript
  API tests, Web/desktop `npm run build`, and `git diff --check` exited 0.
  Both Vite builds emitted the pre-existing `__dirname` future-compatibility
  warning; no local preview was started.
- Next: continue real author/reviewer API and role administration, then build
  Windows Wails bindings and local installer against a disposable MAS fixture.
  The current browser/desktop installation and author-review demo handlers are
  not authoritative product behavior.
- Drift check: this slice stayed in shared public catalog behavior and did not
  alter MAS files or remote service state. Decision: continue.

## Verified archive download slice, 2026-10-04

- Web's direct archive link now downloads through shared size/SHA-256 checking
  before creating a browser save. The desktop catalog detail exposes the same
  verified ZIP download while the native install-plan action remains blocked.
- Relative archive URLs resolve against the configured API origin; external
  URLs require HTTPS. Protocol-relative URLs, expired descriptors, archives
  above the current 64 MiB browser limit, and mismatched bytes are rejected.
- The shared tests were run red before implementation and green after it;
  Web and desktop TypeScript checks passed. Fresh `go test ./...`, `go vet
  ./...`, all 12 shared TypeScript API tests, both Vite builds, and `git diff
  --check` exited 0. Both builds retained the existing `__dirname` warning.
  Browser interaction with a published ZIP is still unverified because no
  published test version is available locally and previews remain stopped.
  This is a browser-mediated ZIP download, not a native Windows installer or
  Wails binding.
- Next: author/reviewer service endpoints and explicit role administration,
  then Windows installer bindings and disposable-MAS integration evidence.
  Android M0 and remote deployment remain untouched.

## Web role administration slice, 2026-10-04

- Added persisted `flarum:<numeric_id>` role grants to the catalog snapshot and
  a CSRF-protected `POST /api/v1/admin/users/{id}/roles` endpoint. Only
  `author` and `reviewer` are grantable; `admin` still comes only from Flarum
  group IDs 16/22. `GET /session` and login responses merge current grants so
  existing sessions see changes without re-login.
- Replaced the Web admin demo user/health cards with a real Flarum ID role
  form. The navigation link is visible only for an authenticated admin. No
  fake user or audit success is retained in the reachable UI.
- Next: implement author draft/version/upload endpoints and reviewer queue
  against the same persisted catalog, then bind the real forms. PC installer
  and Android M0 remain outside this slice.

## Author and review service slice, 2026-10-04

- Added session-authorized author draft creation, candidate version creation,
  ZIP upload/scan authorization, and submission creation.
- Added reviewer queue, approve/reject decisions with reasons, and separate
  publish transition. Publication updates the public latest-version pointer;
  published archive bytes remain immutable.
- Kept the existing bearer upload token as a compatibility path while allowing
  authenticated author sessions; no frontend visual work was added.
- Added integration coverage for author draft -> version -> review approval ->
  publication, plus OpenAPI route documentation.
- Fresh evidence: lifecycle test, `go test ./...`, `go vet ./...`, Web lint,
  and `git diff --check` exit 0. Web build was green earlier in this slice;
  its existing Vite `__dirname` warning remains.
- Next: replace reachable Web author/reviewer demo mutations with these service
  calls, then implement Windows Wails bindings and disposable-MAS installer
  evidence. Android M0 remains paused and unverified.

Drift check: service state transitions stay in the Go API and persisted catalog;
the existing mock frontend handlers are not treated as authoritative behavior.
No remote deployment, preview server, Android code, or MAS tree mutation was
performed.

## Web and PC continuation, 2026-10-04

- Added shared Web submission API helpers for author creation/submission,
  multipart archive upload, reviewer decisions, and publication. Reachable Web
  reviewer actions and author submission/upload paths now call the service;
  local UI state remains an optimistic display layer until reload.
- Added `internal/install` Windows-ready filesystem core with safe relative
  paths, expected-hash drift blocking, backup journal, atomic temp-file rename,
  and restoration of external files on uninstall.
- Evidence: install tests, submission API tests, Web lint, `go test ./...`,
  and `git diff --check` pass. The existing Vite `__dirname` warning remains.
- Remaining: replace optimistic author draft/version creation with server
  responses, bind the desktop UI to Wails Go bindings, and add disposable MAS
  end-to-end installer tests. Android and remote deployment remain paused.

## Web and PC continuation, 2026-10-05

- Web author draft and candidate-version actions now issue real service requests
  and reconcile temporary UI IDs with server IDs. ZIP upload remains multipart
  and reviewer mutations remain server-backed.
- `internal/install` now exposes journal loading and recovery. Recovery restores
  backed-up paths for incomplete operations and records `rolled_back` state.
- Evidence: three installer tests, submission API tests, `go test ./...`,
  `go vet ./...`, Web lint/build, and `git diff --check` pass. Vite retains its
  pre-existing `__dirname` warning.
- Remaining: desktop UI must call Wails bindings instead of simulated timers;
  disposable MAS integration still needs install/update/uninstall/recovery
  coverage. Android remains paused.

## Windows Wails and real MAS slice, 2026-10-05

- Generated a Wails v3 beta.27 Windows client under `cmd/client/SubmodHub`.
  The service bindings expose `SetMASRoot`, `GetMASStatus`, `ApplyFile`, and
  `Recover`, backed by the shared Go installer rather than browser timers.
- The default Windows test root is `E:\MAS_Cn001280\MAS_CN0012F0`, while an
  environment variable can override it. The Wails frontend now presents a
  real MAS validation action and displays the bound status.
- Ran the explicit `mas_integration` test against the user's MAS tree. It
  created a unique marker under `game/Submods`, verified the bytes, removed it
  with an expected-hash guard, and confirmed the marker was gone. No existing
  submod was modified. The integration journal was created under the MAS
  `.submodhub/integration-state`; the test now cleans this path on future runs.
- Fresh evidence: Wails binding generation, Windows development build,
  nested client tests/build, real MAS integration test, root Go tests, Web
  tests/build, and diff checks. Wails task emitted non-fatal Windows shell
  utility warnings for `uname`/`tail`.
- Remaining: wire the full existing desktop React UI to these generated Wails
  bindings, then run install/update/uninstall/recovery against disposable
  real-MAS subdirectories. Android remains paused.

## Desktop React to Wails binding slice, 2026-10-05

- Wails frontend build now uses the existing `clients/desktop` React source;
  the generated demo screen is no longer the desktop product surface.
- Added the generated binding adapter to the desktop UI. MAS validation,
  instance reauthorization, verified archive download, archive Base64 handoff,
  ZIP re-scan, path mapping, journaled write, and install result display now
  use the Go service. Browser/preview builds continue to use the same source
  with binding calls caught as unavailable outside Wails.
- Added `ApplyArchive` binding and tests; it verifies archive SHA-256, scans
  the ZIP again server-side in Go, reads mapped entries, and applies them under
  the configured MAS root. No simulated content is written for archive
  installs.
- Fresh evidence: root Go tests/vet, Web lint/build, desktop lint/build,
  Wails client tests, and `wails3 task windows:build ARCH=amd64 DEV=true` pass.
  Vite `__dirname` and Wails shell `uname`/`tail` warnings are non-fatal.
- Remaining: uninstall/update need a real installed-file manifest and should
  be wired to explicit Go operations before being called real; current UI
  fallback simulation remains visible for those paths. Android remains paused.
