package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	core "github.com/reze/submodhub/internal/install"
)

func buildModArchive(t *testing.T, content string) string {
	t.Helper()
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	file, err := writer.Create("game/Submods/RetentionMod/header.rpy")
	if err != nil {
		t.Fatalf("zip create: %v", err)
	}
	if _, err := file.Write([]byte(content)); err != nil {
		t.Fatalf("zip write: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return base64.StdEncoding.EncodeToString(archive.Bytes())
}

// ageJournal rewrites a journal's timestamps so the retention pass treats it as
// finished long ago.
func ageJournal(t *testing.T, journalsDir, operationID string, age time.Duration) {
	t.Helper()
	path := filepath.Join(journalsDir, operationID+".json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read journal %s: %v", operationID, err)
	}
	var journal core.TxJournal
	if err := json.Unmarshal(raw, &journal); err != nil {
		t.Fatalf("decode journal %s: %v", operationID, err)
	}
	stamp := time.Now().UTC().Add(-age)
	journal.CreatedAt = stamp
	journal.UpdatedAt = stamp
	updated, err := json.MarshalIndent(journal, "", "  ")
	if err != nil {
		t.Fatalf("encode journal %s: %v", operationID, err)
	}
	if err := os.WriteFile(path, updated, 0o600); err != nil {
		t.Fatalf("write journal %s: %v", operationID, err)
	}
}

// Startup pruning drops the journals and old-version blobs of transactions
// finished more than CompletedRetention ago, and repair still restores the
// currently installed version afterwards.
func TestDesktopServicePrunesFinishedTransactionsWithoutBreakingRepair(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game"), 0o755); err != nil {
		t.Fatal(err)
	}
	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatalf("set root: %v", err)
	}

	installPreview, err := service.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op_install_v1",
		ArchiveBase64: buildModArchive(t, "version 1"),
		ModID:         "mod_retention",
		Title:         "Retention Mod",
		Version:       "1.0.0",
	})
	if err != nil {
		t.Fatalf("preview v1: %v", err)
	}
	if _, err := service.ExecutePlan(ExecutePlanRequest{PlanID: installPreview.PlanID, Confirmed: true}); err != nil {
		t.Fatalf("install v1: %v", err)
	}

	updatePreview, err := service.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op_update_v2",
		ArchiveBase64: buildModArchive(t, "version 2"),
		ModID:         "mod_retention",
		Title:         "Retention Mod",
		Version:       "2.0.0",
	})
	if err != nil {
		t.Fatalf("preview v2: %v", err)
	}
	if _, err := service.ExecutePlan(ExecutePlanRequest{PlanID: updatePreview.PlanID, Confirmed: true}); err != nil {
		t.Fatalf("update v2: %v", err)
	}

	stateDir := filepath.Join(root, ".submodhub", "state")
	journalsDir := filepath.Join(stateDir, "journals")
	ageJournal(t, journalsDir, "op_install_v1", 8*24*time.Hour)
	ageJournal(t, journalsDir, "op_update_v2", 8*24*time.Hour)

	v1Hash := sha256.Sum256([]byte("version 1"))
	v2Hash := sha256.Sum256([]byte("version 2"))
	v1Blob := filepath.Join(stateDir, "blobs", hex.EncodeToString(v1Hash[:])[:2], hex.EncodeToString(v1Hash[:]))
	v2Blob := filepath.Join(stateDir, "blobs", hex.EncodeToString(v2Hash[:])[:2], hex.EncodeToString(v2Hash[:]))
	if _, err := os.Stat(v1Blob); err != nil {
		t.Fatalf("v1 blob missing before prune: %v", err)
	}
	// The sweep only reclaims content nobody has needed for the whole retention
	// window, and in production 8 days have passed by now.
	ageFile(t, v1Blob, 8*24*time.Hour)

	restarted := NewDesktopService()
	if _, err := restarted.SetMASRoot(root); err != nil {
		t.Fatalf("restart set root: %v", err)
	}

	for _, op := range []string{"op_install_v1", "op_update_v2"} {
		if _, err := os.Stat(filepath.Join(journalsDir, op+".json")); !os.IsNotExist(err) {
			t.Fatalf("expired journal %s survived startup prune: %v", op, err)
		}
	}
	if _, err := os.Stat(v1Blob); !os.IsNotExist(err) {
		t.Fatalf("old version blob survived startup prune: %v", err)
	}
	if _, err := os.Stat(v2Blob); err != nil {
		t.Fatalf("installed version blob was pruned: %v", err)
	}

	// The current version must still be repairable after the old journals died.
	modFile := filepath.Join(root, "game", "Submods", "RetentionMod", "header.rpy")
	if err := os.WriteFile(modFile, []byte("externally edited"), 0o644); err != nil {
		t.Fatal(err)
	}
	repairPreview, err := restarted.PreviewRepair("mod_retention")
	if err != nil {
		t.Fatalf("repair preview after prune: %v", err)
	}
	if _, err := restarted.ExecutePlan(ExecutePlanRequest{PlanID: repairPreview.PlanID, Confirmed: true}); err != nil {
		t.Fatalf("repair after prune: %v", err)
	}
	content, err := os.ReadFile(modFile)
	if err != nil || string(content) != "version 2" {
		t.Fatalf("repair content=%q err=%v", content, err)
	}
}

// ageFile backdates a state file so retention treats its content as long
// unneeded.
func ageFile(t *testing.T, path string, age time.Duration) {
	t.Helper()
	stamp := time.Now().UTC().Add(-age)
	if err := os.Chtimes(path, stamp, stamp); err != nil {
		t.Fatalf("age %s: %v", path, err)
	}
}

