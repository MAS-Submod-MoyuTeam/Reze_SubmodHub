package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	core "github.com/reze/submodhub/internal/install"
)

func writeTransactionJournal(t *testing.T, root, phase string) {
	t.Helper()
	dir := filepath.Join(root, ".submodhub", "state", "journals")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	journal := core.TxJournal{
		OperationID: "op_guard",
		PlanID:      "op_guard",
		Phase:       phase,
		Kind:        "install",
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
	data, err := json.MarshalIndent(journal, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "op_guard.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestLaunchMASInstanceRefusesWhileTransactionInProgress(t *testing.T) {
	root := makeMASFixture(t)
	if err := os.WriteFile(filepath.Join(root, "DDLC.exe"), []byte("not a real pe"), 0o600); err != nil {
		t.Fatal(err)
	}

	s := &DesktopService{configPath: filepath.Join(t.TempDir(), "instances.json")}
	state, err := s.AddMASInstance("Test", root)
	if err != nil {
		t.Fatal(err)
	}
	// AddMASInstance 会先跑一遍遗留事务恢复，所以 journal 必须写在它之后，
	// 才代表「此刻有一个事务正在进行」。
	writeTransactionJournal(t, root, core.TxPhaseApplying)

	// 事务进行时必须拒绝启动，不能进入 exec：Ren'Py 启动会和正在写入的文件互相干扰。
	err = s.LaunchMASInstance(state.ActiveID)
	if !errors.Is(err, ErrTransactionInProgress) {
		t.Fatalf("expected ErrTransactionInProgress, got: %v", err)
	}
	if err.Error() != "transaction_in_progress" {
		t.Fatalf("error text must stay the stable code, got: %q", err.Error())
	}
}

func TestEnsureNoTransactionInProgressFollowsJournalPhase(t *testing.T) {
	cases := []struct {
		phase   string
		blocked bool
	}{
		{core.TxPhasePlanned, true},
		{core.TxPhasePrepared, true},
		{core.TxPhaseApplying, true},
		{core.TxPhaseCommitting, true},
		{core.TxPhaseCommitted, false},
		{core.TxPhaseRolledBack, false},
		{core.TxPhaseNeedsManualRecovery, false},
	}

	for _, tc := range cases {
		t.Run(tc.phase, func(t *testing.T) {
			root := t.TempDir()
			writeTransactionJournal(t, root, tc.phase)

			err := ensureNoTransactionInProgress(root)
			if tc.blocked && !errors.Is(err, ErrTransactionInProgress) {
				t.Fatalf("phase %q: expected block, got %v", tc.phase, err)
			}
			if !tc.blocked && err != nil {
				t.Fatalf("phase %q: expected launch to stay possible, got %v", tc.phase, err)
			}
		})
	}
}

func TestEnsureNoTransactionInProgressOnCleanInstance(t *testing.T) {
	if err := ensureNoTransactionInProgress(t.TempDir()); err != nil {
		t.Fatalf("clean instance must not be blocked: %v", err)
	}
}
