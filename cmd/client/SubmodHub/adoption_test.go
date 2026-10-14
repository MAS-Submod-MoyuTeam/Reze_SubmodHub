package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDesktopServiceAdoptFlow(t *testing.T) {
	root := t.TempDir()
	configDir := t.TempDir()

	submodsDir := filepath.Join(root, "game", "Submods", "UnmanagedCoolMod")
	if err := os.MkdirAll(submodsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	rpyPath := filepath.Join(submodsDir, "cool.rpy")
	rpyContent := []byte("init python:\n    Submod(name='Cool Mod', author='Cool Author', version='1.0')\n")
	if err := os.WriteFile(rpyPath, rpyContent, 0o644); err != nil {
		t.Fatal(err)
	}

	service := NewDesktopService()
	service.configPath = filepath.Join(configDir, "instances.json")
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	// 1. Initial scan should show 1 unmanaged mod
	scan1, err := service.ScanLocalSubmods()
	if err != nil {
		t.Fatalf("ScanLocalSubmods failed: %v", err)
	}
	if len(scan1) != 1 || scan1[0].Directory != "UnmanagedCoolMod" {
		t.Fatalf("expected 1 unmanaged mod, got %+v", scan1)
	}

	// 2. PreviewAdopt
	preview, err := service.PreviewAdopt(AdoptRequest{
		ScanItemID: "UnmanagedCoolMod",
		ModID:      "cool_mod_id",
		VersionID:  "ver_1",
		Version:    "1.0",
		Title:      "Cool Mod Title",
		Priority:   10,
		Files:      []string{"game/Submods/UnmanagedCoolMod/cool.rpy"},
	})
	if err != nil {
		t.Fatalf("PreviewAdopt failed: %v", err)
	}
	if preview.Kind != "adopt" || len(preview.Blockers) > 0 {
		t.Fatalf("unexpected preview result: %+v", preview)
	}

	// 3. ExecutePlan
	execRes, err := service.ExecutePlan(ExecutePlanRequest{
		PlanID:    preview.PlanID,
		Confirmed: true,
	})
	if err != nil {
		t.Fatalf("ExecutePlan failed: %v", err)
	}
	if execRes.State != "committed" {
		t.Fatalf("expected committed, got %s", execRes.State)
	}

	// 4. Verify receipt exists
	receipts, err := service.ListInstalledArchives()
	if err != nil {
		t.Fatal(err)
	}
	if len(receipts) != 1 || receipts[0].ModID != "cool_mod_id" || receipts[0].Title != "Cool Mod Title" {
		t.Fatalf("receipt mismatch: %+v", receipts)
	}
	if receipts[0].VersionID != "" {
		t.Fatalf("expected receipt.VersionID to be cleared to empty string on adoption, got %q", receipts[0].VersionID)
	}
	if receipts[0].Version != "1.0-adopted" {
		t.Fatalf("expected receipt.Version to record local baseline '1.0-adopted', got %q", receipts[0].Version)
	}

	// 5. Subsequent ScanLocalSubmods must NOT include the adopted file
	scan2, err := service.ScanLocalSubmods()
	if err != nil {
		t.Fatalf("ScanLocalSubmods failed: %v", err)
	}
	if len(scan2) != 0 {
		t.Fatalf("expected 0 unmanaged submods after adoption, got %+v", scan2)
	}

	// 6. Service restart / reload must retain the adoption
	restartedService := NewDesktopService()
	restartedService.configPath = filepath.Join(configDir, "instances.json")
	if _, err := restartedService.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}
	receiptsRestarted, err := restartedService.ListInstalledArchives()
	if err != nil {
		t.Fatal(err)
	}
	if len(receiptsRestarted) != 1 || receiptsRestarted[0].ModID != "cool_mod_id" {
		t.Fatalf("receipt lost after restart: %+v", receiptsRestarted)
	}

	scanRestarted, err := restartedService.ScanLocalSubmods()
	if err != nil {
		t.Fatal(err)
	}
	if len(scanRestarted) != 0 {
		t.Fatalf("expected 0 unmanaged submods after restart, got %+v", scanRestarted)
	}
}