func ageLegacyJournal(t *testing.T, stateDir, operationID string, age time.Duration) {
	t.Helper()
	path := filepath.Join(stateDir, operationID+".json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read legacy journal %s: %v", operationID, err)
	}
	var journal core.Journal
	if err := json.Unmarshal(raw, &journal); err != nil {
		t.Fatalf("decode legacy journal %s: %v", operationID, err)
	}
	journal.UpdatedAt = time.Now().UTC().Add(-age)
	updated, err := json.MarshalIndent(journal, "", "  ")
	if err != nil {
		t.Fatalf("encode legacy journal %s: %v", operationID, err)
	}
	if err := os.WriteFile(path, updated, 0o600); err != nil {
		t.Fatalf("write legacy journal %s: %v", operationID, err)
	}
}

// The single-file Apply path writes both a transaction journal and a legacy
// state-root journal. Both expire together, and repair keeps working.
func TestDesktopServicePrunesLegacyJournalFromApplyFile(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game"), 0o755); err != nil {
		t.Fatal(err)
	}
	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatalf("set root: %v", err)
	}
	if _, err := service.ApplyFile(InstallRequest{
		OperationID: "op_apply_legacy",
		Path:        "game/legacy.txt",
		Content:     "v1",
	}); err != nil {
		t.Fatalf("apply file: %v", err)
	}

	stateDir := filepath.Join(root, ".submodhub", "state")
	legacyPath := filepath.Join(stateDir, "op_apply_legacy.json")
	if _, err := os.Stat(legacyPath); err != nil {
		t.Fatalf("legacy journal missing after apply: %v", err)
	}

	ageJournal(t, filepath.Join(stateDir, "journals"), "op_apply_legacy", 8*24*time.Hour)
	ageLegacyJournal(t, stateDir, "op_apply_legacy", 8*24*time.Hour)

	restarted := NewDesktopService()
	if _, err := restarted.SetMASRoot(root); err != nil {
		t.Fatalf("restart set root: %v", err)
	}
	for _, path := range []string{
		legacyPath,
		filepath.Join(stateDir, "journals", "op_apply_legacy.json"),
	} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("expired journal %s survived startup prune: %v", path, err)
		}
	}

	target := filepath.Join(root, "game", "legacy.txt")
	if err := os.WriteFile(target, []byte("drifted"), 0o644); err != nil {
		t.Fatal(err)
	}
	repairPreview, err := restarted.PreviewRepair("op_apply_legacy")
	if err != nil {
		t.Fatalf("repair preview after legacy prune: %v", err)
	}
	if _, err := restarted.ExecutePlan(ExecutePlanRequest{PlanID: repairPreview.PlanID, Confirmed: true}); err != nil {
		t.Fatalf("repair after legacy prune: %v", err)
	}
	content, err := os.ReadFile(target)
	if err != nil || string(content) != "v1" {
		t.Fatalf("repair content=%q err=%v", content, err)
	}
}

// A preview stages the files it would install before the user confirms. The plan
// holding them lives in client memory, so nothing in the state directory mentions
// those blobs yet: a retention pass running in that window must still leave them
// alone. (An intervening commit also invalidates the plan by generation, but a
// future idle-time sweep would not, and that is the trap this guards.)
func TestDesktopServicePruneKeepsPendingPreviewTargets(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "game"), 0o755); err != nil {
		t.Fatal(err)
	}
	service := NewDesktopService()
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatalf("set root: %v", err)
	}

	// Give the instance an expired transaction, so the next pass really sweeps
	// blobs instead of finding nothing to do. Steady state looks like this: an
	// instance older than the window always has a journal expiring.
	seed, err := service.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op_seed",
		ArchiveBase64: buildModArchive(t, "seed content"),
		ModID:         "mod_seed",
		Title:         "Seed",
		Version:       "1.0.0",
	})
	if err != nil {
		t.Fatalf("preview seed: %v", err)
	}
	if _, err := service.ExecutePlan(ExecutePlanRequest{PlanID: seed.PlanID, Confirmed: true}); err != nil {
		t.Fatalf("install seed: %v", err)
	}
	stateDir := filepath.Join(root, ".submodhub", "state")
	ageJournal(t, filepath.Join(stateDir, "journals"), "op_seed", 8*24*time.Hour)

	const stagedContent = "staged but unconfirmed"
	if _, err := service.PreviewArchive(ArchiveInstallRequest{
		OperationID:   "op_preview_pending",
		ArchiveBase64: buildModArchive(t, stagedContent),
		ModID:         "mod_pending",
		Title:         "Pending",
		Version:       "1.0.0",
	}); err != nil {
		t.Fatalf("preview pending: %v", err)
	}
	stagedHash := sha256.Sum256([]byte(stagedContent))
	stagedBlob := filepath.Join(stateDir, "blobs", hex.EncodeToString(stagedHash[:])[:2], hex.EncodeToString(stagedHash[:]))

	// Another mutation runs its retention pass before the preview is confirmed.
	if _, err := service.ApplyFile(InstallRequest{
		OperationID: "op_side",
		Path:        "game/side.txt",
		Content:     "side",
	}); err != nil {
		t.Fatalf("side apply: %v", err)
	}

	if _, err := os.Stat(stagedBlob); err != nil {
		t.Fatalf("retention reclaimed a preview target that no journal mentions: %v", err)
	}
}
