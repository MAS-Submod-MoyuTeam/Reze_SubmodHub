package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	core "github.com/reze/submodhub/internal/install"
)

func TestUpdateClaimBlocksPersistentWrites(t *testing.T) {
	svc := &DesktopService{}
	if err := svc.mutations.claimUpdate(); err != nil {
		t.Fatal(err)
	}
	operations := map[string]func() error{
		"execute_plan":      func() error { _, err := svc.ExecutePlan(ExecutePlanRequest{}); return err },
		"apply_file":        func() error { _, err := svc.ApplyFile(InstallRequest{}); return err },
		"rollback":          func() error { return svc.RollbackOperation("test") },
		"recover":           func() error { return svc.Recover("test") },
		"set_root":          func() error { _, err := svc.SetMASRoot(""); return err },
		"save_instances":    func() error { return svc.saveInstances() },
		"create_gift":       func() error { _, err := svc.CreateSpriteGift(""); return err },
		"delete_spritepack": func() error { _, err := svc.DeleteSpritepack(""); return err },
	}
	for name, operation := range operations {
		t.Run(name, func(t *testing.T) {
			if err := operation(); !errors.Is(err, errAppUpdateExiting) {
				t.Fatalf("write admitted after update handoff: %v", err)
			}
		})
	}
	if err := svc.mutations.claimUpdate(); !errors.Is(err, errAppUpdateExiting) {
		t.Fatalf("duplicate handoff admitted: %v", err)
	}
}

func TestUpdateClaimWaitsForEveryNestedMutation(t *testing.T) {
	var gate clientMutationGate
	outer, err := gate.begin()
	if err != nil {
		t.Fatal(err)
	}
	inner, err := gate.begin()
	if err != nil {
		t.Fatal(err)
	}
	if err := gate.claimUpdate(); !errors.Is(err, errFileMutationInProgress) {
		t.Fatalf("update admitted with active mutations: %v", err)
	}
	inner()
	if err := gate.claimUpdate(); !errors.Is(err, errFileMutationInProgress) {
		t.Fatalf("update admitted before outer mutation finished: %v", err)
	}
	outer()
	if err := gate.claimUpdate(); err != nil {
		t.Fatal(err)
	}
	gate.releaseUpdate()
	finish, err := gate.begin()
	if err != nil {
		t.Fatalf("failed handoff blocked future mutations: %v", err)
	}
	finish()
}

func TestFailedUpdateClaimReleasesFileMutations(t *testing.T) {
	bindings, err := newAppUpdateBindings(&mockUpdateBridge{}, t.TempDir(), "", "")
	if err != nil {
		t.Fatal(err)
	}
	svc := &DesktopService{appUpdater: bindings}
	if _, err := svc.InstallAppUpdate(); err == nil {
		t.Fatal("installation without a ready artifact succeeded")
	}
	finish, err := svc.mutations.begin()
	if err != nil {
		t.Fatalf("failed install claim kept shutdown reservation: %v", err)
	}
	finish()
	if err := svc.mutations.claimUpdate(); err != nil {
		t.Fatalf("failed install claim prevented retry: %v", err)
	}
}

func TestAppUpdateRejectsRunningFileMutation(t *testing.T) {
	for _, operation := range []string{"execute_plan", "apply_file"} {
		t.Run(operation, func(t *testing.T) {
			root := t.TempDir()
			if err := os.MkdirAll(filepath.Join(root, "game"), 0755); err != nil {
				t.Fatal(err)
			}
			svc := NewDesktopService()
			if _, err := svc.SetMASRoot(root); err != nil {
				t.Fatal(err)
			}
			bridge := &mockUpdateBridge{}
			bindings, err := newAppUpdateBindings(bridge, t.TempDir(), "", "")
			if err != nil {
				t.Fatal(err)
			}
			svc.appUpdater = bindings
			manifest, err := svc.core.LoadManifest()
			if err != nil {
				t.Fatal(err)
			}
			if _, err := svc.core.GetBlobs().Put([]byte("new")); err != nil {
				t.Fatal(err)
			}
			plan, err := core.PlanInstall(manifest, root, svc.core.GetBlobs(), core.InstallOperation{
				OperationID: "update-overlap", Files: []core.PlannedFile{{Path: "game/test.txt", Content: []byte("new")}},
			})
			if err != nil {
				t.Fatal(err)
			}
			svc.activePlan = plan
			entered, release := make(chan struct{}), make(chan struct{})
			svc.core.SetFaultHook(func(step string) error {
				if step == "after_prepared" {
					close(entered)
					<-release
				}
				return nil
			})
			finished := make(chan error, 1)
			go func() {
				if operation == "execute_plan" {
					_, err := svc.ExecutePlan(ExecutePlanRequest{PlanID: plan.PlanID, Confirmed: true})
					finished <- err
				} else {
					_, err := svc.ApplyFile(InstallRequest{OperationID: "apply-overlap", Path: "game/test.txt", Content: "new"})
					finished <- err
				}
			}()
			t.Cleanup(func() {
				close(release)
				select {
				case err := <-finished:
					if err != nil {
						t.Errorf("file mutation failed: %v", err)
					}
				case <-time.After(5 * time.Second):
					t.Error("file mutation did not finish")
				}
			})
			select {
			case <-entered:
			case err := <-finished:
				t.Fatalf("file mutation did not reach transaction checkpoint: %v", err)
			case <-time.After(5 * time.Second):
				t.Fatal("file mutation did not reach transaction checkpoint")
			}
			// This must reject before claiming an update, even when no artifact is
			// ready. Otherwise a ready artifact could schedule os.Exit mid-write.
			if _, err := svc.InstallAppUpdate(); err == nil || !strings.Contains(err.Error(), "文件变更") {
				t.Fatalf("expected active file mutation rejection, got %v", err)
			}
			if bridge.installedTarget != "" {
				t.Fatal("installer launched while a transaction was running")
			}
		})
	}
}
