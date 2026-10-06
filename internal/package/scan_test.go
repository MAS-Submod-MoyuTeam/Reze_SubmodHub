package packagezip

import (
	"archive/zip"
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestExternalDialoguePacksSample(t *testing.T) {
	name := os.Getenv("SUBMODHUB_SAMPLE_ZIP")
	if name == "" {
		t.Skip("set SUBMODHUB_SAMPLE_ZIP to check the external sample")
	}
	b, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	report, err := Scan(bytes.NewReader(b), int64(len(b)), Limits{})
	if err != nil {
		t.Fatal(err)
	}
	versions := map[string]bool{}
	for _, registration := range report.Submods {
		if !registration.Unknown && registration.Version != "" {
			versions[registration.Version] = true
		}
	}
	if len(versions) != 1 || !versions["1.27.1"] {
		t.Fatalf("sample versions: %v, registrations: %+v", versions, report.Submods)
	}
	if len(report.Submods) != 1 || report.Submods[0].Name != "话题整合包" || report.Submods[0].Version != "1.27.1" {
		t.Fatalf("sample registration details: %+v", report.Submods)
	}
}

func archive(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for name, data := range files {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = f.Write([]byte(data)); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestScanMAICAAndUnsupported(t *testing.T) {
	b := archive(t, map[string]string{
		"MAICA/game/Submods/MAICA/main.rpy":   "init -1 python:\n    mod = Submod(name=\"MAICA\", version=\"1.0\")",
		"MAICA/game/python-packages/maica.py": "pass",
		"MAICA/README.md":                     "readme",
	})
	r, err := Scan(bytes.NewReader(b), int64(len(b)), Limits{})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Files) != 2 || len(r.Unsupported) != 1 {
		t.Fatalf("unexpected report: %+v", r)
	}
	if r.Files[0].Target != "Submods/MAICA/main.rpy" && r.Files[1].Target != "Submods/MAICA/main.rpy" {
		t.Fatalf("missing submod: %+v", r.Files)
	}
	if len(r.Submods) != 1 || r.Submods[0].Name != "MAICA" {
		t.Fatalf("registration: %+v", r.Submods)
	}
}

func TestScanRejectsUnsafeAndCollidingEntries(t *testing.T) {
	for _, files := range []map[string]string{
		{"../evil.rpy": "x"},
		{"Submods/CON/x.rpy": "x"},
		{"Submods/A.rpy": "x", "Submods/a.rpy": "y"},
		{"Submods/é.rpy": "x", "Submods/e\u0301.rpy": "y"},
	} {
		b := archive(t, files)
		if _, err := Scan(bytes.NewReader(b), int64(len(b)), Limits{}); err == nil {
			t.Errorf("accepted %v", files)
		}
	}
}

func TestScanLimits(t *testing.T) {
	b := archive(t, map[string]string{"a.rpy": strings.Repeat("A", 2000)})
	for _, limits := range []Limits{{MaxEntries: 0, MaxUncompressedBytes: 100}, {MaxEntries: 1, MaxCompressionRatio: 2}} {
		if _, err := Scan(bytes.NewReader(b), int64(len(b)), limits); err == nil {
			t.Errorf("accepted with %+v", limits)
		}
	}
}

func TestSpriteMetadataAndConflicts(t *testing.T) {
	b := archive(t, map[string]string{
		"game/mod_assets/monika/j/a.json": `{"name":"ribbon", "giftname":"red_ribbon"}`,
		"game/mod_assets/monika/j/b.json": `{"name":"ribbon", "giftname":"blue_ribbon"}`,
	})
	r, err := Scan(bytes.NewReader(b), int64(len(b)), Limits{})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Sprites) != 2 || len(r.Conflicts) == 0 {
		t.Fatalf("unexpected sprite report: %+v", r)
	}
	if len(r.Derived) != 2 {
		t.Fatalf("expected gift outputs: %+v", r.Derived)
	}
}

func TestComplexRegistrationIsUnknown(t *testing.T) {
	b := archive(t, map[string]string{"game/Submods/x.rpy": `Submod(name=get_name(), version="1")`})
	r, err := Scan(bytes.NewReader(b), int64(len(b)), Limits{})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Submods) != 1 || !r.Submods[0].Unknown {
		t.Fatalf("expected unknown: %+v", r.Submods)
	}
}

func TestNamespacedMultilineSubmodVersion(t *testing.T) {
	b := archive(t, map[string]string{"game/Submods/Dialogue Packs/head.rpy": "init -990 python:\n    store.mas_submod_utils.Submod(\n        author=\"P\",\n        name=\"话题整合包\",\n        version='1.27.1',\n    )\n"})
	r, err := Scan(bytes.NewReader(b), int64(len(b)), Limits{})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Submods) != 1 || r.Submods[0].Version != "1.27.1" || r.Submods[0].Author != "P" {
		t.Fatalf("registration: %+v", r.Submods)
	}
}

func TestScanLiteralSubmodDependencies(t *testing.T) {
	b := archive(t, map[string]string{"game/Submods/Example/main.rpy": `init python:
    store.mas_submod_utils.Submod(
        author="P", name="Example", version="1.2.3",
        dependencies={"Core Library": ("1.0.0", "2.0.0"), "Extra": (None, "3.0.0")},
    )`})
	r, err := Scan(bytes.NewReader(b), int64(len(b)), Limits{})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Submods) != 1 || r.Submods[0].Version != "1.2.3" || len(r.Submods[0].Dependencies) != 2 {
		t.Fatalf("registration: %+v", r.Submods)
	}
	if d := r.Submods[0].Dependencies[0]; d.Name != "Core Library" || d.Minimum != "1.0.0" || d.Maximum != "2.0.0" {
		t.Fatalf("first dependency: %+v", d)
	}
	if d := r.Submods[0].Dependencies[1]; d.Name != "Extra" || d.Minimum != "" || d.Maximum != "3.0.0" {
		t.Fatalf("second dependency: %+v", d)
	}
}

func TestRegistrationIgnoresDialogueExamples(t *testing.T) {
	b := archive(t, map[string]string{
		"game/Submods/head.rpy":   "init python:\n    store.mas_submod_utils.Submod(name='Real', version='1.27.1')\n",
		"game/Submods/lesson.rpy": "call mas_wx_cmd(\"# store.mas_submod_utils.Submod(name='Example', version='1.0.0')\")\n",
	})
	r, err := Scan(bytes.NewReader(b), int64(len(b)), Limits{})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Submods) != 1 || r.Submods[0].Version != "1.27.1" {
		t.Fatalf("registrations: %+v", r.Submods)
	}
}

func TestScanRejectsAmbiguousRootsAndTargetCollisions(t *testing.T) {
	for _, files := range []map[string]string{
		{"A/game/Submods/a.rpy": "a", "B/game/Submods/b.rpy": "b"},
		{"game/Submods/a.rpy": "a", "Submods/a.rpy": "b"},
		{"a.rpy": "a", "Submods/UnGroupScripts/a.rpy": "b"},
	} {
		b := archive(t, files)
		if _, err := Scan(bytes.NewReader(b), int64(len(b)), Limits{}); err == nil {
			t.Errorf("accepted %v", files)
		}
	}
}
