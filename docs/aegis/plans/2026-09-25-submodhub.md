# Reze SubmodHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use aegis:subagent-driven-development (recommended) or aegis:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Frontend implementation is assigned to another agent; the tasks below define its contract and acceptance floor.

**Goal:** Ship a self-hosted public MAS submod store with WebUI publication and Wails v3 Windows/Android clients that safely manage legacy ZIP submods and sprite packs.

**Architecture:** One Go service owns catalog, identity, review, PostgreSQL state, and S3-compatible ZIP storage. One shared Go install core owns ZIP inspection, path mapping, dependency/conflict planning, local ownership, backups, and recovery; both Wails v3 clients call it. WebUI consumes `/api/v1` and has a separately assigned frontend implementer.

**Tech Stack:** Go; Wails v3; PostgreSQL; MinIO/S3; OpenAPI 3.1; Docker Compose; WebUI framework chosen by the frontend agent within the API contract.

**Baseline / Authority Refs:** [approved design](../specs/2026-09-25-submodhub-design.md); local MAS `zz_submods.rpy`, `0_submod_extractor_ren.py`, `0_submod_uninstaller_ren.py`, `0_0android_permissions.rpy`, and `zz_spritejsons.rpy`; MAICA ZIP layout; MAS_UniSync Flarum API login.

**Compatibility Boundary:** Accept existing ZIP package shapes without an embedded manifest; preserve MAS's path and registration conventions; do not modify MAS saves or silently delete/overwrite externally changed files. Windows and Android clients both remain Wails v3.

**Joint Release Requirement:** The first official release ships PC (Windows) and Android together. Both clients must pass the same feature checklist: catalog, MAS directory selection, installation, priority conflict resolution, update, uninstall, and recovery. A platform-specific milestone cannot be described as the finished product.

**Verification:** `go test ./...`, API integration tests against disposable PostgreSQL/MinIO, `wails3 build` for Windows and Android, and an Android real-device SAF/file-operation smoke run. Each slice below has narrower acceptance checks.

---

## Delivery map

| Milestone | Deliverable | Release gate |
|---|---|---|
| M0 | Wails v3 Android SAF proof of concept | Real-device read/write/delete and persisted grant work |
| M1 | Pure Go archive scanner and install planner | Legacy fixtures and adversarial ZIP tests pass |
| M2 | Local journaled installer for Windows and Android | Install/reorder/update/uninstall/recovery pass |
| M3 | Go API, identity, storage, review | End-to-end publish/download API passes |
| M4 | Wails client functions on both platforms | Main user journey passes on Windows and device |
| M5 | WebUI functions and release operations | Author and reviewer journeys pass; deployment rehearsal passes |

M0 is a genuine stop/go gate for the joint PC/Android first release. If Wails v3 cannot supply SAF stream operations and a persistent document-tree grant, record evidence and revise the approved design with the user before developing the Android installer. Do not silently substitute a second Android framework or release PC alone as the completed project.

## Proposed file ownership

| Path | Owner and responsibility |
|---|---|
| `internal/package/` | ZIP entry validation, legacy root detection, static metadata and sprite JSON scan |
| `internal/maspath/` | MAS installation detection and normalized target-path mapping |
| `internal/solver/` | Dependencies, semantic conflicts, priority stacks, and operation previews |
| `internal/install/` | Durable journal, backup store, application, update, uninstall, and recovery |
| `internal/platform/` | Platform-neutral tree/stream interface; Windows filesystem and Android SAF adapters |
| `internal/catalog/` | Catalog, version, submission, review, and GitHub source business rules |
| `internal/auth/` | Flarum API login, GitHub OAuth, sessions, identities, roles |
| `internal/storage/` | PostgreSQL repositories and S3-compatible archive objects |
| `internal/httpapi/` | `/api/v1` routing and DTO/error contracts |
| `cmd/server/` | Service entry point and configuration |
| `cmd/client/` | Wails v3 application and Go bindings |
| `web/` | WebUI implementation by the designated frontend agent |
| `api/openapi.yaml` | Shared REST contract and generated client input |
| `deploy/` | Compose, migrations, reverse-proxy example, and release operations |
| `testdata/` | Safe minimal ZIP fixtures derived from observed legacy layouts |

These paths are proposed owners for the new repository, not claims that code already exists. Each owner should expose small interfaces rather than importing a UI package into domain logic.

## Phase 0 — Validate Wails v3 Android before core implementation

