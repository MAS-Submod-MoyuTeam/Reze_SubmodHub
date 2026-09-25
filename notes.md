# Notes: Monika After Story Submod Hub

## Local Sources

### MAS 本体
- Path: `J:\MonikaModDev-zhCN\Monika After Story\game`
- Existing directories: `Submods`, `mod_assets`, `python-packages`, `gui`, `saves` and other Ren'Py runtime assets.
- Existing scripts: `0_submod_extractor_ren.py` and `0_submod_uninstaller_ren.py` provide ZIP-based copy/delete flows.
- Existing Android code requests storage permissions and assumes `/storage/emulated/0/Android/data/and.kns.masmobile/files` as the Ren'Py base directory.
- `zz_submods.rpy` registers submods by name/version and checks dependencies; duplicate names raise an error.

### MAICA example
- Path: `E:\GithubKu\MAICA_Server_Submod\game`
- Contains `Submods/MAICA_ServerSubmod/{header.rpy,main.rpy,system_prompt.rpy,tl/*.rpy}` and `python-packages/*.py`.
- The example uses `store.mas_submod_utils.Submod(...)` and can depend on another submod.

## Synthesized Findings

### Product direction confirmed
- The first release is a centralized public store with author accounts/submissions, administrator review, published versions, file delivery, and a client-facing catalog API.
- Game-directory access: clients should auto-detect known MAS locations first, then fall back to user-selected directories; Android uses persisted system folder authorization where available.
- Package compatibility: first release accepts and distributes existing legacy ZIPs without requiring a manifest; installation must scan package paths and use backups/inferred ownership for conflict and uninstall handling.
- Conflict policy: resolve overlapping files by explicit submod priority; installation applies higher-priority content last, records overrides, and keeps backups for rollback.
- WebUI authoring: first release provides an upload-and-publish workbench. Authors fill metadata and upload an existing ZIP; the server scans it and sends it through review. No online code editor or visual packager in v1.
- Client framework: user requires all clients to use Wails v3; Go is the shared core, while Android-specific SAF/permission behavior must be exposed through Wails bindings or plugins. Android feasibility is an early risk gate.
- Backend direction: self-hostable monolith with Go API, PostgreSQL, and S3-compatible storage (including MinIO); integrate GitHub for login and/or repository/release import without making GitHub the sole source of truth.
- `MAS_UniSync` reference: Flarum integration posts credentials to `/api/token`, fetches `/api/users/{id}` with the returned token, maps configurable group IDs/names to local roles, and creates a local session. It is credential-backed Flarum API login rather than standard OAuth.
- Flarum authentication choice: reuse this server-side `/api/token` flow; do not require a Flarum OAuth extension in v1. GitHub OAuth remains an optional second provider using authorization code flow.
- Architecture A approved: Go monolith and shared installer core; Wails v3 on both Windows and Android; separate WebUI over same API.
- User clarified that the first official release must include both PC (Windows) and Android with the full installer feature set; one-platform delivery is only an intermediate milestone.
- Wails v3 official search result indicates Android support is experimental; a device-level SAF and file I/O proof of concept must be the first technical gate. Playwright page navigation was unavailable (transport closed), so the search result is provisional evidence.
- Installer design approved by user, with a needed implementation refinement: Android SAF does not promise atomic file replacement, so use a durable operation journal plus per-file backup and recovery rather than claiming filesystem-level atomicity.

### Confirmed compatibility boundary
- Legacy ZIP structure remains a first-class input. A future optional metadata manifest may improve safety, but cannot be required for the initial public store.

### Package shapes
- A package may contain `game/Submods/<id>/...`, loose `.rpy`/`.rpym` scripts, `game/mod_assets/...`, `game/python-packages/...`, and other supported top-level directories.
- Existing installer accepts both structured directories and loose scripts, but its behavior is heuristic and does not record per-file ownership.

### Installation risks
- Copying files into shared directories can overwrite another mod or base-game file.
- Existing uninstaller can delete shared files because it lacks a durable ownership manifest.
- ZIP path traversal, symlinks, duplicate files, and unsafe top-level paths need explicit validation.
- MAS's runtime registration/dependency model is separate from file installation and must be surfaced in metadata.

### Platform constraints
- Windows can access a selected local game directory directly.
- Android may require scoped-storage handling, SAF/document-tree integration, or cooperation with the Ren'Py app; direct access to `/Android/data` is version/device dependent.
- Wails v3 is a strong Windows/WebView choice, but Android packaging/support must be verified before committing to one client architecture.
