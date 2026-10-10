# Preview and transaction safety repair

Preserve existing uncommitted work and backend contracts.
1. Reproduce replacement failure, state-path casing and rollback drift with tests.
2. Rotate destination safely and restore it on replacement failure.
3. Compare Windows state paths case-insensitively.
4. Preflight all rollback paths against before/after hashes, preserving evidence on drift.
5. Connect install/update/uninstall to real previews and confirmed ExecutePlan.
6. Run installer/service tests and frontend typecheck/build; report live UI limitations.
