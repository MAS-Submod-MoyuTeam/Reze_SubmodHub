package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	core "github.com/reze/submodhub/internal/install"
	packagezip "github.com/reze/submodhub/internal/package"
)

type AdoptRequest struct {
	InstanceID             string   `json:"instance_id"`
	ScanItemID             string   `json:"scan_item_id"`
	ModID                  string   `json:"mod_id"`
	CandidateID            string   `json:"candidate_id,omitempty"`
	CandidateRegistrations []string `json:"candidate_registrations,omitempty"`
	VersionID              string   `json:"version_id"`
	Version                string   `json:"version"`
	Title                  string   `json:"title"`
	Priority               int      `json:"priority"`
	Files                  []string `json:"files"` // Chosen paths to adopt
}

var ErrCandidateRegistrationIdentityMismatch = errors.New("candidate_registration_identity_mismatch")

func normalizeAdoptPathKey(p string) string {
	clean := filepath.ToSlash(filepath.Clean(p))
	clean = strings.TrimPrefix(clean, "/")
	clean = strings.TrimPrefix(clean, "\\")
	if strings.HasPrefix(strings.ToLower(clean), "game/") {
		clean = clean[5:]
	}
	return strings.ToLower(clean)
}

func (s *DesktopService) fetchTrustedCandidateRegistrationsLocked(candidateID string) ([]string, error) {
	if strings.TrimSpace(candidateID) == "" {
		return nil, errors.New("candidate_id_required")
	}

	resolver := s.candidateRegistrationsResolver
	apiURL := s.apiURL

	if resolver != nil {
		return resolver(candidateID)
	}

	apiURL = strings.TrimRight(apiURL, "/")
	if apiURL == "" {
		return nil, errors.New("store API URL is not configured")
	}

	reqURL := fmt.Sprintf("%s/api/v1/mods/%s/registrations", apiURL, url.PathEscape(candidateID))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("failed to contact store API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("candidate %q not found in store", candidateID)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("store API returned status %d", resp.StatusCode)
	}

	var data struct {
		ModID         string   `json:"mod_id"`
		Registrations []string `json:"registrations"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("failed to decode store response: %w", err)
	}

	if data.ModID == "" || data.ModID != candidateID {
		return nil, fmt.Errorf("%w: expected mod_id %q, got %q", ErrCandidateRegistrationIdentityMismatch, candidateID, data.ModID)
	}

	return data.Registrations, nil
}

func (s *DesktopService) PreviewAdopt(request AdoptRequest) (PlanResult, error) {
	if err := s.checkStorageAccess(); err != nil {
		return PlanResult{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.core == nil {
		if _, err := s.SetMASRoot(s.root); err != nil {
			return PlanResult{}, err
		}
	}

	// Verify target instance if specified
	if request.InstanceID != "" {
		if s.activeID != "" && s.activeID != request.InstanceID {
			return PlanResult{}, errors.New("instance_mismatch")
		}
	}

	if len(request.Files) == 0 {
		return PlanResult{}, errors.New("no_files_specified")
	}

	manifest, err := s.core.LoadManifest()
	if err != nil {
		return PlanResult{}, err
	}

	// 1. Verify ScanItemID and files scope:
	// All files requested for adoption must belong to a valid scanned item.
	scannedSubmods, scanErr := scanLocalSubmodsCore(s.root, manifest)
	if scanErr != nil {
		return PlanResult{}, fmt.Errorf("failed to scan local submods for verification: %w", scanErr)
	}

	var matchedScanned *LocalSubmod
	for i := range scannedSubmods {
		sc := &scannedSubmods[i]
		if request.ScanItemID != "" && (sc.Directory == request.ScanItemID || sc.ID == request.ScanItemID) {
			matchedScanned = sc
			break
		}
	}

	// If ScanItemID was provided but not found, reject with an error instead of falling back to arbitrary game/Submods/ files.
	if request.ScanItemID != "" && matchedScanned == nil {
		return PlanResult{}, fmt.Errorf("scanned item %q not found or expired", request.ScanItemID)
	}

	// If no ScanItemID was specified, attempt fallback matching by ModID or reject if not identifiable
	if matchedScanned == nil {
		if request.ModID != "" {
			for i := range scannedSubmods {
				sc := &scannedSubmods[i]
				if sc.Directory == request.ModID || sc.ID == request.ModID {
					matchedScanned = sc
					break
				}
			}
		}
		if matchedScanned == nil {
			return PlanResult{}, errors.New("scan_item_id_required")
		}
	}

	// Verify that all requested files actually exist in that scanned item
	validPathSet := make(map[string]bool)
	validNormPathSet := make(map[string]bool)
	for _, f := range matchedScanned.Files {
		validPathSet[canonicalizePathKey(f.Path)] = true
		validNormPathSet[normalizeAdoptPathKey(f.Path)] = true
	}
	for _, reqFile := range request.Files {
		if !validPathSet[canonicalizePathKey(reqFile)] && !validNormPathSet[normalizeAdoptPathKey(reqFile)] {
			dirDesc := matchedScanned.Directory
			if dirDesc == "" {
				dirDesc = matchedScanned.ID
			}
			return PlanResult{}, fmt.Errorf("file %s is not part of scanned item %s", reqFile, dirDesc)
		}
	}

	// Verify registration consistency with candidate / single identity
	regsByCanon := make(map[string][]SubmodRegistration)
	regsByNorm := make(map[string][]SubmodRegistration)
	for _, reg := range matchedScanned.Registrations {
		cKey := canonicalizePathKey(reg.Source)
		nKey := normalizeAdoptPathKey(reg.Source)
		regsByCanon[cKey] = append(regsByCanon[cKey], reg)
		regsByNorm[nKey] = append(regsByNorm[nKey], reg)
	}

	var selectedRegs []SubmodRegistration
	seenRegKey := make(map[string]bool)
	for _, reqFile := range request.Files {
		cKey := canonicalizePathKey(reqFile)
		nKey := normalizeAdoptPathKey(reqFile)
		var matches []SubmodRegistration
		if regs, ok := regsByCanon[cKey]; ok {
			matches = append(matches, regs...)
		} else if regs, ok := regsByNorm[nKey]; ok {
			matches = append(matches, regs...)
		}
		for _, reg := range matches {
			uniqueKey := fmt.Sprintf("%s|%s|%v", reg.Source, reg.Name, reg.Unknown)
			if !seenRegKey[uniqueKey] {
				seenRegKey[uniqueKey] = true
				selectedRegs = append(selectedRegs, reg)
			}
		}
	}

	distinctRegNames := make(map[string]bool)
	hasUnknownReg := false
	for _, reg := range selectedRegs {
		if reg.Unknown {
			hasUnknownReg = true
		} else if trimmed := strings.TrimSpace(reg.Name); trimmed != "" {
			distinctRegNames[trimmed] = true
		}
	}

	if request.CandidateID == "" && len(request.CandidateRegistrations) > 0 {
		return PlanResult{}, errors.New("candidate_registrations provided without candidate_id")
	}
	isCandidateAdoption := request.CandidateID != ""

	if isCandidateAdoption {
		candID := request.CandidateID

		// CandidateID must match ModID if ModID is specified
		if request.ModID != "" && request.ModID != candID {
			return PlanResult{}, fmt.Errorf("candidate_id %q does not match mod_id %q", candID, request.ModID)
		}

		// Obtain trusted candidate registrations from store
		trustedRegistrations, err := s.fetchTrustedCandidateRegistrationsLocked(candID)
		if err != nil {
			return PlanResult{}, fmt.Errorf("cannot adopt as store candidate %q: %w", candID, err)
		}
		if len(trustedRegistrations) == 0 {
			return PlanResult{}, fmt.Errorf("cannot adopt as store candidate %q: store candidate has no verified registrations", candID)
		}

		// Verify that request.CandidateRegistrations does not forge registrations outside trusted store data
		if len(request.CandidateRegistrations) > 0 {
			trustedSet := make(map[string]bool, len(trustedRegistrations))
			for _, tr := range trustedRegistrations {
				trustedSet[strings.TrimSpace(tr)] = true
			}
			for _, cr := range request.CandidateRegistrations {
				if !trustedSet[strings.TrimSpace(cr)] {
					return PlanResult{}, fmt.Errorf("cannot adopt as store candidate %q: request candidate registrations contain unverified identity %q", candID, cr)
				}
			}
		}

		if len(selectedRegs) == 0 {
			return PlanResult{}, fmt.Errorf("cannot adopt as store candidate %q: selected files do not contain verified registration source", candID)
		}
		if hasUnknownReg {
			return PlanResult{}, fmt.Errorf("cannot adopt as store candidate %q: selected files contain unknown or malformed registration", candID)
		}

		matchCandidateReg := func(regName string) bool {
			trimmed := strings.TrimSpace(regName)
			for _, cr := range trustedRegistrations {
				if strings.TrimSpace(cr) == trimmed {
					return true
				}
			}
			return false
		}

		for _, reg := range selectedRegs {
			if !matchCandidateReg(reg.Name) {
				return PlanResult{}, fmt.Errorf("cannot adopt as store candidate %q: selected file %s has registration %q which does not match candidate", candID, reg.Source, reg.Name)
			}
		}

		if len(distinctRegNames) > 1 {
			for name := range distinctRegNames {
				matched := false
				for _, cr := range trustedRegistrations {
					if strings.TrimSpace(cr) == strings.TrimSpace(name) {
						matched = true
						break
					}
				}
				if !matched {
					var names []string
					for n := range distinctRegNames {
						names = append(names, n)
					}
					sort.Strings(names)
					return PlanResult{}, fmt.Errorf("cannot adopt as store candidate %q: selected files contain multiple distinct registrations (%s)", candID, strings.Join(names, ", "))
				}
			}
		}
	} else {
		if len(distinctRegNames) > 1 {
			var names []string
			for n := range distinctRegNames {
				names = append(names, n)
			}
			sort.Strings(names)
			return PlanResult{}, fmt.Errorf("cannot adopt files with multiple registration identities (%s) as a single mod", strings.Join(names, ", "))
		}
	}

	// 2. Establish local baseline and clear unverified VersionID:
	// Since adoption works on manual local unmanaged files without verified store release manifest
	// and file checksum evidence, adoption unconditionally clears VersionID and records a local baseline.
	// We do not preserve unverified store release VersionIDs or guess release evidence by mod name/directory.
	effectiveVersionID := ""
	effectiveVersion := request.Version
	if effectiveVersion == "" {
		if matchedScanned != nil && matchedScanned.Version != "" {
			effectiveVersion = matchedScanned.Version
		} else {
			effectiveVersion = "1.0.0"
		}
	}

	if !strings.HasSuffix(effectiveVersion, "-adopted") && !strings.HasSuffix(effectiveVersion, "-local") {
		effectiveVersion = fmt.Sprintf("%s-adopted", effectiveVersion)
	}

	targetID := request.ModID
	if isCandidateAdoption {
		targetID = request.CandidateID
	} else if targetID == "" {
		targetID = request.ScanItemID
	}
	if targetID == "" {
		targetID = fmt.Sprintf("local_adopt_%d", time.Now().UnixNano())
	}

	opID := fmt.Sprintf("adopt_%d", time.Now().UnixNano())

	adoptedReq := request
	adoptedReq.ModID = targetID
	adoptedReq.VersionID = effectiveVersionID
	adoptedReq.Version = effectiveVersion

	plan, err := core.PlanAdoption(manifest, s.root, s.core.GetBlobs(), core.AdoptOperation{
		OperationID:    opID,
		InstallationID: targetID,
		ModID:          targetID,
		VersionID:      effectiveVersionID,
		Version:        effectiveVersion,
		Title:          request.Title,
		Priority:       request.Priority,
		Files:          request.Files,
	})
	if err != nil {
		return PlanResult{}, err
	}

	s.activePlan = plan
	s.activePlanRequest = adoptedReq
	s.activePlanArchive = nil
	s.activePlanReport = packagezip.Report{}
	s.activePlanHash = [32]byte{}
	s.activePlanArchiveID = ""

	actions := make([]PlanPreviewAction, len(plan.Actions))
	for i, act := range plan.Actions {
		actions[i] = PlanPreviewAction{
			Path:          act.Path,
			Action:        string(act.Action),
			CurrentSource: act.CurrentSource,
			TargetSource:  act.TargetSource,
			CurrentHash:   act.CurrentHash,
		}
	}

	title := request.Title
	if title == "" {
		title = request.ModID
	}
	if title == "" {
		title = request.ScanItemID
	}

	return PlanResult{
		PlanID:      plan.PlanID,
		OperationID: plan.OperationID,
		Root:        plan.Root,
		Generation:  plan.Generation,
		Kind:        "adopt",
		TargetID:    targetID,
		ModTitle:    title,
		Version:     effectiveVersion,
		Priority:    request.Priority,
		Actions:     actions,
		CleanupPaths: plan.CleanupPaths,
		Blockers:    plan.Blockers,
		Risks:       []PlanPreviewRisk{},
		Summary: PlanPreviewSummary{
			MetadataOnly: plan.Summary.MetadataOnly,
		},
	}, nil
}

func (s *DesktopService) projectedAdoptInstalledArchive(request AdoptRequest, plan *core.Plan) ([]InstalledArchive, error) {
	receipts, err := s.ListInstalledArchives()
	if err != nil {
		return nil, err
	}

	// Calculate total size and submod dirs
	var totalSize int64
	submodDirsMap := make(map[string]bool)
	for _, f := range request.Files {
		fullPath := filepath.Join(s.root, filepath.FromSlash(f))
		if info, err := os.Stat(fullPath); err == nil {
			totalSize += info.Size()
		}
		// Extract Submods directory name if under game/Submods/
		rel := filepath.ToSlash(f)
		if strings.HasPrefix(rel, "game/Submods/") {
			parts := strings.Split(strings.TrimPrefix(rel, "game/Submods/"), "/")
			if len(parts) > 1 {
				submodDirsMap[parts[0]] = true
			}
		}
	}
	var submodDirs []string
	for d := range submodDirsMap {
		submodDirs = append(submodDirs, d)
	}
	sort.Strings(submodDirs)

	targetID := request.ModID
	if request.CandidateID != "" {
		targetID = request.CandidateID
	} else if targetID == "" {
		targetID = plan.TargetInstallationID
	}
	title := request.Title
	if title == "" {
		title = targetID
	}

	next := make([]InstalledArchive, 0, len(receipts)+1)
	for _, r := range receipts {
		if r.ModID != targetID {
			next = append(next, r)
		}
	}

	next = append(next, InstalledArchive{
		ModID:       targetID,
		VersionID:   plan.VersionID,
		Version:     plan.Version,
		Title:       title,
		OperationID: plan.OperationID,
		Priority:    request.Priority,
		Files:       len(request.Files),
		SizeBytes:   totalSize,
		SHA256:      "", // Adopted from manual files, no single zip archive hash
		InstalledAt: time.Now().UTC(),
		SubmodDirs:  submodDirs,
	})

	return next, nil
}
