package install

import (
	"os"
	"path/filepath"
	"testing"
)

func writeArtifact(t *testing.T, root, rel string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte("compiled"), 0o644); err != nil {
		t.Fatal(err)
	}
}

// Every artifact the forward naming rule can produce for a managed source must be
// in the owned set, including cache entries of modules whose name contains a dot.
func TestDerivedArtifactKeysCollectsWhatManagedSourcesProduce(t *testing.T) {
	root := t.TempDir()
	artifacts := []string{
		"game/Submods/Demo/main.rpyc",
		"game/Submods/Demo/module.rpymc",
		"game/python-packages/demo_lib.pyc",
		"game/python-packages/demo_lib.pyo",
		"game/python-packages/__pycache__/demo_lib.cpython-311.pyc",
		"game/Submods/Demo/__pycache__/helper.cpython-312.opt-1.pyc",
		"game/Submods/Dotted/__pycache__/helper.foo.cpython-311.pyc",
	}
	for _, rel := range artifacts {
		writeArtifact(t, root, rel)
	}
	sources := []string{
		"game/Submods/Demo/main.rpy",
		"game/Submods/Demo/module.rpym",
		"game/python-packages/demo_lib.py",
		"game/Submods/Demo/helper.py",
		"game/Submods/Dotted/helper.foo.py",
	}

	got := DerivedArtifactKeys(root, sources)
	for _, rel := range artifacts {
		if !got[manifestCanonicalKey(rel)] {
			t.Errorf("owned set is missing %q: %v", rel, got)
		}
	}
	if len(got) != len(artifacts) {
		t.Errorf("owned set has %d entries, want %d: %v", len(got), len(artifacts), got)
	}
}

// Callers hand in canonical ledger keys, which are lowercased on Windows, while
// CPython keeps the module's original casing in __pycache__. A case-sensitive
// prefix comparison would leave every mixed-case module's bytecode unowned.
func TestDerivedArtifactKeysMatchesPycacheCaseInsensitively(t *testing.T) {
	root := t.TempDir()
	artifact := "game/Submods/Demo/__pycache__/Helper.cpython-311.pyc"
	writeArtifact(t, root, artifact)

	got := DerivedArtifactKeys(root, []string{"game/Submods/Demo/helper.py"})
	if !got[manifestCanonicalKey(artifact)] {
		t.Fatalf("mixed-case module bytecode must belong to its canonical source: %v", got)
	}
	if len(got) != 1 {
		t.Fatalf("expected only the module's own bytecode, got %v", got)
	}
}

// Ownership follows the source, not the directory or the file name: an artifact
// whose source is outside the managed set stays unowned no matter how similar
// its name is to a managed one.
func TestDerivedArtifactKeysLeavesArtifactsOfUnmanagedSourcesAlone(t *testing.T) {
	root := t.TempDir()
	writeArtifact(t, root, "game/Submods/Loose/main.rpyc")
	writeArtifact(t, root, "game/Submods/Demo/__pycache__/helper.cpython-311.pyc")

	got := DerivedArtifactKeys(root, []string{"game/Submods/Demo/other.rpy"})
	if len(got) != 0 {
		t.Fatalf("expected no owned artifacts, got %v", got)
	}
}

// A managed source with no compiled output on disk must not claim anything, and
// keys that are not compilable sources contribute nothing at all.
func TestDerivedArtifactKeysNeedsBothAManagedSourceAndAnExistingArtifact(t *testing.T) {
	root := t.TempDir()
	writeArtifact(t, root, "game/Submods/Demo/main.rpyc")

	if got := DerivedArtifactKeys(root, nil); len(got) != 0 {
		t.Fatalf("expected no owned artifacts for no sources, got %v", got)
	}
	if got := DerivedArtifactKeys(root, []string{"game/Submods/Demo/icon.png", "game/Submods/Demo/main.rpyc"}); len(got) != 0 {
		t.Fatalf("expected non-source keys to contribute nothing, got %v", got)
	}
}

// A source whose artifact was never generated (or was already cleaned up) owns
// nothing, so the scan keeps reporting whatever else the directory holds.
func TestDerivedArtifactKeysIgnoresMissingArtifacts(t *testing.T) {
	root := t.TempDir()
	if got := DerivedArtifactKeys(root, []string{"game/Submods/Demo/main.rpy"}); len(got) != 0 {
		t.Fatalf("expected no owned artifacts without compiled output, got %v", got)
	}
}
