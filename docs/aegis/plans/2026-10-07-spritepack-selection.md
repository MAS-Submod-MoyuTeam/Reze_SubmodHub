# Spritepack Selection Implementation Plan

> **For agentic workers:** Inline execution in the shared workspace. Use test-first slices and review each verification result before proceeding.

**Goal:** Publish one current spritepack archive per mod and let readers inspect JSON-defined items and download one or more complete sets.

**Architecture:** Keep the existing reviewed Version internally as the upload/review transaction. A spritepack-specific scanner partitions an archive by its enclosing top-level package directory, reads every MAS sprite JSON, and records sets in the scan report. Public endpoints expose the latest published set manifest, bounded thumbnail bytes, and a dynamically assembled ZIP for a validated set selection. On approval, prior published spritepack versions and archive files retire after metadata persistence.

**Tech Stack:** Go net/http and archive/zip, React/TypeScript/Vite, existing catalog and submission API clients.

**Baseline / Authority Refs:** `docs/aegis/specs/2026-09-25-submodhub-design.md`, the two user-provided ZIP fixtures, current `internal/package/zip.go`, `internal/httpapi/server.go`, `web/src/components/AuthorWorkbench.tsx`, `web/src/components/ModDetailModal.tsx`.

**Compatibility Boundary:** Submod multi-version publication, immutable published submod ZIPs, author/reviewer permissions, and installer ZIP layout remain unchanged. Spritepack older published ZIPs remain available until the replacement is approved and stored. Review audit records remain.

**Verification:** `go test ./...`, `npm run lint`, `npm run build`, Node UI API tests, real fixture parser tests, and browser checks on the deployed test site.

---

### Task 1: JSON-defined set parser and selection ZIP

**Files:** `internal/package/spritepack.go`, `internal/package/spritepack_test.go`, `internal/package/zip.go`.

- [x] Add failing tests for one root set with two JSON items and a multi-directory archive with separate sets, display-name fallback, thumbnail detection, unsafe paths, and selected-set ZIP contents.
- [x] Run targeted Go test and confirm missing behavior fails.
- [x] Implement bounded partition/scan logic and selected-set ZIP construction; include `gifts/` as `characters/` only in this spritepack-specific path.
- [x] Run tests and scan both real sample ZIPs.

### Task 2: Review, retention, and public endpoints

**Files:** `internal/httpapi/spritepacks.go`, `internal/httpapi/server.go`, `internal/httpapi/submissions.go`, HTTP tests.

- [x] Add failing HTTP tests for upload, list, preview, selected ZIP download, rejection of invalid selections, and approved replacement deleting the old published record/archive after persistence.
- [x] Run targeted Go tests and confirm failures.
- [x] Route spritepack uploads through the parser; add public manifest/image/download endpoints; retire prior published spritepack version and scan report when approving replacement.
- [x] Run Go regression tests.

### Task 3: Web publishing and selection UI

**Files:** `ui/catalog-api.ts`, `ui/catalog-api.test.ts`, `web/src/components/AuthorWorkbench.tsx`, `web/src/components/ModDetailModal.tsx`, `web/src/context/AppContext.tsx`.

- [x] Add failing API-client tests for set manifest and verified selected ZIP bytes.
- [x] Run targeted Node tests and confirm failures.
- [x] Give spritepacks a single current-package upload/review surface and hide version-number/history controls; show all JSON names and available thumbnails per set in detail, with set checkboxes and one/all download actions.
- [x] Run Node tests, TypeScript check, and production build.

### Task 4: Release and verification

- [x] Run full Go/Node test suites and `git diff --check`.
- [x] Build Linux API and Web assets; deploy to the existing test site.
- [x] Use Playwright to verify publish UI, a known published spritepack detail, set selection, thumbnail rendering, and downloaded ZIP structure.
- [x] Report any fixture/legacy-data exceptions explicitly.

**Verification record (2026-10-07):** `go test ./...`; `npx --no-install tsx --tsconfig web/tsconfig.json --test ui/*.test.ts web/src/context/*.test.ts web/src/components/*.test.ts web/src/components/*.test.tsx` (39 passed); Web lint/build and desktop build passed; `git diff --check` passed. External fixture scans produced 1 set/2 items and 56 sets/158 items. Browser E2E approved a replacement, selected two sets, and completed all-set download with SHA-256 success. The former published ZIP returned 404 while its review snapshot remained available. Temporary transfer ZIPs were removed locally and from the test server.

**Bounded exception:** Selection downloads are capped at 64 MiB by the API; archives exceeding that response size need streaming or a larger limit. Unrecognized files outside supported MAS sprite asset paths are not included in selected-set ZIPs.

**Repair track:** Replace the assumption that every ZIP has one global root for spritepack uploads. The ordinary `Scan` function remains the submod owner.

**Retirement track:** The prior published spritepack Version and ZIP are removed only after successful approval persistence. The new current Version remains immutable until the next approved replacement; audit submissions retain snapshots.
