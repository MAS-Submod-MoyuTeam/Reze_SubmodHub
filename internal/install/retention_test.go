package install

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeJournalFile(t *testing.T, state string, journal TxJournal) string {
	t.Helper()
	path := filepath.Join(state, "journals", journal.OperationID+".json")
	if err := saveJournalFile(path, &journal); err != nil {
		t.Fatalf("save journal %s: %v", journal.OperationID, err)
	}
	return path
}

func writeManifestFixture(t *testing.T, state string, m *Manifest) {
	t.Helper()
	if err := m.Save(filepath.Join(state, "manifest.json")); err != nil {
		t.Fatalf("save manifest: %v", err)
	}
}

func blobExists(t *testing.T, installer *Installer, hash string) bool {
	t.Helper()
	_, err := os.Stat(installer.GetBlobs().Path(hash))
	return err == nil
}

func mustPut(t *testing.T, installer *Installer, content string) string {
	t.Helper()
	hash, err := installer.GetBlobs().Put([]byte(content))
	if err != nil {
		t.Fatalf("put blob %q: %v", content, err)
	}
	return hash
}

// ageBlob backdates a blob's timestamp, which is how retention decides that
// nobody has needed its content for the whole window.
func ageBlob(t *testing.T, installer *Installer, hash string, age time.Duration) {
	t.Helper()
	path := installer.GetBlobs().Path(hash)
	stamp := time.Now().Add(-age)
	if err := os.Chtimes(path, stamp, stamp); err != nil {
		t.Fatalf("age blob %s: %v", hash, err)
	}
}

// A finished transaction older than the retention window disappears together
// with the blobs only it referenced. Everything the manifest still needs — the
// original snapshot and every layer, including a shadowed one — survives, so
// repair/uninstall keep working.
func TestPruneCompletedRemovesExpiredJournalAndOrphanBlobs(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	installer := New(root, state)
	now := time.Now().UTC()

	originalHash := mustPut(t, installer, "original game file")
	activeHash := mustPut(t, installer, "v2 content")
	shadowedHash := mustPut(t, installer, "v1 content")
	orphanHash := mustPut(t, installer, "v0 content only an old journal knows")
	recentHash := mustPut(t, installer, "recent content")
	// The orphan is only collectable once its content has been unneeded for the
	// whole retention window, which in production is what the 7-day wait means.
	ageBlob(t, installer, orphanHash, 8*24*time.Hour)

	manifest := NewManifest()
	key := manifestCanonicalKey("game/demo.rpy")
	if err := manifest.RecordLayer("game/demo.rpy", key, OriginalRecord{Exists: true, Hash: originalHash, Mode: 0o644}, LayerRecord{
		InstallationID: "mod_b", ModID: "mod_b", Order: 2, Hash: activeHash, Mode: 0o644,
	}); err != nil {
		t.Fatal(err)
	}
	if err := manifest.RecordLayer("game/demo.rpy", key, OriginalRecord{}, LayerRecord{
		InstallationID: "mod_a", ModID: "mod_a", Order: 1, Hash: shadowedHash, Mode: 0o644,
	}); err != nil {
		t.Fatal(err)
	}
	writeManifestFixture(t, state, manifest)

	oldJournalPath := writeJournalFile(t, state, TxJournal{
		OperationID: "op_old",
		Phase:       TxPhaseCommitted,
		UpdatedAt:   now.Add(-8 * 24 * time.Hour),
		BeforeFiles: map[string]FileBeforeState{
			key: {DisplayPath: "game/demo.rpy", Existed: true, Hash: orphanHash},
		},
		AfterFiles: map[string]FileAfterState{
			key: {DisplayPath: "game/demo.rpy", Exists: true, Hash: activeHash},
		},
	})
	recentJournalPath := writeJournalFile(t, state, TxJournal{
		OperationID: "op_recent",
		Phase:       TxPhaseCommitted,
		UpdatedAt:   now.Add(-1 * time.Hour),
		BeforeFiles: map[string]FileBeforeState{
			key: {DisplayPath: "game/demo.rpy", Existed: true, Hash: recentHash},
		},
	})

	result, err := installer.PruneCompleted(now)
	if err != nil {
		t.Fatalf("prune: %v", err)
	}

	if result.Skipped {
		t.Fatal("prune skipped unexpectedly")
	}
	if result.DeletedJournals != 1 || result.RetainedJournals != 1 {
		t.Fatalf("journals deleted=%d retained=%d", result.DeletedJournals, result.RetainedJournals)
	}
	if _, statErr := os.Stat(oldJournalPath); !os.IsNotExist(statErr) {
		t.Fatalf("expired journal still present: %v", statErr)
	}
	if _, statErr := os.Stat(recentJournalPath); statErr != nil {
		t.Fatalf("recent journal missing: %v", statErr)
	}

	if blobExists(t, installer, orphanHash) {
		t.Fatal("blob referenced only by the expired journal was retained")
	}
	for name, hash := range map[string]string{
		"original": originalHash,
		"active":   activeHash,
		"shadowed": shadowedHash,
		"recent":   recentHash,
	} {
		if !blobExists(t, installer, hash) {
			t.Fatalf("%s blob was deleted", name)
		}
	}
	if result.DeletedBlobs != 1 {
		t.Fatalf("deleted blobs=%d, want 1", result.DeletedBlobs)
	}
	if result.FreedBytes != int64(len("v0 content only an old journal knows")) {
		t.Fatalf("freed=%d", result.FreedBytes)
	}
}

