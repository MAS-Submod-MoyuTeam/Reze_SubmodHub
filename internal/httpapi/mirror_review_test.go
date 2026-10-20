package httpapi

import (
	"strings"
	"testing"
)

func TestMirrorCorruptionChangesObjectIdentityWithoutDeleting(t *testing.T) {
	job := ArchiveMirror{NodeID: "n", NodeRevision: 1, VersionID: "v", SHA256: "hash", State: "uploading", ObjectName: "m-v-hash.zip"}
	s, _ := NewStore(t.TempDir(), Catalog{DeliveryNodes: []DeliveryNode{{ID: "n", Enabled: true, Revision: 1}}, ArchiveMirrors: []ArchiveMirror{job}})
	if err := s.finishMirror(job, "", errMirrorVerification); err != nil {
		t.Fatal(err)
	}
	got := s.Catalog.ArchiveMirrors[0]
	if got.ObjectName == job.ObjectName || !strings.Contains(got.ObjectName, "-hash-") {
		t.Fatalf("corrupt object reused: %+v", got)
	}
}
func TestMirrorReconcilePrunesUnserviceableMetadata(t *testing.T) {
	s, _ := NewStore(t.TempDir(), Catalog{Mods: []Mod{{ID: "m", LatestVersionID: "current"}}, Versions: map[string]Version{"old": {ID: "old", ModID: "m", State: "published", SourceType: "github_releases", SHA256: "old", ArchivePath: "old.zip"}}, DeliveryNodes: []DeliveryNode{{ID: "n", Type: "cloudreve", Enabled: true}}, ArchiveMirrors: []ArchiveMirror{{NodeID: "deleted", VersionID: "old", State: "ready"}, {NodeID: "n", VersionID: "old", State: "ready"}}})
	if err := s.reconcileMirrors(false); err != nil {
		t.Fatal(err)
	}
	if len(s.Catalog.ArchiveMirrors) != 0 {
		t.Fatal("obsolete metadata retained")
	}
}
