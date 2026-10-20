package httpapi

import (
	"testing"
	"time"
)

func TestMirrorReconcileLatestLocalAndSpriteBoundary(t *testing.T) {
	s, err := NewStore(t.TempDir(), Catalog{Mods: []Mod{{ID: "gh", Category: "submod", LatestVersionID: "new"}, {ID: "local", Category: "submod"}, {ID: "sprite", Category: "spritepack", LatestVersionID: "sprite"}}, Versions: map[string]Version{
		"old":    {ID: "old", ModID: "gh", State: "published", SourceType: "github_releases", SHA256: "old", ArchivePath: "old.zip"},
		"new":    {ID: "new", ModID: "gh", State: "published", SourceType: "github_releases", SHA256: "new", ArchivePath: "new.zip"},
		"local":  {ID: "local", ModID: "local", State: "published", SHA256: "local", ArchivePath: "local.zip"},
		"draft":  {ID: "draft", ModID: "local", State: "uploaded", SHA256: "draft", ArchivePath: "draft.zip"},
		"sprite": {ID: "sprite", ModID: "sprite", State: "published", SHA256: "sprite", ArchivePath: "sprite.zip"},
	}, DeliveryNodes: []DeliveryNode{{ID: "a", Type: "cloudreve", Enabled: true, Revision: 1}, {ID: "b", Type: "cloudreve", Enabled: true, Revision: 1}, {ID: "off", Type: "cloudreve"}, {ID: "relay", Type: "github_relay", Enabled: true}}})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.reconcileMirrors(false); err != nil {
		t.Fatal(err)
	}
	if len(s.Catalog.ArchiveMirrors) != 4 {
		t.Fatalf("expected latest + local on two nodes: %+v", s.Catalog.ArchiveMirrors)
	}
	if err = s.reconcileMirrors(false); err != nil {
		t.Fatal(err)
	}
	if len(s.Catalog.ArchiveMirrors) != 4 {
		t.Fatal("duplicate tasks")
	}
	s.mu.Lock()
	m := s.Catalog.ArchiveMirrors[0]
	m.State = "uploading"
	s.Catalog.ArchiveMirrors[0] = m
	s.mu.Unlock()
	if err = s.reconcileMirrors(true); err != nil {
		t.Fatal(err)
	}
	if s.Catalog.ArchiveMirrors[0].State != "pending" {
		t.Fatal("uploading not recovered")
	}
	s.mu.Lock()
	s.Catalog.DeliveryNodes[0].Revision = 2
	s.mu.Unlock()
	if err = s.reconcileMirrors(false); err != nil {
		t.Fatal(err)
	}
	for _, m := range s.Catalog.ArchiveMirrors {
		if m.NodeID == "a" && m.NodeRevision != 2 {
			t.Fatal("stale node config reused")
		}
	}
}
func TestMirrorCompletionCannotPublishOrOverrideLatest(t *testing.T) {
	s, _ := NewStore(t.TempDir(), Catalog{Mods: []Mod{{ID: "m", Category: "submod", LatestVersionID: "v2"}}, Versions: map[string]Version{"v1": {ID: "v1", ModID: "m", State: "published", SHA256: "hash"}, "v2": {ID: "v2", ModID: "m", State: "published"}}, DeliveryNodes: []DeliveryNode{{ID: "n", Type: "cloudreve", Enabled: true, Revision: 1}}, ArchiveMirrors: []ArchiveMirror{{NodeID: "n", NodeRevision: 1, VersionID: "v1", SHA256: "hash", State: "uploading"}}})
	job := s.Catalog.ArchiveMirrors[0]
	if err := s.finishMirror(job, "obj", nil); err != nil {
		t.Fatal(err)
	}
	if s.Catalog.Mods[0].LatestVersionID != "v2" {
		t.Fatal("old mirror completion rewrote latest")
	}
	s.Catalog.DeliveryNodes[0].Revision = 2
	if err := s.finishMirror(job, "stale", nil); err != nil {
		t.Fatal(err)
	}
	if s.Catalog.ArchiveMirrors[0].FileID == "stale" {
		t.Fatal("stale credentials completion accepted")
	}
}
func TestMirrorFailureBackoffPersists(t *testing.T) {
	s, _ := NewStore(t.TempDir(), Catalog{DeliveryNodes: []DeliveryNode{{ID: "n", Type: "cloudreve", Enabled: true, Revision: 1}}, ArchiveMirrors: []ArchiveMirror{{NodeID: "n", NodeRevision: 1, VersionID: "v", State: "uploading"}}})
	job := s.Catalog.ArchiveMirrors[0]
	if err := s.finishMirror(job, "", errMirrorVerification); err != nil {
		t.Fatal(err)
	}
	m := s.Catalog.ArchiveMirrors[0]
	if m.State != "failed" || m.Attempts != 1 || !m.RetryAt.After(time.Now()) || m.ErrorCode != "mirror_verification_failed" {
		t.Fatalf("failure: %+v", m)
	}
	reloaded, err := NewStore(s.DataDir, Catalog{})
	if err != nil || reloaded.Catalog.ArchiveMirrors[0].Attempts != 1 {
		t.Fatal("retry state not persisted")
	}
}
