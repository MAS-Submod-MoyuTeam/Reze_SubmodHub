package solver

import "testing"

func TestPlanResolvesPriorityAndBlocksDependency(t *testing.T) {
	mods := []Installed{{ModID: "base", Version: "1.0.0", Priority: 1, Files: map[string]string{"Submods/a.rpy": "a"}}, {ModID: "top", Version: "1.0.0", Priority: 2, Dependencies: []Dependency{{ModID: "missing", Range: ">=1.0.0", Required: true}}, Files: map[string]string{"Submods/a.rpy": "b"}}}
	p, err := PlanInstall(InstallRequest{ModID: "top", Version: "1.1.0", Files: map[string]string{"Submods/a.rpy": "c"}, Dependencies: mods[1].Dependencies}, mods)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Blockers) != 1 || p.Blockers[0].Code != "dependency_missing" {
		t.Fatalf("%+v", p)
	}
}

func TestEffectiveStackTieUsesSequenceThenID(t *testing.T) {
	mods := []Installed{{ModID: "z", Version: "1.0.0", Priority: 1, Sequence: 1, Files: map[string]string{"x": "z"}}, {ModID: "a", Version: "1.0.0", Priority: 1, Sequence: 2, Files: map[string]string{"x": "a"}}}
	stack := Effective(mods)
	if stack["x"].ModID != "a" {
		t.Fatalf("%+v", stack["x"])
	}
}

func TestSatisfiesOpenDependencyRange(t *testing.T) {
	for _, tc := range []struct {
		version string
		want    bool
	}{
		{"1.0.0", false},
		{"1.0.1", true},
		{"1.5.0", true},
		{"2.0.0", false},
		{"2.1.0", false},
	} {
		if got := satisfies(tc.version, "1.0.0<X<2.0.0"); got != tc.want {
			t.Errorf("version %s: got %v, want %v", tc.version, got, tc.want)
		}
	}
}

func TestSatisfiesCompositeDependencyRange(t *testing.T) {
	for _, tc := range []struct {
		version string
		want    bool
	}{
		{"0.9.9", false}, {"1.0.0", true}, {"1.5.0", true}, {"2.0.0", true}, {"2.0.1", false},
	} {
		if got := satisfies(tc.version, ">=1.0.0 <=2.0.0"); got != tc.want {
			t.Errorf("version %s: got %v, want %v", tc.version, got, tc.want)
		}
	}
}

func TestSatisfiesEmptyDependencyRange(t *testing.T) {
	if !satisfies("1.0.0", "") || !satisfies("1.0.0", "*") {
		t.Fatal("empty and wildcard ranges must be unrestricted")
	}
}
