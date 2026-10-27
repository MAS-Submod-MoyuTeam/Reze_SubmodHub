package install

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// writeGateJournal 把一个指定阶段的 journal 落到实例状态目录，模拟真实事务
// 在磁盘上留下的痕迹（prepared 之后每个阶段都会写入 journal）。
func writeGateJournal(t *testing.T, inst *Installer, id, phase string) {
	t.Helper()
	dir := filepath.Join(inst.state, "journals")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	journal := &TxJournal{
		OperationID: id,
		PlanID:      id,
		Phase:       phase,
		Kind:        "install",
		BeforeFiles: map[string]FileBeforeState{},
		AfterFiles:  map[string]FileAfterState{},
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	if err := saveJournalFile(filepath.Join(dir, id+".json"), journal); err != nil {
		t.Fatal(err)
	}
}

func TestHasInProgressTransactionFollowsJournalPhase(t *testing.T) {
	cases := []struct {
		phase      string
		inProgress bool
	}{
		{TxPhasePlanned, true},
		{TxPhasePrepared, true},
		{TxPhaseApplying, true},
		{TxPhaseCommitting, true},
		// Terminal phases: writing has stopped, so starting the game is allowed.
		{TxPhaseCommitted, false},
		{TxPhaseRolledBack, false},
		{TxPhaseNeedsManualRecovery, false},
	}

	for _, tc := range cases {
		t.Run(tc.phase, func(t *testing.T) {
			instance := New(t.TempDir(), filepath.Join(t.TempDir(), "state"))
			writeGateJournal(t, instance, "op_1", tc.phase)

			got, err := instance.HasInProgressTransaction()
			if err != nil {
				t.Fatalf("HasInProgressTransaction: %v", err)
			}
			if got != tc.inProgress {
				t.Fatalf("phase %q: inProgress=%v, want %v", tc.phase, got, tc.inProgress)
			}
		})
	}
}

func TestHasInProgressTransactionOnCleanInstance(t *testing.T) {
	instance := New(t.TempDir(), filepath.Join(t.TempDir(), "state"))

	got, err := instance.HasInProgressTransaction()
	if err != nil {
		t.Fatalf("HasInProgressTransaction: %v", err)
	}
	if got {
		t.Fatal("an instance without journals must not report an in-progress transaction")
	}
}

func TestHasInProgressTransactionIgnoresUnreadableJournal(t *testing.T) {
	// A corrupt journal is surfaced as needs_manual_recovery (terminal) rather than
	// as an endless "in progress": the user needs a way to launch the game again
	// after recovering, and the guard must not depend on journal parsability.
	instance := New(t.TempDir(), filepath.Join(t.TempDir(), "state"))
	dir := filepath.Join(instance.state, "journals")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "op_corrupt.json"), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := instance.HasInProgressTransaction()
	if err != nil {
		t.Fatalf("HasInProgressTransaction: %v", err)
	}
	if got {
		t.Fatal("a corrupt journal must not be reported as an in-progress transaction")
	}
}

func TestHasInProgressTransactionNilInstaller(t *testing.T) {
	var instance *Installer
	got, err := instance.HasInProgressTransaction()
	if err != nil || got {
		t.Fatalf("nil installer: got=%v err=%v", got, err)
	}
}
