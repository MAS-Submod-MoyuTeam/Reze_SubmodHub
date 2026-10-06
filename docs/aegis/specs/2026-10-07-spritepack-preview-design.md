# Spritepack Preview Module Design

Date: 2026-10-07  
Status: proposed for user review  
Scope: Web catalog/detail preview and Windows/Android client preview for MAS sprite packs

## Intent and boundary

Add a shared, read-only preview model for legacy MAS sprite-pack ZIPs. The model and server-generated preview images are produced by the existing Go package scanner and consumed by the Web UI and both Wails client shells. The preview uses the confirmed MAS game tree at `J:\MonikaModDev-zhCN\Monika After Story\game` as a compatibility baseline and uses `D:\Windows\Download\汉化组特典 日式和服(raw-v2).zip` as the fixture.

The first release previews sprite JSON metadata, server-generated composite thumbnails, gift names, package paths, and scanner warnings. It never executes scripts, changes the MAS tree, creates save files, or edits uploaded archives. The preview is available for a local sample archive and for published/uploaded archives after the same bounded scanner has inspected them.

## Observed fixture

The sample archive has a nested `game/` root and contains:

- `game/mod_assets/monika/j/wzt_project.json`
- `game/mod_assets/monika/j/wzt_project_hairpiece.json`
- related PNG assets under `game/mod_assets/monika/a`, `c`, and `thumbs`
- generated gift paths under `characters/`
- `info.txt`

The scanner must preserve archive-relative paths, normalize separators, and report missing JSON-referenced images or duplicate sprite/gift identities as warnings or blocking conflicts according to the existing package contract.

## Architecture and data flow

1. The Go scanner enumerates and validates ZIP entries using the existing traversal, size, and supported-root rules.
2. For each supported sprite JSON under the mapped MAS tree, it parses bounded metadata and resolves image references against normalized archive entries. Parsing failure becomes `unknown` metadata with a warning; it is never guessed.
3. The scanner emits a serializable `SpritePreview` collection as part of the scan report/download preview DTO. Each item carries a stable key, sprite identity, optional gift name, JSON path, source image paths, generated preview image URL or asset key, dimensions/byte sizes when known, and warnings.
4. A backend renderer composites bounded sprite assets into one or more deterministic preview images per package. It enforces pixel, byte, and item-count limits, strips unsafe metadata, stores the result with the immutable version, and records renderer failures as structured warnings. Rebuilding the same immutable version is idempotent.
5. Web `ModDetailModal` adds a preview tab/section for sprite-pack versions. It loads the DTO, shows the generated composite thumbnail(s), and opens a focused image/metadata view. Missing assets and conflicts remain visible next to the affected item.
6. The Windows and Android clients reuse the same DTO and generated image assets through the existing bindings. Their install preview shows the same images and warnings before the user confirms an operation; no client independently parses or composites ZIP images.

Suggested wire shape:

```json
{
  "sprites": [
    {
      "id": "wzt_project",
      "gift_name": "wztproject",
      "json_path": "game/mod_assets/monika/j/wzt_project.json",
      "image_paths": ["game/mod_assets/monika/c/wzt_project/body-def-0.png"],
      "preview_image_url": "/api/v1/versions/123/sprite-previews/0.webp",
      "warnings": []
    }
  ],
  "warnings": [],
  "conflicts": []
}
```

The exact Go names may follow existing package conventions, but the fields and semantics above are compatibility requirements. Binary bytes are not embedded in catalog JSON. Preview images are immutable version assets served through signed or proxied URLs; the local client may expose an approved temporary file URL or byte stream through its binding.

## UI behavior

Web:

- Sprite-pack cards and detail views expose `预览` only when preview data exists.
- The preview surface has loading, empty, missing-resource, warning, and scan-blocked states.
- Grid items show the backend-generated composite image when available, otherwise a neutral placeholder with the sprite identity.
- Selecting an item shows the source JSON path, gift name, related image paths, and warnings.
- Keyboard and pointer close actions are supported in the focused viewer; images retain stable dimensions to avoid layout shifts.

Desktop clients:

- Catalog/detail and install-plan screens use the same item ordering and warning labels as Web.
- The install confirmation remains blocked when the shared scan reports a semantic conflict or an invalid archive.
- Preview loading failure is explicit and does not silently permit an unscanned install.

## Error handling and compatibility

Existing archive errors (`invalid_archive`, `unsupported_path`, `scan_limit_exceeded`, `download_hash_mismatch`, and `semantic_conflict`) remain authoritative. New preview-specific conditions are structured warnings (`sprite_metadata_unknown`, `sprite_asset_missing`, `sprite_render_failed`, `sprite_preview_limit_exceeded`) unless they meet an existing semantic conflict rule. A package with no sprite JSON is valid and shows an empty preview state. Older API clients ignore the optional preview field; newer clients must tolerate its absence.

The MAS baseline is read-only. Any generated `.gift` paths are displayed as derived outputs and are not written during preview. The scanner must not read outside the selected archive and baseline paths needed for conflict checks.

## Testing and acceptance

- Go unit tests cover the sample archive, nested `game/` mapping, JSON parsing, gift extraction, image resolution, composite rendering, render limits, missing assets, duplicate identities, and malformed JSON.
- Web tests cover preview loading, empty state, warning display, focused item selection, and modal close behavior.
- Client binding tests verify DTO round-tripping and blocked installation on semantic conflicts.
- Manual acceptance uses the sample ZIP and confirms both Web and desktop surfaces show `wzt_project` and `wzt_project_hairpiece`, their gift names, image references, and any warnings without modifying `J:\MonikaModDev-zhCN\Monika After Story\game`.

## Non-goals

- No in-browser ZIP editor or sprite packager.
- No script execution or semantic rendering of MAS code.
- No automatic gift generation or writes to the MAS installation.
- No independent parser implementation in Web, Windows, or Android.

## Working drafts

**TaskIntentDraft:** Add a shared preview DTO and renderer surfaces for legacy MAS sprite packs across Web, Windows, and Android, using the real Japanese kimono fixture and MAS tree as read-only compatibility evidence.

**BaselineReadSetHint:** `internal/package/sprite.go`, `internal/package/zip.go`, `internal/package/submod.go`, `web/src/components/ModDetailModal.tsx`, `web/src/components/CatalogView.tsx`, desktop frontend entrypoints, and `docs/frontend-contract.md`.

**ImpactStatementDraft:** Affects package scanning/report DTOs, API/client bindings, Web detail UI, and desktop install-preview UI. Preserves existing archive validation and installation safety contracts. Does not mutate MAS files or change publication states.