// Recovery material never expires: an unfinished or stuck transaction keeps its
// journal and its before-images regardless of age.
func TestPruneCompletedKeepsNonTerminalJournals(t *testing.T) {
	for _, phase := range []string{
		TxPhasePlanned,
		TxPhasePrepared,
		TxPhaseApplying,
		TxPhaseCommitting,
		TxPhaseNeedsManualRecovery,
	} {
		t.Run(phase, func(t *testing.T) {
			root := t.TempDir()
			state := filepath.Join(t.TempDir(), "state")
			installer := New(root, state)
			now := time.Now().UTC()
			writeManifestFixture(t, state, NewManifest())

			beforeHash := mustPut(t, installer, "recovery material")
			path := writeJournalFile(t, state, TxJournal{
				OperationID: "op_" + phase,
				Phase:       phase,
				UpdatedAt:   now.Add(-365 * 24 * time.Hour),
				BeforeFiles: map[string]FileBeforeState{
					"game/demo.rpy": {DisplayPath: "game/demo.rpy", Existed: true, Hash: beforeHash},
				},
			})

			result, err := installer.PruneCompleted(now)
			if err != nil {
				t.Fatalf("prune: %v", err)
			}
			if result.DeletedJournals != 0 || result.DeletedBlobs != 0 {
				t.Fatalf("pruned %s: %+v", phase, result)
			}
			if _, statErr := os.Stat(path); statErr != nil {
				t.Fatalf("journal removed: %v", statErr)
			}
			if !blobExists(t, installer, beforeHash) {
				t.Fatal("recovery blob removed")
			}
		})
	}
}

