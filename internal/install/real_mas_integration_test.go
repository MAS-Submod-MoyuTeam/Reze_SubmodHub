//go:build mas_integration

package install

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRealMASDisposableMarkerWriteAndRemove(t *testing.T) {
	root := os.Getenv("SUBMODHUB_MAS_ROOT")
	if root == "" { root = `E:\MAS_Cn001280\MAS_CN0012F0` }
	root = filepath.Clean(root)
	if _, err := os.Stat(filepath.Join(root, "game", "Submods")); err != nil { t.Fatalf("MAS Submods directory unavailable: %v", err) }
	name := "SubmodHub_Test_" + time.Now().UTC().Format("20060102_150405.000000000")
	rel := filepath.ToSlash(filepath.Join("game", "Submods", name, "README.txt"))
	path := filepath.Join(root, filepath.FromSlash(rel))
	if _, err := os.Stat(path); err == nil { t.Fatal("unique integration marker already exists") }
	t.Cleanup(func() { _ = os.RemoveAll(filepath.Dir(path)) })
	state := filepath.Join(root, ".submodhub", "integration-state")
	t.Cleanup(func() { _ = os.RemoveAll(state) })
	i := New(root, state)
	content := []byte("SubmodHub disposable integration marker\n")
	if err := i.Apply(Operation{ID: "real_" + name, Changes: []Change{{Path: rel, Content: content}}}); err != nil { t.Fatal(err) }
	got, err := os.ReadFile(path); if err != nil || string(got) != string(content) { t.Fatalf("write mismatch: %v %q", err, got) }
	if err := i.Apply(Operation{ID: "remove_" + name, Changes: []Change{{Path: rel, Remove: true, ExpectedSHA256: hashBytes(content)}}}); err != nil { t.Fatal(err) }
	if _, err := os.Stat(path); !os.IsNotExist(err) { t.Fatalf("marker was not removed: %v", err) }
}
