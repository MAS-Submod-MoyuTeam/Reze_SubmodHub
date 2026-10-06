# Dependency Catalog Links Implementation Plan

Goal: Link version-level MAS dependency names to catalog mods only when the published registration name uniquely identifies one mod; allow author correction before review.

Baseline: `docs/aegis/specs/2026-09-25-submodhub-design.md`, `docs/frontend-contract.md`, `internal/package/zip.go`.

Compatibility: Keep the original MAS name and version range; existing unlinked records remain readable. Do not guess by display title. Published version metadata stays immutable.

1. Add server tests for unique, missing, and ambiguous registration-name matches and explicit author selection. Run targeted tests red, then implement `linked_mod_id` resolution in the catalog owner.
2. Extend draft/uploaded relation edits and validation. Test that an uploaded ZIP remains unchanged and submitted versions cannot be edited.
3. Add author mapping controls and linked catalog detail navigation. Type-check, build, and inspect the web journey. Incompatibility relations are out of scope and removed.
4. Run `go test ./...` and web lint/build, deploy the API and static site to the existing Docker test stack, then verify health and visible linked relationships.

Repair: Stop treating a raw MAS name as proof of a catalog ID. Retain the raw value for legacy installs and unresolved relations; use `linked_mod_id` only for confirmed catalog identity. Legacy `approved` publishing compatibility is unaffected.