### Task 0.1: Pin toolchain and create disposable smoke app

**Files:** create `go.mod`, `cmd/client/main.go`, `internal/platform/tree.go`, `internal/platform/android/`, `internal/platform/windows/`, `docs/android-smoke.md`.

**Why:** The requested all-Wails architecture depends on Android SAF access. Establish versioned toolchains and a minimal tree interface before the install engine is built.

**Contract:** `Tree` provides `List`, `OpenRead`, `CreateOrReplace`, `Delete`, `Stat`, and `Close` on root-relative logical paths. Android stores document URIs, not raw filesystem paths. The smoke app only operates on a disposable directory selected by the user.

- [ ] Pin the Wails v3 and Go versions used by the smoke app; record Android SDK/Gradle versions in `docs/android-smoke.md`.
- [ ] Use the pinned Wails v3 CLI's documented Android build task to build and launch the app on a real device; record the exact command and resulting APK path in the smoke log.
- [ ] Select a disposable tree with SAF, persist grant, create/read/replace/delete a test file, relaunch, and read it again.
- [ ] Test grant revocation and show a recoverable `permission_lost` state without writing outside the selected tree.
- [ ] Record device model, Android version, Wails commit/version, outcomes, and failing API limitations. Gate M0 on successful evidence.

**Verification:** `go test ./internal/platform/...`; Android device smoke steps above; no MAS production tree is modified.

### Task 0.2: Windows directory adapter and MAS detection

**Files:** create `internal/platform/windows/tree.go`, `internal/maspath/detect.go`, tests in the same packages.

- [ ] Probe known MAS locations and validate `game/` plus MAS marker files; never treat an arbitrary `game/` directory as confirmed MAS.
- [ ] Add a manual directory selector binding and store multiple validated installations.
- [ ] Test invalid roots, nested `game` selection, case differences, and a moved game directory.

**Verification:** `go test ./internal/platform/windows ./internal/maspath` with temp fixture directories.

## Phase 1 — Pure package and conflict core

### Task 1.1: ZIP safety and legacy path mapping

**Files:** create `internal/package/zip.go`, `internal/package/roots.go`, `internal/maspath/map.go`, and `testdata/zip/` fixtures.

**Why:** ZIP input is untrusted, and legacy package structures differ. A complete file map is required before any write.

- [ ] Add fixtures for MAICA-style `game/Submods` plus `game/python-packages`, nested roots, top-level `Submods`, loose `.rpy`, and sprite assets.
- [ ] Reject absolute paths, `..`, drive/device paths, symlinks, duplicate normalized paths, case-fold collisions on Windows, and oversized entry count/uncompressed size/compression ratio.
- [ ] Map supported roots into logical MAS target paths; report unsupported files without copying them.
- [ ] Preserve the original ZIP and output a normalized scan report with path, size, hash, classification, and warnings.

**Verification:** `go test ./internal/package ./internal/maspath`; fixtures assert exact target-file sets. Tests must include malformed archives and ensure no writes outside the disposable root.

### Task 1.2: Static MAS and sprite metadata

**Files:** create `internal/package/submod.go`, `internal/package/sprite.go`, and tests.

- [ ] Parse bounded, simple `Submod(...)` registration forms and mark complex Python expressions `unknown` rather than evaluating them.
- [ ] Parse sprite JSON `giftname` and sprite identity; represent gift creation as an owned derived output.
- [ ] Flag binary/executable content for review without rejecting all such extensions.
- [ ] Detect duplicate MAS registration names and duplicate sprite `giftname`/identity across packages and the target MAS baseline.

**Verification:** `go test ./internal/package` with MAICA-style metadata, valid sprite JSON, malformed JSON, and nonliteral script expressions.

### Task 1.3: Dependency and priority solver

**Files:** create `internal/solver/dependency.go`, `internal/solver/priority.go`, `internal/solver/plan.go`, and tests.

- [ ] Check author-declared required dependencies and version ranges; use static extraction for warnings only.
- [ ] Build an effective-content stack for every target path; define tie order as installation sequence followed by stable mod ID.
- [ ] Produce install, upgrade, priority-change, and uninstall previews with changed paths and required backups.
- [ ] Block semantic sprite and duplicate registration conflicts; display structural path conflicts as resolved by priority.
- [ ] Block removal of versions required by installed dependents.

**Verification:** `go test ./internal/solver` with table tests for missing dependencies, priority inversion, ties, semantic collisions, and uninstall blockers.

