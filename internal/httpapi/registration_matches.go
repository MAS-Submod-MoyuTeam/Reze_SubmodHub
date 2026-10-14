package httpapi

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
)

const (
	MaxMatchNamesRequest = 128
	MaxMatchNameLength   = 256
)

type MatchRegistrationsRequest struct {
	Names []string `json:"names"`
}

type RegistrationCandidate struct {
	ModID         string   `json:"mod_id"`
	Title         string   `json:"title"`
	Priority      string   `json:"priority"` // "single_registration" | "multi_registration"
	Score         int      `json:"score"`    // 0: single, 1: multi
	Registrations []string `json:"registrations"`
	Evidence      []string `json:"evidence"` // Version and registration source evidence
	Reason        string   `json:"reason"`
}

type RegistrationMatchResult struct {
	Name       string                  `json:"name"`
	Status     string                  `json:"status"` // "matched" | "ambiguous" | "no_match"
	Candidates []RegistrationCandidate `json:"candidates"`
}

type MatchRegistrationsResponse struct {
	Results []RegistrationMatchResult `json:"results"`
}

// findRegistrationMatches searches the published catalog for candidate mods matching each given name.
func findRegistrationMatches(c Catalog, names []string) []RegistrationMatchResult {
	results := make([]RegistrationMatchResult, 0, len(names))
	for _, rawName := range names {
		name := strings.TrimSpace(rawName)
		if name == "" {
			results = append(results, RegistrationMatchResult{
				Name:       rawName,
				Status:     "no_match",
				Candidates: []RegistrationCandidate{},
			})
			continue
		}

		// candidateModMap: modID -> candidate
		type candidateBuilder struct {
			modID         string
			title         string
			bestScore     int // 0: single, 1: multi
			registrations map[string]bool
			evidenceMap   map[string]bool
		}

		modMap := make(map[string]*candidateBuilder)

		for _, version := range c.Versions {
			if version.State != "published" {
				continue
			}
			report, ok := c.ScanReports[version.ScanReportID]
			if !ok {
				continue
			}

			// Check if this version matches the target name
			hasTargetName := false
			hasUnknownReg := false
			for _, reg := range report.Submods {
				if reg.Unknown {
					hasUnknownReg = true
				}
				if !reg.Unknown && reg.Name == name {
					hasTargetName = true
				}
			}

			if !hasTargetName {
				continue
			}

			// Rule: Single-registration priority applies if and only if:
			// len(report.Submods) == 1 and no unknown registrations!
			score := 1
			if len(report.Submods) == 1 && !hasUnknownReg {
				score = 0
			}

			cb, exists := modMap[version.ModID]
			if !exists {
				title := version.ModID
				// Try to get title from Mod metadata
				for _, m := range c.Mods {
					if m.ID == version.ModID && m.Title != "" {
						title = m.Title
						break
					}
				}
				cb = &candidateBuilder{
					modID:         version.ModID,
					title:         title,
					bestScore:     score,
					registrations: make(map[string]bool),
					evidenceMap:   make(map[string]bool),
				}
				modMap[version.ModID] = cb
			} else {
				if score < cb.bestScore {
					cb.bestScore = score
				}
			}

			for _, reg := range report.Submods {
				if !reg.Unknown && reg.Name != "" {
					cb.registrations[reg.Name] = true
				}
			}
			vName := version.Version
			if vName == "" {
				vName = version.ID
			}
			cb.evidenceMap["v"+vName] = true
		}

		if len(modMap) == 0 {
			results = append(results, RegistrationMatchResult{
				Name:       name,
				Status:     "no_match",
				Candidates: []RegistrationCandidate{},
			})
			continue
		}

		// Find best score across all candidates
		bestOverallScore := 2
		for _, cb := range modMap {
			if cb.bestScore < bestOverallScore {
				bestOverallScore = cb.bestScore
			}
		}

		var candidates []RegistrationCandidate
		for _, cb := range modMap {
			var regList []string
			for r := range cb.registrations {
				regList = append(regList, r)
			}
			sort.Strings(regList)

			var evList []string
			for ev := range cb.evidenceMap {
				evList = append(evList, ev)
			}
			sort.Strings(evList)

			prio := "multi_registration"
			reason := "matches published version with multiple registrations"
			if cb.bestScore == 0 {
				prio = "single_registration"
				reason = "matches published version with a single registration"
			}

			candidates = append(candidates, RegistrationCandidate{
				ModID:         cb.modID,
				Title:         cb.title,
				Priority:      prio,
				Score:         cb.bestScore,
				Registrations: regList,
				Evidence:      evList,
				Reason:        reason,
			})
		}

		// Sort candidates:
		// 1. Score ascending (0 before 1)
		// 2. ModID ascending
		sort.Slice(candidates, func(i, j int) bool {
			if candidates[i].Score != candidates[j].Score {
				return candidates[i].Score < candidates[j].Score
			}
			return candidates[i].ModID < candidates[j].ModID
		})

		// Filter top tier candidates:
		// If top tier has score 0 (single_registration):
		// - If exactly 1 candidate with score 0 -> matched
		// - If > 1 candidate with score 0 -> ambiguous
		// If top tier has score 1 (multi_registration):
		// - If exactly 1 candidate -> matched
		// - If > 1 candidate -> ambiguous
		topCandidates := make([]RegistrationCandidate, 0)
		for _, c := range candidates {
			if c.Score == bestOverallScore {
				topCandidates = append(topCandidates, c)
			}
		}

		status := "matched"
		if len(topCandidates) > 1 {
			status = "ambiguous"
		}

		results = append(results, RegistrationMatchResult{
			Name:       name,
			Status:     status,
			Candidates: candidates, // Return all candidates with scores & priorities
		})
	}

	return results
}

func (s *Store) handleMatchRegistrations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		return
	}

	var req MatchRegistrationsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "invalid json request body")
		return
	}

	if len(req.Names) > MaxMatchNamesRequest {
		writeError(w, http.StatusBadRequest, "limit_exceeded", "too many names in request")
		return
	}

	// Deduplicate names while preserving order
	seen := make(map[string]bool)
	var deduped []string
	for _, n := range req.Names {
		if len(n) > MaxMatchNameLength {
			writeError(w, http.StatusBadRequest, "name_too_long", "name exceeds max length")
			return
		}
		if !seen[n] {
			seen[n] = true
			deduped = append(deduped, n)
		}
	}

	s.mu.RLock()
	c := s.Catalog
	s.mu.RUnlock()

	results := findRegistrationMatches(c, deduped)
	writeJSON(w, http.StatusOK, MatchRegistrationsResponse{Results: results})
}
