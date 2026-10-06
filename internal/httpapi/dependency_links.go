package httpapi

func resolveDependencyLink(c Catalog, name string) string {
	if name == "" {
		return ""
	}
	matches := map[string]bool{}
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
				matches[version.ModID] = true
			}
		}
	}
	if len(matches) != 1 {
		return ""
	}
	for id := range matches {
		return id
	}
	return ""
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
			dep.LinkedModID = resolveDependencyLink(c, name)
		}
	}
	return version
}
