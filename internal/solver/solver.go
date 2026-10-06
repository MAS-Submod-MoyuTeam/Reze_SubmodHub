package solver

import (
	"regexp"
	"sort"
	"strings"

	"github.com/Masterminds/semver/v3"
)

type Dependency struct {
	ModID, Range string
	Required     bool
}
type Installed struct {
	ModID, Version     string
	Priority, Sequence int
	Dependencies       []Dependency
	Files              map[string]string
}
type Change struct{ Path, Action, PreviousOwner, NextOwner, PreviousHash, NextHash, Reason string }
type Blocker struct{ Code, Message, ModID string }
type Plan struct {
	Kind, ModID, Version string
	Changes              []Change
	Blockers             []Blocker
	Warnings             []string
}
type InstallRequest struct {
	ModID, Version string
	Priority       int
	Dependencies   []Dependency
	Files          map[string]string
}
type Owner struct {
	ModID, Version, Hash string
	Priority, Sequence   int
}

func nextSequence(ms []Installed) int {
	n := 0
	for _, m := range ms {
		if m.Sequence > n {
			n = m.Sequence
		}
	}
	return n + 1
}

func Effective(installed []Installed) map[string]Owner {
	result := map[string]Owner{}
	for _, m := range installed {
		for p, h := range m.Files {
			o := Owner{m.ModID, m.Version, h, m.Priority, m.Sequence}
			old, ok := result[p]
			if !ok || o.Priority > old.Priority || (o.Priority == old.Priority && (o.Sequence > old.Sequence || (o.Sequence == old.Sequence && o.ModID > old.ModID))) {
				result[p] = o
			}
		}
	}
	return result
}

func PlanInstall(req InstallRequest, installed []Installed) (Plan, error) {
	p := Plan{Kind: "install", ModID: req.ModID, Version: req.Version}
	byID := map[string][]Installed{}
	for _, m := range installed {
		byID[m.ModID] = append(byID[m.ModID], m)
	}
	for _, d := range req.Dependencies {
		if !d.Required {
			continue
		}
		ok := false
		for _, m := range byID[d.ModID] {
			if satisfies(m.Version, d.Range) {
				ok = true
				break
			}
		}
		if !ok {
			p.Blockers = append(p.Blockers, Blocker{"dependency_missing", "required dependency is not installed", d.ModID})
		}
	}
	old := Effective(installed)
	next := append(append([]Installed{}, installed...), Installed{ModID: req.ModID, Version: req.Version, Priority: req.Priority, Sequence: nextSequence(installed), Files: req.Files})
	new := Effective(next)
	paths := map[string]bool{}
	for x := range old {
		paths[x] = true
	}
	for x := range new {
		paths[x] = true
	}
	for path := range paths {
		a, aok := old[path]
		b, bok := new[path]
		if aok && bok && a.ModID == b.ModID && a.Hash == b.Hash {
			continue
		}
		c := Change{Path: path, Reason: "priority stack"}
		if aok {
			c.PreviousOwner = a.ModID
			c.PreviousHash = a.Hash
		}
		if bok {
			c.NextOwner = b.ModID
			c.NextHash = b.Hash
			c.Action = "write"
		} else {
			c.Action = "remove"
		}
		p.Changes = append(p.Changes, c)
	}
	sort.Slice(p.Changes, func(i, j int) bool { return p.Changes[i].Path < p.Changes[j].Path })
	return p, nil
}

func satisfies(v, r string) bool {
	if r == "" || r == "*" {
		return true
	}
	if match := openRange.FindStringSubmatch(r); match != nil {
		r = ">" + match[1] + " <" + match[2]
	}
	if !strings.ContainsAny(r, "<>=!~^*") {
		r = ">=" + r
	}
	constraint, err := semver.NewConstraint(r)
	if err != nil {
		return false
	}
	parsed, err := semver.NewVersion(v)
	return err == nil && constraint.Check(parsed)
}

var openRange = regexp.MustCompile(`^\s*([^\s<>]+)\s*<\s*[Xx]\s*<\s*([^\s<>]+)\s*$`)
