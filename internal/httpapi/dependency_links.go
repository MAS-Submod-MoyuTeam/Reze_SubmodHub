package httpapi

import "sort"

func resolveDependencyLink(c Catalog, name string) string {
	matches := resolveDependencyLinks(c, name)
	if len(matches) != 1 {
		return ""
	}
	return matches[0]
}

func resolveDependencyLinks(c Catalog, name string) []string {
	if name == "" {
		return nil
	}
	// Lower scores are preferred: a scan with exactly one registration is a
	// stronger identity signal than a package that registers several submods.
	scores := map[string]int{}
	for _, version := range c.Versions {
		if version.State != "published" {
			continue
		}
		report, ok := c.ScanReports[version.ScanReportID]
		if !ok {
			continue
		}
		for _, registration := range report.Submods {
			if !registration.Unknown && registration.Name == name {
				score := 1
				if len(report.Submods) == 1 {
					score = 0
				}
				if previous, ok := scores[version.ModID]; !ok || score < previous {
					scores[version.ModID] = score
				}
			}
		}
	}
	bestScore := 2
	for _, score := range scores {
		if score < bestScore {
			bestScore = score
		}
	}
	matches := make([]string, 0, len(scores))
	for id, score := range scores {
		if score == bestScore {
			matches = append(matches, id)
		}
	}
	sort.Strings(matches)
	return matches
}

func resolveVersionDependencies(c Catalog, version Version) Version {
	version.Dependencies = append([]Dependency(nil), version.Dependencies...)
	for i := range version.Dependencies {
		dep := &version.Dependencies[i]
		if dep.LinkedModID == "" {
			name := dep.ModTitle
			if name == "" {
				name = dep.ModID
			}
			dep.LinkedModIDs = resolveDependencyLinks(c, name)
			if len(dep.LinkedModIDs) == 1 {
				dep.LinkedModID = dep.LinkedModIDs[0]
			}
		}
	}
	return version
}