// Evidence this pass cannot classify is preserved: corrupt JSON, missing
// timestamps, exactly-at-cutoff journals and non-terminal legacy state.
func TestPruneCompletedPreservesUnclassifiableMaterial(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	installer := New(root, state)
	now := time.Now().UTC()
	writeManifestFixture(t, state, NewManifest())

	cutoffJournal := writeJournalFile(t, state, TxJournal{
		OperationID: "op_at_cutoff",
		Phase:       TxPhaseCommitted,
		UpdatedAt:   now.Add(-CompletedRetention),
	})
	noTimestampPath := writeJournalFile(t, state, TxJournal{
		OperationID: "op_no_time",
		Phase:       TxPhaseRolledBack,
	})

	if err := os.MkdirAll(filepath.Join(state, "journals"), 0o755); err != nil {
		t.Fatal(err)
	}
	corruptPath := filepath.Join(state, "journals", "op_corrupt.json")
	if err := os.WriteFile(corruptPath, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	legacyUnfinished := Journal{
		Operation: Operation{ID: "op_legacy_pending"},
		State:     "prepared",
		UpdatedAt: now.Add(-365 * 24 * time.Hour),
	}
	legacyPath := filepath.Join(state, "op_legacy_pending.json")
	raw, _ := json.MarshalIndent(legacyUnfinished, "", "  ")
	if err := os.WriteFile(legacyPath, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	legacyCorruptPath := filepath.Join(state, "op_legacy_corrupt.json")
	if err := os.WriteFile(legacyCorruptPath, []byte("[1,2,3]"), 0o600); err != nil {
		t.Fatal(err)
	}

	result, err := installer.PruneCompleted(now)
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if result.DeletedJournals != 0 || result.DeletedLegacyJournals != 0 {
		t.Fatalf("deleted %d tx / %d legacy journals, want 0: %+v", result.DeletedJournals, result.DeletedLegacyJournals, result)
	}
	for _, path := range []string{cutoffJournal, noTimestampPath, corruptPath, legacyPath, legacyCorruptPath} {
		if _, statErr := os.Stat(path); statErr != nil {
			t.Fatalf("%s removed: %v", path, statErr)
		}
	}

	// Just past the cutoff the same journal is eligible.
	if _, err := installer.PruneCompleted(now.Add(time.Second)); err != nil {
		t.Fatalf("prune: %v", err)
	}
	if _, statErr := os.Stat(cutoffJournal); !os.IsNotExist(statErr) {
		t.Fatalf("journal past cutoff still present: %v", statErr)
	}
	if _, statErr := os.Stat(noTimestampPath); statErr != nil {
		t.Fatalf("timestamp-less journal removed: %v", statErr)
	}
	if _, statErr := os.Stat(legacyPath); statErr != nil {
		t.Fatalf("non-terminal legacy journal removed: %v", statErr)
	}
}

// Legacy journals follow the same 7-day rule, and their per-operation backup
// directory goes with them.
func TestPruneCompletedRemovesExpiredLegacyJournalsAndBackups(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	installer := New(root, state)
	now := time.Now().UTC()
	writeManifestFixture(t, state, NewManifest())

	writeLegacyBackup := func(operationID, rel, content string) {
		path := filepath.Join(state, "backups", operationID, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	writeLegacyBackup("op_legacy_committed", "game/demo.rpy", "old snapshot")
	writeLegacyBackup("op_legacy_rolledback", "game/other.rpy", "rolled back snapshot")
	writeLegacyBackup("op_legacy_young", "game/young.rpy", "young snapshot")

	old := now.Add(-8 * 24 * time.Hour)
	committedPath := filepath.Join(state, "op_legacy_committed.json")
	rolledBackPath := filepath.Join(state, "op_legacy_rolledback.json")
	youngPath := filepath.Join(state, "op_legacy_young.json")
	for path, journal := range map[string]Journal{
		committedPath:  {Operation: Operation{ID: "op_legacy_committed"}, State: "committed", UpdatedAt: old},
		rolledBackPath: {Operation: Operation{ID: "op_legacy_rolledback"}, State: TxPhaseRolledBack, UpdatedAt: old},
		youngPath:      {Operation: Operation{ID: "op_legacy_young"}, State: "committed", UpdatedAt: now.Add(-time.Hour)},
	} {
		raw, err := json.MarshalIndent(journal, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	result, err := installer.PruneCompleted(now)
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if result.DeletedLegacyJournals != 2 {
		t.Fatalf("deleted legacy journals=%d, want 2: %+v", result.DeletedLegacyJournals, result)
	}
	if result.DeletedLegacyBackups != 2 {
		t.Fatalf("deleted legacy backup files=%d, want 2: %+v", result.DeletedLegacyBackups, result)
	}
	if result.FreedBytes < int64(len("old snapshot")+len("rolled back snapshot")) {
		t.Fatalf("freed=%d does not cover the backup files", result.FreedBytes)
	}
	for _, gone := range []string{
		committedPath,
		rolledBackPath,
		filepath.Join(state, "backups", "op_legacy_committed"),
		filepath.Join(state, "backups", "op_legacy_rolledback"),
	} {
		if _, statErr := os.Stat(gone); !os.IsNotExist(statErr) {
			t.Fatalf("%s still present: %v", gone, statErr)
		}
	}
	for _, kept := range []string{
		youngPath,
		filepath.Join(state, "backups", "op_legacy_young", "game", "young.rpy"),
	} {
		if _, statErr := os.Stat(kept); statErr != nil {
			t.Fatalf("%s removed: %v", kept, statErr)
		}
	}
}

// A legacy journal inside its retention window still protects the blobs its
// backup map points at, even when another expired journal triggers the sweep.
func TestPruneCompletedKeepsBlobsReferencedByRetainedLegacyJournal(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	installer := New(root, state)
	now := time.Now().UTC()
	writeManifestFixture(t, state, NewManifest())

	protectedHash := mustPut(t, installer, "legacy protected content")
	orphanHash := mustPut(t, installer, "orphan content")
	ageBlob(t, installer, orphanHash, 8*24*time.Hour)

	legacy := Journal{
		Operation: Operation{ID: "op_legacy_young"},
		State:     "committed",
		UpdatedAt: now.Add(-time.Hour),
		Backups: map[string]string{
			"game/demo.rpy": installer.GetBlobs().Path(protectedHash),
		},
	}
	raw, err := json.MarshalIndent(legacy, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(state, "op_legacy_young.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}

	expiredPath := writeJournalFile(t, state, TxJournal{
		OperationID: "op_expired",
		Phase:       TxPhaseCommitted,
		UpdatedAt:   now.Add(-30 * 24 * time.Hour),
		BeforeFiles: map[string]FileBeforeState{
			"game/gone.rpy": {DisplayPath: "game/gone.rpy", Existed: true, Hash: orphanHash},
		},
	})

	result, err := installer.PruneCompleted(now)
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if result.DeletedJournals != 1 {
		t.Fatalf("deleted journals=%d, want 1: %+v", result.DeletedJournals, result)
	}
	if _, statErr := os.Stat(expiredPath); !os.IsNotExist(statErr) {
		t.Fatalf("expired journal survived: %v", statErr)
	}
	if !blobExists(t, installer, protectedHash) {
		t.Fatal("blob referenced by a retained legacy journal was pruned")
	}
	if blobExists(t, installer, orphanHash) {
		t.Fatal("orphan blob was retained")
	}
}

// A broken manifest makes every blob look orphaned, so the pass must delete
// nothing at all.
func TestPruneCompletedRefusesWithoutReadableManifest(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	installer := New(root, state)
	now := time.Now().UTC()

	hash := mustPut(t, installer, "managed content")
	journalPath := writeJournalFile(t, state, TxJournal{
		OperationID: "op_old",
		Phase:       TxPhaseCommitted,
		UpdatedAt:   now.Add(-30 * 24 * time.Hour),
		BeforeFiles: map[string]FileBeforeState{
			"game/demo.rpy": {DisplayPath: "game/demo.rpy", Existed: true, Hash: hash},
		},
	})
	if err := os.WriteFile(filepath.Join(state, "manifest.json"), []byte("{broken"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := installer.PruneCompleted(now); !IsCode(err, "manifest_corrupt") {
		t.Fatalf("err=%v", err)
	}
	if _, statErr := os.Stat(journalPath); statErr != nil {
		t.Fatalf("journal removed despite corrupt manifest: %v", statErr)
	}
	if !blobExists(t, installer, hash) {
		t.Fatal("blob removed despite corrupt manifest")
	}
}

// The pass must not fight a running transaction.
func TestPruneCompletedSkipsWhileInstanceLocked(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	installer := New(root, state)
	now := time.Now().UTC()
	writeManifestFixture(t, state, NewManifest())
	path := writeJournalFile(t, state, TxJournal{
		OperationID: "op_old",
		Phase:       TxPhaseCommitted,
		UpdatedAt:   now.Add(-30 * 24 * time.Hour),
	})

	lock, err := installer.acquireLock()
	if err != nil {
		t.Fatalf("lock: %v", err)
	}
	result, err := installer.PruneCompleted(now)
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if !result.Skipped || result.DeletedJournals != 0 {
		t.Fatalf("expected skip, got %+v", result)
	}
	lock.Release()

	if _, statErr := os.Stat(path); statErr != nil {
		t.Fatalf("journal removed while locked: %v", statErr)
	}
	if _, err := installer.PruneCompleted(now); err != nil {
		t.Fatalf("prune after release: %v", err)
	}
	if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
		t.Fatalf("journal survived after release: %v", statErr)
	}
}

// End to end: pruning a committed transaction must not weaken repair.
func TestPruningCommittedJournalKeepsRepairWorking(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	installer := New(root, state)

	if err := installer.Apply(Operation{
		ID:      "op_install",
		Changes: []Change{{Path: "game/demo.rpy", Content: []byte("managed v1")}},
	}); err != nil {
		t.Fatalf("apply: %v", err)
	}

	result, err := installer.PruneCompleted(time.Now().UTC().Add(8 * 24 * time.Hour))
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if result.DeletedJournals == 0 {
		t.Fatalf("expected the committed journal to expire: %+v", result)
	}
	if _, statErr := os.Stat(filepath.Join(state, "journals", "op_install.json")); !os.IsNotExist(statErr) {
		t.Fatalf("committed journal survived: %v", statErr)
	}

	target := filepath.Join(root, "game/demo.rpy")
	if err := os.WriteFile(target, []byte("drifted"), 0o644); err != nil {
		t.Fatal(err)
	}

	plan, err := installer.PreviewRepair("op_install", "repair_after_prune")
	if err != nil {
		t.Fatalf("repair preview after prune: %v", err)
	}
	if len(plan.Actions) != 1 || plan.Actions[0].Action != ActionWrite {
		t.Fatalf("plan=%+v", plan)
	}
	tx, err := installer.NewTransaction(plan)
	if err != nil {
		t.Fatalf("transaction: %v", err)
	}
	if err := tx.Execute(); err != nil {
		t.Fatalf("repair execute: %v", err)
	}
	content, readErr := os.ReadFile(target)
	if readErr != nil || string(content) != "managed v1" {
		t.Fatalf("content=%q err=%v", content, readErr)
	}
}

// A preview stages install targets in the blob store before any journal exists;
// the plan holds them in memory only. The sweep must keep that content while it
// is fresh, and a re-staged copy must refresh it too, otherwise reinstalling an
// old version would race its own preview.
func TestPruneCompletedKeepsBlobStagedWithinRetentionWindow(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	installer := New(root, state)
	now := time.Now().UTC()
	writeManifestFixture(t, state, NewManifest())

	const staged = "preview target, not confirmed yet"
	stagedHash := mustPut(t, installer, staged)
	staleHash := mustPut(t, installer, "left behind by an earlier pass")
	ageBlob(t, installer, staleHash, 8*24*time.Hour)

	result, err := installer.PruneCompleted(now)
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if !blobExists(t, installer, stagedHash) {
		t.Fatal("staged preview target was pruned before its plan could commit")
	}
	if blobExists(t, installer, staleHash) {
		t.Fatal("stale orphan survived the sweep")
	}
	if result.DeletedBlobs != 1 {
		t.Fatalf("deleted blobs=%d, want 1: %+v", result.DeletedBlobs, result)
	}

	// Same bytes, put again: the timestamp has to move forward even though the
	// store did not rewrite the file.
	ageBlob(t, installer, stagedHash, 30*24*time.Hour)
	if _, err := installer.GetBlobs().Put([]byte(staged)); err != nil {
		t.Fatalf("re-stage: %v", err)
	}
	if _, err := installer.PruneCompleted(now); err != nil {
		t.Fatalf("prune: %v", err)
	}
	if !blobExists(t, installer, stagedHash) {
		t.Fatal("re-staged blob was pruned instead of being refreshed")
	}
}

// A pass that dies after deleting journals but before sweeping blobs leaves
// orphans no journal mentions any more, so the sweep cannot depend on something
// expiring during the same call.
func TestPruneCompletedSweepsStaleOrphanWithoutExpiredJournal(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	installer := New(root, state)
	now := time.Now().UTC()
	writeManifestFixture(t, state, NewManifest())

	staleHash := mustPut(t, installer, "orphaned by an interrupted pass")
	ageBlob(t, installer, staleHash, 8*24*time.Hour)

	result, err := installer.PruneCompleted(now)
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if result.DeletedJournals != 0 || result.DeletedLegacyJournals != 0 {
		t.Fatalf("expected no journal to expire: %+v", result)
	}
	if result.DeletedBlobs != 1 || blobExists(t, installer, staleHash) {
		t.Fatalf("stale orphan survived a pass with nothing to expire: %+v", result)
	}
}

// Hashes are matched against blob file names, which are lower case. An
// upper-case hash from a hand-edited manifest must not orphan a live blob.
func TestPruneCompletedMatchesManifestHashesCaseInsensitively(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	installer := New(root, state)
	now := time.Now().UTC()

	hash := mustPut(t, installer, "installed layer content")
	ageBlob(t, installer, hash, 8*24*time.Hour)

	manifest := NewManifest()
	if err := manifest.RecordLayer("game/demo.rpy", manifestCanonicalKey("game/demo.rpy"), OriginalRecord{}, LayerRecord{
		InstallationID: "mod_case", ModID: "mod_case", Hash: strings.ToUpper(hash), Mode: 0o644,
	}); err != nil {
		t.Fatal(err)
	}
	writeManifestFixture(t, state, manifest)

	result, err := installer.PruneCompleted(now)
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if !blobExists(t, installer, hash) {
		t.Fatalf("upper-cased manifest hash orphaned a live blob: %+v", result)
	}
}

// The snapshot directory belongs to the journal file name. A tampered journal
// that claims another operation id must not redirect the delete at that
// operation's backups.
func TestPruneCompletedUsesJournalFileNameForLegacyBackups(t *testing.T) {
	root := t.TempDir()
	state := filepath.Join(t.TempDir(), "state")
	installer := New(root, state)
	now := time.Now().UTC()
	writeManifestFixture(t, state, NewManifest())

	writeBackup := func(operationID, rel string) {
		path := filepath.Join(state, "backups", operationID, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("snapshot"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	writeBackup("op_file", "game/a.rpy")
	writeBackup("op_other", "game/b.rpy")

	journal := Journal{
		Operation: Operation{ID: "op_other"},
		State:     "committed",
		UpdatedAt: now.Add(-8 * 24 * time.Hour),
	}
	raw, err := json.MarshalIndent(journal, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(state, "op_file.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}

	result, err := installer.PruneCompleted(now)
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if result.DeletedLegacyJournals != 1 || result.DeletedLegacyBackups != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if _, statErr := os.Stat(filepath.Join(state, "backups", "op_file")); !os.IsNotExist(statErr) {
		t.Fatalf("own backup directory survived: %v", statErr)
	}
	if _, statErr := os.Stat(filepath.Join(state, "backups", "op_other", "game", "b.rpy")); statErr != nil {
		t.Fatalf("unrelated operation backups were removed: %v", statErr)
	}
}
