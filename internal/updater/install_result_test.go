package updater

import (
	"testing"
)

func TestSystemInstallResultAllowsRetryWithVerifiedArtifact(t *testing.T) {
	for _, result := range []string{"cancelled", "failed", "returned"} {
		t.Run(result, func(t *testing.T) {
			s := testDownloadService(t, 0)
			s.installer = stateTestInstaller(false)
			s.state = State{Status: StatusReady, StagedPath: "verified.apk", LatestVersion: "2.0.0"}
			if state, err := s.ClaimInstall(); err != nil || state.Status != StatusAwaitingUser {
				t.Fatalf("claim: %+v %v", state, err)
			}
			s.ApplyInstallResult(result)
			state := s.GetState()
			if state.Status != StatusReady || state.StagedPath != "verified.apk" || state.Error == "" {
				t.Fatalf("retry lost artifact or error: %+v", state)
			}
			if state, err := s.ClaimInstall(); err != nil || state.Status != StatusAwaitingUser || state.Error != "" {
				t.Fatalf("retry: %+v %v", state, err)
			}
		})
	}
}

func TestPendingSystemInstallResultKeepsClaim(t *testing.T) {
	for _, result := range []string{"", "none", "launched", "unknown"} {
		s := testDownloadService(t, 0)
		s.state = State{Status: StatusAwaitingUser, StagedPath: "verified.apk"}
		s.ApplyInstallResult(result)
		if s.GetState().Status != StatusAwaitingUser {
			t.Fatalf("result %q released claim", result)
		}
		if _, err := s.ClaimInstall(); err == nil {
			t.Fatalf("result %q allowed duplicate install", result)
		}
	}
}

func TestSystemInstallCompletionRequiresWaitingClaim(t *testing.T) {
	s := testDownloadService(t, 0)
	s.state = State{Status: StatusReady, StagedPath: "verified.apk"}
	s.ApplyInstallResult("completed")
	if s.GetState().Status != StatusReady {
		t.Fatal("unclaimed installation marked complete")
	}
	s.installer = stateTestInstaller(false)
	if _, err := s.ClaimInstall(); err != nil {
		t.Fatal(err)
	}
	s.ApplyInstallResult("completed")
	if s.GetState().Status != StatusCompleted {
		t.Fatalf("state=%+v", s.GetState())
	}
	if _, err := s.ClaimInstall(); err == nil {
		t.Fatal("completed installation claimed twice")
	}
}
