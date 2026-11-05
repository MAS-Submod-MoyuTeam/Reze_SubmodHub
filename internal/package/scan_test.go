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

func TestParseSubmodsComprehensive(t *testing.T) {
	// 1. Multiple registrations in one file
	multi := `
# Commented out fake registration:
# Submod(name="Fake", version="0.0.1")

init -990 python:
    store.mas_submod_utils.Submod(
        author="Author A",
        name="Mod Alpha",
        version="1.0.0"
    )

    Submod(
        author="Author B",
        name="Mod Beta",
        version="2.1.0"
    )
"""
Docstring mentioning Submod(name="TripleDoc", version="9.9.9")
"""
'''
Single quote docstring Submod(name="SingleTriple", version="8.8.8")
'''
`
	regs := ParseSubmods("multi.rpy", []byte(multi))
	if len(regs) != 2 {
		t.Fatalf("expected 2 registrations, got %d: %+v", len(regs), regs)
	}
	if regs[0].Name != "Mod Alpha" || regs[0].Author != "Author A" || regs[0].Version != "1.0.0" || regs[0].Unknown {
		t.Errorf("first reg mismatch: %+v", regs[0])
	}
	if regs[1].Name != "Mod Beta" || regs[1].Author != "Author B" || regs[1].Version != "2.1.0" || regs[1].Unknown {
		t.Errorf("second reg mismatch: %+v", regs[1])
	}

	// 2. Dynamic name -> Unknown: true
	dynamic := `Submod(name=dynamic_name_var, version="1.0.0")`
	dynRegs := ParseSubmods("dyn.rpy", []byte(dynamic))
	if len(dynRegs) != 1 || !dynRegs[0].Unknown {
		t.Fatalf("expected 1 unknown registration for dynamic name, got %+v", dynRegs)
	}

	// 3. Corrupt / unclosed parenthesis -> Unknown: true
	unclosed := `init python:
    store.mas_submod_utils.Submod(author="Broken", name="Unclosed"`
	unclosedRegs := ParseSubmods("unclosed.rpy", []byte(unclosed))
	if len(unclosedRegs) != 1 || !unclosedRegs[0].Unknown {
		t.Fatalf("expected unknown for unclosed registration, got %+v", unclosedRegs)
	}

	// 4. Over limit (> 2MB) -> single unknown registration
	huge := make([]byte, (2<<20)+10)
	copy(huge, []byte("Submod(name='Huge', version='1.0.0')"))
	hugeRegs := ParseSubmods("huge.rpy", huge)
	if len(hugeRegs) != 1 || !hugeRegs[0].Unknown {
		t.Fatalf("expected unknown registration for oversized file, got %+v", hugeRegs)
	}
}

// A ZIP built on Windows stores `game\Submods\x.rpy`. The MAS layout is the same
// archive as far as the user is concerned, so the scanner reads it instead of
// rejecting the whole package on a separator. The real outfit-selector release
// also carries the bare directory entry `game\Submods\`, whose trailing
// separator must not reach validation (it rejects empty segments).
func TestScanNormalizesWindowsSeparators(t *testing.T) {
	b := archive(t, map[string]string{
		`game\Submods\Outfit Selector\kventis_outfits.rpy`: "init python:\n    pass\n",
		`game\Submods\`: "",
	})
	r, err := Scan(bytes.NewReader(b), int64(len(b)), Limits{})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Files) != 1 || r.Files[0].Target != "Submods/Outfit Selector/kventis_outfits.rpy" {
		t.Fatalf("report: %+v", r)
	}
	// The source keeps the archive's own spelling: clients open the entry by it.
	if r.Files[0].Source != `game\Submods\Outfit Selector\kventis_outfits.rpy` {
		t.Fatalf("source = %q, want the original entry name", r.Files[0].Source)
	}
	// The directory entry is layout, not content: it must not be reported as an
	// unsupported file the user has to acknowledge.
	if len(r.Unsupported) != 0 {
		t.Fatalf("unsupported = %v", r.Unsupported)
	}
}

// Normalizing separators must not open the door to traversal: the Windows
// spelling of `..` resolves to the same escape and is still refused.
func TestScanRejectsWindowsStyleTraversal(t *testing.T) {
	for _, name := range []string{`..\evil.rpy`, `game\..\..\evil.rpy`, `C:\evil.rpy`} {
		b := archive(t, map[string]string{name: "x"})
		if _, err := Scan(bytes.NewReader(b), int64(len(b)), Limits{}); err == nil {
			t.Fatalf("accepted %q", name)
		}
	}
}

// The other shape a published submod takes: one folder of scripts the user is told
// to drop into `game/Submods/` (real case: MonikA.I's `AI_submod.zip`). No MAS root
// is spelled anywhere inside, so the folder itself supplies the submod directory.
func TestScanAcceptsDropInSubmodFolder(t *testing.T) {
	b := archive(t, map[string]string{
		"AI_submod/monikai_actions.rpy":     "init python:\n    pass\n",
		"AI_submod/audio/test.ogg":          "ogg",
		"AI_submod/tl/spanish/dialogue.rpy": "translate spanish strings:\n    pass\n",
	})
	r, err := Scan(bytes.NewReader(b), int64(len(b)), Limits{})
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Unsupported) != 0 {
		t.Fatalf("unsupported = %v", r.Unsupported)
	}
	want := map[string]string{
		"Submods/AI_submod/monikai_actions.rpy":     "init python:\n    pass\n",
		"Submods/AI_submod/audio/test.ogg":          "ogg",
		"Submods/AI_submod/tl/spanish/dialogue.rpy": "translate spanish strings:\n    pass\n",
	}
	if len(r.Files) != len(want) {
		t.Fatalf("files = %+v", r.Files)
	}
	for _, f := range r.Files {
		if _, ok := want[f.Target]; !ok {
			t.Fatalf("unexpected target %q (all: %+v)", f.Target, r.Files)
		}
	}
}

// The drop-in rule must not swallow a GitHub source archive: its wrapper folder
// carries the commit or branch in the name, and its top level holds the repository
// (README, mod/, docs/), not the scripts of one submod.
func TestScanDoesNotTreatArchiveRootAsSubmodFolder(t *testing.T) {
	for _, root := range []string{"mas-logscreen-bfbe30c", "some-repo-master"} {
		files := map[string]string{
			root + "/header.rpy":     "init python:\n    pass\n",
			root + "/README.md":      "readme",
			root + "/mod/config.rpy": "init python:\n    pass\n",
		}
		b := archive(t, files)
		r, err := Scan(bytes.NewReader(b), int64(len(b)), Limits{})
		if err != nil {
			t.Fatalf("%s: %v", root, err)
		}
		for _, f := range r.Files {
			if strings.HasPrefix(f.Target, "Submods/"+root) {
				t.Fatalf("%s: archive root treated as a submod folder: %+v", root, r.Files)
			}
		}
	}
}