## Phase 2 — Journaled local installer

### Task 2.1: Local state and baseline scan

**Files:** create `internal/install/state.go`, `internal/install/baseline.go`, `internal/install/schema.sql`, and tests.

- [ ] Persist installations, managed versions, file layers, external baseline hashes, backups, and journal operations outside the MAS tree where possible.
- [ ] Mark discovered preexisting files `external`; do not infer ownership from directory names alone.
- [ ] Detect when on-disk hashes drift from recorded applied hashes and return a typed `external_change` error.

**Verification:** `go test ./internal/install`; reopen state after process restart and verify exact round-trip of file stacks.

### Task 2.2: Apply, recover, update, uninstall

**Files:** create `internal/install/apply.go`, `backup.go`, `recover.go`, `uninstall.go`, and tests.

- [ ] Refuse writes while MAS is running; create a complete plan and ensure space/permissions before the first mutation.
- [ ] Journal each operation as `planned`, `backed_up`, `writing`, and `committed`, with expected old/new hashes.
- [ ] Back up external and lower-priority content before replacement; write through the platform `Tree` interface.
- [ ] On interruption, replay or reverse only files whose hashes match the journal; stop on external changes.
- [ ] Update by replacing changed files and retiring removed old-version files; uninstall by revealing the next valid content layer.
- [ ] Prune backups only when no active stack or incomplete operation references them.

**Verification:** `go test ./internal/install/...` using a fault-injecting fake tree that fails after each file operation. Check that recovery never deletes an external or manually modified file.

## Phase 3 — Self-hosted service and API

### Task 3.1: Persistence, storage, and API skeleton

**Files:** create `cmd/server/main.go`, `internal/storage/postgres/`, `internal/storage/object/`, `internal/httpapi/`, `api/openapi.yaml`, `deploy/compose.yaml`, and migrations.

- [ ] Define schema for users, external identities, roles, mods, versions, submissions, reviews, immutable archive objects, GitHub sources, and audit events.
- [ ] Implement content-addressed ZIP storage with SHA-256 verification and fixed published version IDs.
- [ ] Expose `/api/v1` catalog list/detail/version/download descriptor with cursor pagination and stable `code/message/details` errors.
- [ ] Start PostgreSQL and MinIO in disposable Compose environment; run migrations and verify restart persistence.

**Verification:** `go test ./internal/storage/... ./internal/httpapi/...`; `docker compose -f deploy/compose.yaml up -d` followed by API smoke requests. Document exact env variables without committing secrets.

### Task 3.2: GitHub and Flarum identity

**Files:** create `internal/auth/flarum.go`, `github.go`, `session.go`, `roles.go`, `internal/httpapi/auth.go`, and tests.

- [ ] Implement Flarum `/api/token` then `/api/users/{id}` server-side; never persist password or expose Flarum token to clients.
- [ ] Implement GitHub OAuth authorization code, state, callback, and user-ID lookup.
- [ ] Link identities only from an authenticated account with a fresh provider login; reject duplicate links.
- [ ] Refresh configured Flarum group role mapping on each Flarum login; grant GitHub roles through admin controls.
- [ ] Protect author/reviewer/admin endpoints with role checks and CSRF-safe sessions.

**Verification:** `go test ./internal/auth ./internal/httpapi` using fake provider servers; assert role downgrade, failed login, account-link collision, and secret non-disclosure.

### Task 3.3: Author submission and moderation

**Files:** create `internal/catalog/mod.go`, `submission.go`, `review.go`, `source.go`, `internal/httpapi/catalog.go`, `submission.go`, `review.go`, and tests.

- [ ] Implement draft/upload/scan/submit/reject/approve/publish transitions and audit events.
- [ ] Reuse the pure ZIP scanner server-side; persist the report beside the unmodified object.
- [ ] Require reviewer decision before publication; prevent mutation of published bytes or hashes.
- [ ] Import a GitHub Release asset as a new draft and run the same scan/review path.
- [ ] Add configured upload size/rate limits and reject unsupported ZIP structures with actionable scan results.

**Verification:** `go test ./internal/catalog ./internal/httpapi`; integration scenario submits a fixture ZIP, approves, downloads, and checks byte-for-byte identity and hash.

## Phase 4 — Wails client functionality

### Task 4.1: Shared Go bindings and local workflow

**Files:** create `cmd/client/bindings.go`, `internal/client/api.go`, `internal/client/workflow.go`, and tests.