func TestDesktopServiceAdoptScopeAndEvidenceValidation(t *testing.T) {
	root := t.TempDir()
	configDir := t.TempDir()

	submodsDir := filepath.Join(root, "game", "Submods", "UnmanagedModA")
	if err := os.MkdirAll(submodsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(submodsDir, "a.rpy"), []byte("# no registration\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	service := NewDesktopService()
	service.configPath = filepath.Join(configDir, "instances.json")
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	// 1. Trying to adopt a file outside the scan item must fail
	_, err := service.PreviewAdopt(AdoptRequest{
		ScanItemID: "UnmanagedModA",
		ModID:      "mod_a",
		Files:      []string{"game/Submods/OtherDirectory/fake.rpy"},
	})
	if err == nil || !strings.Contains(err.Error(), "not part of scanned item") {
		t.Fatalf("expected error for file outside scan item, got %v", err)
	}

	// 2. Trying to adopt with non-existent or expired ScanItemID must fail
	_, err = service.PreviewAdopt(AdoptRequest{
		ScanItemID: "NonExistentScanItem",
		Files:      []string{"game/Submods/UnmanagedModA/a.rpy"},
	})
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("expected error for non-existent scan item, got %v", err)
	}

	// 3. Trying to adopt without ScanItemID when mod_id is not identifiable must fail
	_, err = service.PreviewAdopt(AdoptRequest{
		Files: []string{"game/script.rpy"},
	})
	if err == nil || !strings.Contains(err.Error(), "scan_item_id_required") {
		t.Fatalf("expected scan_item_id_required for missing scan item, got %v", err)
	}

	// 4. Adopting a file with VersionID without registration evidence must clear VersionID and use adopted baseline
	preview, err := service.PreviewAdopt(AdoptRequest{
		ScanItemID: "UnmanagedModA",
		ModID:      "mod_a",
		VersionID:  "ver_fake_store_version",
		Version:    "2.0.0",
		Title:      "Mod A Without Registration",
		Files:      []string{"game/Submods/UnmanagedModA/a.rpy"},
	})
	if err != nil {
		t.Fatalf("PreviewAdopt failed: %v", err)
	}
	// The effective version in active plan must have cleared VersionID
	if preview.Version != "2.0.0-adopted" {
		t.Fatalf("expected version 2.0.0-adopted, got %q", preview.Version)
	}
	if service.activePlan.VersionID != "" {
		t.Fatalf("expected activePlan.VersionID to be cleared, got %q", service.activePlan.VersionID)
	}

	// 5. Adopting with registration for Mod A but claiming Mod B's VersionID must also clear VersionID
	submodsDirB := filepath.Join(root, "game", "Submods", "UnmanagedModB")
	if err := os.MkdirAll(submodsDirB, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(submodsDirB, "b.rpy"), []byte("init python:\n    Submod(name='Mod A Original', author='Auth')\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	previewMismatch, err := service.PreviewAdopt(AdoptRequest{
		ScanItemID: "UnmanagedModB",
		ModID:      "completely_different_store_mod_id",
		VersionID:  "ver_diff_store",
		Version:    "1.5.0",
		Title:      "Store Mod B",
		Files:      []string{"game/Submods/UnmanagedModB/b.rpy"},
	})
	if err != nil {
		t.Fatalf("PreviewAdopt failed for mismatch test: %v", err)
	}
	if previewMismatch.Version != "1.5.0-adopted" {
		t.Fatalf("expected version 1.5.0-adopted on mismatched registration, got %q", previewMismatch.Version)
	}
	if service.activePlan.VersionID != "" {
		t.Fatalf("expected activePlan.VersionID to be cleared when registration name does not match mod_id, got %q", service.activePlan.VersionID)
	}

	// 6. Adopting where ModID matches the directory name exactly ("UnmanagedModB") must STILL clear VersionID
	previewMatchDir, err := service.PreviewAdopt(AdoptRequest{
		ScanItemID: "UnmanagedModB",
		ModID:      "UnmanagedModB",
		VersionID:  "ver_pretend_published",
		Version:    "1.5.0",
		Title:      "Mod B Matching Directory",
		Files:      []string{"game/Submods/UnmanagedModB/b.rpy"},
	})
	if err != nil {
		t.Fatalf("PreviewAdopt failed for match dir test: %v", err)
	}
	if previewMatchDir.Version != "1.5.0-adopted" {
		t.Fatalf("expected version 1.5.0-adopted, got %q", previewMatchDir.Version)
	}
	if service.activePlan.VersionID != "" {
		t.Fatalf("expected activePlan.VersionID to be unconditionally cleared despite directory match, got %q", service.activePlan.VersionID)
	}

	// 7. Adopting where ModID matches the registration name ("Mod A Original") must ALSO clear VersionID unconditionally
	previewMatchReg, err := service.PreviewAdopt(AdoptRequest{
		ScanItemID: "UnmanagedModB",
		ModID:      "Mod A Original",
		VersionID:  "ver_pretend_published_2",
		Version:    "1.5.0",
		Title:      "Mod Matching Reg Name",
		Files:      []string{"game/Submods/UnmanagedModB/b.rpy"},
	})
	if err != nil {
		t.Fatalf("PreviewAdopt failed for match reg test: %v", err)
	}
	if previewMatchReg.Version != "1.5.0-adopted" {
		t.Fatalf("expected version 1.5.0-adopted, got %q", previewMatchReg.Version)
	}
	if service.activePlan.VersionID != "" {
		t.Fatalf("expected activePlan.VersionID to be unconditionally cleared despite registration name match, got %q", service.activePlan.VersionID)
	}
}

func TestDesktopServiceAdoptMultiRegistrationValidation(t *testing.T) {
	root := t.TempDir()
	configDir := t.TempDir()

	multiDir := filepath.Join(root, "game", "Submods", "MultiRegMod")
	if err := os.MkdirAll(multiDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// a.rpy registers "Mod A"
	if err := os.WriteFile(filepath.Join(multiDir, "a.rpy"), []byte("init python:\n    Submod(name='Mod A', author='Author A')\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// b.rpy registers "Mod B"
	if err := os.WriteFile(filepath.Join(multiDir, "b.rpy"), []byte("init python:\n    Submod(name='Mod B', author='Author B')\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// unk.rpy has unknown registration
	if err := os.WriteFile(filepath.Join(multiDir, "unk.rpy"), []byte("init python:\n    Submod(eval('dynamic_name'))\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// asset.png has no registration
	if err := os.WriteFile(filepath.Join(multiDir, "asset.png"), []byte("fake_image_data"), 0o644); err != nil {
		t.Fatal(err)
	}

	service := NewDesktopService()
	service.configPath = filepath.Join(configDir, "instances.json")
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}
	service.SetCandidateRegistrationsResolver(func(candidateID string) ([]string, error) {
		switch candidateID {
		case "store_candidate_a":
			return []string{"Mod A"}, nil
		case "store_candidate_b":
			return []string{"Mod B"}, nil
		default:
			return nil, fmt.Errorf("candidate %q not found", candidateID)
		}
	})

	// 1. Trying to adopt both a.rpy and b.rpy as Candidate A must fail
	_, err := service.PreviewAdopt(AdoptRequest{
		ScanItemID:             "MultiRegMod",
		ModID:                  "store_candidate_a",
		CandidateID:            "store_candidate_a",
		CandidateRegistrations: []string{"Mod A"},
		Title:                  "Candidate A Title",
		Files: []string{
			"game/Submods/MultiRegMod/a.rpy",
			"game/Submods/MultiRegMod/b.rpy",
		},
	})
	if err == nil || !strings.Contains(err.Error(), "does not match candidate") {
		t.Fatalf("expected error rejecting foreign registration in candidate adoption, got: %v", err)
	}

	// 2. Trying to adopt only b.rpy as Candidate A must fail
	_, err = service.PreviewAdopt(AdoptRequest{
		ScanItemID:             "MultiRegMod",
		ModID:                  "store_candidate_a",
		CandidateID:            "store_candidate_a",
		CandidateRegistrations: []string{"Mod A"},
		Title:                  "Candidate A Title",
		Files: []string{
			"game/Submods/MultiRegMod/b.rpy",
		},
	})
	if err == nil || !strings.Contains(err.Error(), "does not match candidate") {
		t.Fatalf("expected error rejecting mismatched registration for candidate, got: %v", err)
	}

	// 3. Trying to adopt unk.rpy (unknown registration) as Candidate A must fail
	_, err = service.PreviewAdopt(AdoptRequest{
		ScanItemID:             "MultiRegMod",
		ModID:                  "store_candidate_a",
		CandidateID:            "store_candidate_a",
		CandidateRegistrations: []string{"Mod A"},
		Title:                  "Candidate A Title",
		Files: []string{
			"game/Submods/MultiRegMod/unk.rpy",
		},
	})
	if err == nil || !strings.Contains(err.Error(), "unknown or malformed registration") {
		t.Fatalf("expected error rejecting unknown registration for candidate, got: %v", err)
	}

	// 4. Trying to adopt only asset.png (no registration) as Candidate A must fail
	_, err = service.PreviewAdopt(AdoptRequest{
		ScanItemID:             "MultiRegMod",
		ModID:                  "store_candidate_a",
		CandidateID:            "store_candidate_a",
		CandidateRegistrations: []string{"Mod A"},
		Title:                  "Candidate A Title",
		Files: []string{
			"game/Submods/MultiRegMod/asset.png",
		},
	})
	if err == nil || !strings.Contains(err.Error(), "do not contain verified registration source") {
		t.Fatalf("expected error rejecting selection without verified registration source for candidate, got: %v", err)
	}

	// 5. Trying to adopt both a.rpy and b.rpy without candidate (local adoption) must fail
	_, err = service.PreviewAdopt(AdoptRequest{
		ScanItemID: "MultiRegMod",
		ModID:      "local_multi_mod",
		Title:      "Local Multi Mod",
		Files: []string{
			"game/Submods/MultiRegMod/a.rpy",
			"game/Submods/MultiRegMod/b.rpy",
		},
	})
	if err == nil || !strings.Contains(err.Error(), "multiple registration identities") {
		t.Fatalf("expected error rejecting multiple registration identities for local mod, got: %v", err)
	}

	// 6. Adopting only a.rpy (with companion asset.png) as Candidate A must SUCCEED
	previewA, err := service.PreviewAdopt(AdoptRequest{
		ScanItemID:             "MultiRegMod",
		ModID:                  "store_candidate_a",
		CandidateID:            "store_candidate_a",
		CandidateRegistrations: []string{"Mod A"},
		Title:                  "Candidate A Title",
		Files: []string{
			"game/Submods/MultiRegMod/a.rpy",
			"game/Submods/MultiRegMod/asset.png",
		},
	})
	if err != nil {
		t.Fatalf("expected adoption of candidate A matching files to succeed, got: %v", err)
	}
	if previewA.TargetID != "store_candidate_a" {
		t.Fatalf("expected TargetID store_candidate_a, got %s", previewA.TargetID)
	}

	// 7. Adopting only b.rpy as Candidate B must SUCCEED
	previewB, err := service.PreviewAdopt(AdoptRequest{
		ScanItemID:             "MultiRegMod",
		ModID:                  "store_candidate_b",
		CandidateID:            "store_candidate_b",
		CandidateRegistrations: []string{"Mod B"},
		Title:                  "Candidate B Title",
		Files: []string{
			"game/Submods/MultiRegMod/b.rpy",
		},
	})
	if err != nil {
		t.Fatalf("expected adoption of candidate B matching file to succeed, got: %v", err)
	}
	if previewB.TargetID != "store_candidate_b" {
		t.Fatalf("expected TargetID store_candidate_b, got %s", previewB.TargetID)
	}
}

func TestDesktopServiceAdoptCandidateIdentityStrictValidation(t *testing.T) {
	root := t.TempDir()
	configDir := t.TempDir()

	multiDir := filepath.Join(root, "game", "Submods", "IdentityTestMod")
	if err := os.MkdirAll(multiDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// file_a.rpy registers "Actual A"
	if err := os.WriteFile(filepath.Join(multiDir, "file_a.rpy"), []byte("init python:\n    Submod(name='Actual A', author='Author')\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// file_b.rpy registers "Mod B"
	if err := os.WriteFile(filepath.Join(multiDir, "file_b.rpy"), []byte("init python:\n    Submod(name='Mod B', author='Author')\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// file_case.rpy registers "actual a" (all lowercase, different from "Actual A")
	if err := os.WriteFile(filepath.Join(multiDir, "file_case.rpy"), []byte("init python:\n    Submod(name='actual a', author='Author')\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	service := NewDesktopService()
	service.configPath = filepath.Join(configDir, "instances.json")
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}
	// Trusted store candidate A has registrations: ["Actual A"]
	service.SetCandidateRegistrationsResolver(func(candidateID string) ([]string, error) {
		if candidateID == "cand_a" {
			return []string{"Actual A"}, nil
		}
		return nil, fmt.Errorf("candidate %q not found in store", candidateID)
	})

	// 1. Rejection: 标题与另一个模组注册名相同
	// Store candidate A has registration ["Actual A"], but its Title is "Mod B".
	// Local directory contains file_b.rpy with registration "Mod B".
	// Adopting file_b.rpy as candidate A must be REJECTED (no title fallback).
	_, err := service.PreviewAdopt(AdoptRequest{
		ScanItemID:             "IdentityTestMod",
		ModID:                  "cand_a",
		CandidateID:            "cand_a",
		CandidateRegistrations: []string{"Actual A"},
		Title:                  "Mod B", // Title equals registration of file_b
		Files:                  []string{"game/Submods/IdentityTestMod/file_b.rpy"},
	})
	if err == nil || !strings.Contains(err.Error(), "does not match candidate") {
		t.Fatalf("expected error rejecting adoption when registration only matches candidate Title, got: %v", err)
	}

	// 2. Rejection: 仅大小写不同
	// Store candidate A has registration ["Actual A"].
	// Local file_case.rpy has registration "actual a" (different casing).
	// Adopting file_case.rpy as candidate A must be REJECTED (strict case sensitivity).
	_, err = service.PreviewAdopt(AdoptRequest{
		ScanItemID:             "IdentityTestMod",
		ModID:                  "cand_a",
		CandidateID:            "cand_a",
		CandidateRegistrations: []string{"Actual A"},
		Files:                  []string{"game/Submods/IdentityTestMod/file_case.rpy"},
	})
	if err == nil || !strings.Contains(err.Error(), "does not match candidate") {
		t.Fatalf("expected error rejecting adoption when registration casing does not match, got: %v", err)
	}

	// 3. Rejection: 伪造候选注册集合
	// Attacker supplies CandidateRegistrations: ["Mod B"] attempting to adopt file_b.rpy
	// But trusted store only has ["Actual A"].
	// Must be REJECTED because request CandidateRegistrations contains unverified identity.
	_, err = service.PreviewAdopt(AdoptRequest{
		ScanItemID:             "IdentityTestMod",
		ModID:                  "cand_a",
		CandidateID:            "cand_a",
		CandidateRegistrations: []string{"Mod B"}, // forged!
		Files:                  []string{"game/Submods/IdentityTestMod/file_b.rpy"},
	})
	if err == nil || !strings.Contains(err.Error(), "unverified identity") {
		t.Fatalf("expected error rejecting forged candidate registrations, got: %v", err)
	}

	// 4. Rejection: CandidateID 与 ModID 不一致
	_, err = service.PreviewAdopt(AdoptRequest{
		ScanItemID:  "IdentityTestMod",
		ModID:       "different_mod_id",
		CandidateID: "cand_a",
		Files:       []string{"game/Submods/IdentityTestMod/file_a.rpy"},
	})
	if err == nil || !strings.Contains(err.Error(), "does not match mod_id") {
		t.Fatalf("expected error rejecting CandidateID != ModID mismatch, got: %v", err)
	}

	// 5. Success: Strict match with trusted store registration ["Actual A"]
	preview, err := service.PreviewAdopt(AdoptRequest{
		ScanItemID:  "IdentityTestMod",
		ModID:       "cand_a",
		CandidateID: "cand_a",
		Files:       []string{"game/Submods/IdentityTestMod/file_a.rpy"},
	})
	if err != nil {
		t.Fatalf("expected successful preview for exact matching candidate, got: %v", err)
	}
	if preview.TargetID != "cand_a" {
		t.Fatalf("expected TargetID cand_a, got %s", preview.TargetID)
	}
}

func TestDesktopServiceAdoptHTTPStoreCandidateFetch(t *testing.T) {
	root := t.TempDir()
	configDir := t.TempDir()

	submodsDir := filepath.Join(root, "game", "Submods", "HTTPTestMod")
	if err := os.MkdirAll(submodsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(submodsDir, "sub.rpy"), []byte("init python:\n    Submod(name='Store Mod Registration')\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Mock HTTP store server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/mods/store_mod_123/registrations" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"mod_id":        "store_mod_123",
				"registrations": []string{"Store Mod Registration"},
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	service := NewDesktopService()
	service.configPath = filepath.Join(configDir, "instances.json")
	service.SetAPIURL(server.URL)
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	// Should successfully fetch from HTTP store server and adopt
	preview, err := service.PreviewAdopt(AdoptRequest{
		ScanItemID:  "HTTPTestMod",
		ModID:       "store_mod_123",
		CandidateID: "store_mod_123",
		Files:       []string{"game/Submods/HTTPTestMod/sub.rpy"},
	})
	if err != nil {
		t.Fatalf("expected success with HTTP store registrations, got: %v", err)
	}
	if preview.TargetID != "store_mod_123" {
		t.Fatalf("expected TargetID store_mod_123, got %s", preview.TargetID)
	}
}

func TestDesktopServiceAdoptHTTPStoreCandidateModIDMismatch(t *testing.T) {
	root := t.TempDir()
	configDir := t.TempDir()

	submodsDir := filepath.Join(root, "game", "Submods", "HTTPMismatchMod")
	if err := os.MkdirAll(submodsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(submodsDir, "sub.rpy"), []byte("init python:\n    Submod(name='Store Mod Registration')\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Mock HTTP store server that responds with a mismatched mod_id
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/mods/store_mod_123/registrations" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"mod_id":        "store_mod_other", // Mismatched mod_id
				"registrations": []string{"Store Mod Registration"},
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	service := NewDesktopService()
	service.configPath = filepath.Join(configDir, "instances.json")
	service.SetAPIURL(server.URL)
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	// Requesting store_mod_123 when store responds with store_mod_other must be rejected
	_, err := service.PreviewAdopt(AdoptRequest{
		ScanItemID:  "HTTPMismatchMod",
		ModID:       "store_mod_123",
		CandidateID: "store_mod_123",
		Files:       []string{"game/Submods/HTTPMismatchMod/sub.rpy"},
	})
	if err == nil {
		t.Fatal("expected error rejecting mismatched mod_id in store registrations response, got nil")
	}
	if !errors.Is(err, ErrCandidateRegistrationIdentityMismatch) {
		t.Fatalf("expected error to wrap ErrCandidateRegistrationIdentityMismatch, got: %v", err)
	}
	if !strings.Contains(err.Error(), "candidate_registration_identity_mismatch") {
		t.Fatalf("expected error message to contain candidate_registration_identity_mismatch, got: %v", err)
	}
}

func TestDesktopServiceAdoptHTTPStoreCandidateModIDEmptyOrOmitted(t *testing.T) {
	root := t.TempDir()
	configDir := t.TempDir()

	submodsDir := filepath.Join(root, "game", "Submods", "HTTPEmptyMod")
	if err := os.MkdirAll(submodsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(submodsDir, "sub.rpy"), []byte("init python:\n    Submod(name='Store Mod Registration')\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	// Mock HTTP store server that responds with empty/omitted mod_id
	var responseMap map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/mods/store_mod_123/registrations" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(responseMap)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	service := NewDesktopService()
	service.configPath = filepath.Join(configDir, "instances.json")
	service.SetAPIURL(server.URL)
	if _, err := service.SetMASRoot(root); err != nil {
		t.Fatal(err)
	}

	t.Run("omitted mod_id", func(t *testing.T) {
		responseMap = map[string]any{
			"registrations": []string{"Store Mod Registration"},
		}
		_, err := service.PreviewAdopt(AdoptRequest{
			ScanItemID:  "HTTPEmptyMod",
			ModID:       "store_mod_123",
			CandidateID: "store_mod_123",
			Files:       []string{"game/Submods/HTTPEmptyMod/sub.rpy"},
		})
		if err == nil {
			t.Fatal("expected error rejecting omitted mod_id, got nil")
		}
		if !errors.Is(err, ErrCandidateRegistrationIdentityMismatch) {
			t.Fatalf("expected error to wrap ErrCandidateRegistrationIdentityMismatch, got: %v", err)
		}
		if !strings.Contains(err.Error(), "candidate_registration_identity_mismatch") {
			t.Fatalf("expected error message to contain candidate_registration_identity_mismatch, got: %v", err)
		}
	})

	t.Run("empty string mod_id", func(t *testing.T) {
		responseMap = map[string]any{
			"mod_id":        "",
			"registrations": []string{"Store Mod Registration"},
		}
		_, err := service.PreviewAdopt(AdoptRequest{
			ScanItemID:  "HTTPEmptyMod",
			ModID:       "store_mod_123",
			CandidateID: "store_mod_123",
			Files:       []string{"game/Submods/HTTPEmptyMod/sub.rpy"},
		})
		if err == nil {
			t.Fatal("expected error rejecting empty mod_id, got nil")
		}
		if !errors.Is(err, ErrCandidateRegistrationIdentityMismatch) {
			t.Fatalf("expected error to wrap ErrCandidateRegistrationIdentityMismatch, got: %v", err)
		}
	})
}