- [ ] Bind installation discovery/selection, catalog query, download, scan preview, install, priority reorder, update, uninstall, backup recovery, and log export.
- [ ] Emit typed progress and error events; every mutation returns an operation ID and status so a closed UI can reconnect.
- [ ] Cache catalog metadata for offline viewing; installation from a previously verified downloaded ZIP remains possible offline.
- [ ] Store authentication tokens and local state using platform-appropriate secure storage; document re-authentication behavior.

**Verification:** `go test ./internal/client/...`; Windows smoke journey against disposable MAS fixture; Android device journey after M0.

### Task 4.2: Frontend agent contract and acceptance

**Files:** update `api/openapi.yaml`; create `docs/frontend-contract.md`; frontend agent owns `web/` and client view files under `cmd/client/frontend/`.

**Required functions:** public catalog/search/detail/version; author draft/upload/report/submission history; reviewer queue/report/decision/audit; admin roles; client directory/permission status, catalog/download/plan preview, installed/unmanaged list, priority/effective-file view, update/uninstall/recovery/history.

- [ ] Freeze route names, DTOs, operation states, error codes, and pagination in OpenAPI and `docs/frontend-contract.md` before parallel UI implementation begins.
- [ ] Provide fixture API responses for empty, loading, error, scan-warning, permission-lost, external-change, and rollback states.
- [ ] Have the frontend agent implement the required functions; review against the main journeys, without constraining layout or styling here.

**Verification:** OpenAPI validation; browser integration tests for author/reviewer flows; Windows and Android client journeys on disposable MAS installations.

## Phase 5 — Security, operations, and release

### Task 5.1: End-to-end compatibility and failure matrix

**Files:** create `tests/e2e/`, `docs/compatibility-matrix.md`, `docs/release-checklist.md`.

- [ ] Exercise MAICA-style complex package, simple script package, and sprite pack on disposable MAS copies.
- [ ] Test upload → approval → client install → priority reorder → update → uninstall → recovery.
- [ ] Fault-inject network loss, disk full, grant revocation, game running, process termination, and manual file modification.
- [ ] Record supported Windows/Android and MAS versions, known package patterns, and remaining unsafe/unmanaged cases.

**Verification:** CI `go test ./...` and API integration suite; manually signed Android device report and Windows smoke report. Do not declare the first release complete without both platform reports and M0.

### Task 5.2: Deployment and maintenance

**Files:** update `deploy/compose.yaml`; create `deploy/.env.example`, `docs/operations.md`, release workflows under `.github/workflows/`.

- [ ] Provide self-hosted Compose configuration for API, PostgreSQL, MinIO, migrations, TLS reverse proxy, and backup/restore instructions.
- [ ] Add service health checks, structured audit/error logs, object-store integrity checks, and database migration rollback instructions.
- [ ] Build Windows installer and Android APK from pinned Wails toolchain; record provenance and SHA-256 for release artifacts.
- [ ] Rehearse a fresh deployment, upload/publish/download, database restore, and object-store restore.

**Verification:** Deployment rehearsal on a clean disposable host; download hash matches published descriptor; restore rehearsal can serve the same published version IDs.

## Risks, rollback, and decisions still needed during execution

- **Android Wails/SAF:** M0 may reveal missing native API support. The only approved immediate response is to pause the joint first release and present measured evidence plus a revised design option to the user.
- **Legacy packages:** root heuristics cannot safely infer every arbitrary ZIP. Unsupported paths produce a report; they are not copied or deleted. New supported shapes require a fixture and mapping rule.
- **Unmanaged existing mods:** scan can show them but cannot safely erase them. Adoption requires an explicit backup-and-hash process.
- **MAS in-game installer coexistence:** if MAS or another tool changes files later, hash drift blocks automatic modifications; the user may repair/rebaseline after reviewing differences.
- **Priority and sprite semantics:** path priority does not resolve duplicate `giftname` or MAS registration names. These remain hard blockers.
- **Storage/identity:** GitHub is an integration, not the catalog database. A GitHub outage must not make already published ZIPs or Flarum login unavailable.

## Completion definition

The first release is releasable only when M0–M5 gates pass, both Windows and Android clients complete the full feature checklist and main journey on disposable installations, published artifacts are immutable and hash-verified, and recovery evidence shows interrupted operations cannot silently destroy unrelated files. This plan grants no authority to claim completion without the recorded checks.
