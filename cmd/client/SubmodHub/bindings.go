package main

import (
	"context"
	"encoding/json"
	"time"
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	core "github.com/reze/submodhub/internal/install"
	packagezip "github.com/reze/submodhub/internal/package"
)

type MASStatus struct {
	Root           string `json:"root"`
	GamePath       string `json:"game_path"`
	Valid          bool   `json:"valid"`
	GameExists     bool   `json:"game_exists"`
	Submods        int    `json:"submods"`
	AvailableBytes int64  `json:"available_bytes"`
}

type InstallRequest struct {
	OperationID string `json:"operation_id"`
	Path        string `json:"path"`
	Content     string `json:"content"`
	ExpectedSHA string `json:"expected_sha256"`
}

type ArchiveInstallRequest struct {
	Category      string `json:"category"`
	OperationID   string `json:"operation_id"`
	ArchiveBase64 string `json:"archive_base64,omitempty"`
	ArchiveID     string `json:"archive_id,omitempty"`
	ExpectedSHA   string `json:"expected_sha256"`
	ModID         string `json:"mod_id"`
	VersionID     string `json:"version_id"`
	Version       string `json:"version"`
	Title         string `json:"title"`
	Author        string `json:"author,omitempty"`
	Priority      int    `json:"priority,omitempty"`
}

type ArchiveInstallResult struct {
	State    string   `json:"state"`
	Files    int      `json:"files"`
	Warnings []string `json:"warnings"`
}

type LocalSubmodFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

type LocalSubmod struct {
	Directory string            `json:"directory"`
	Name      string            `json:"name"`
	Author    string            `json:"author,omitempty"`
	Version   string            `json:"version"`
	Files     []LocalSubmodFile `json:"files"`
}

type PlanPreviewAction struct {
	Path           string `json:"path"`
	Action         string `json:"action"` // CREATE, OVERWRITE, REMOVE, RESTORE, METADATA_ONLY
	CurrentSource  string `json:"current_source"`
	TargetSource   string `json:"target_source"`
	CurrentHash    string `json:"current_hash"`
	TargetHash     string `json:"target_hash"`
	CurrentExists  bool   `json:"current_exists"`
	TargetExists   bool   `json:"target_exists"`
	BackupRequired bool   `json:"backup_required"`
	Reason         string `json:"reason"`
}

type PlanPreviewRisk struct {
	Type        string `json:"type"`
	Path        string `json:"path"`
	Description string `json:"description"`
}

type PlanPreviewSummary struct {
	RestoresOriginal int `json:"restores_original"`
	RestoresLayer    int `json:"restores_layer"`
	MetadataOnly     int `json:"metadata_only"`
	DeletesAdded     int `json:"deletes_added"`
	WritesNew        int `json:"writes_new"`
}

type PlanResult struct {
	PlanID     string              `json:"plan_id"`
	Root       string              `json:"root"`
	Generation int64               `json:"generation"`
	Kind       string              `json:"kind"` // install, update, uninstall
	TargetID   string              `json:"target_id"`
	ModTitle   string              `json:"mod_title"`
	Version    string              `json:"version"`
	Actions    []PlanPreviewAction `json:"actions"`
	Blockers   []string            `json:"blockers"`
	Risks      []PlanPreviewRisk   `json:"risks"`
	Summary    PlanPreviewSummary  `json:"summary"`
}

type ExecutePlanRequest struct {
	PlanID    string `json:"plan_id"`
	Confirmed bool   `json:"confirmed"`
}

type DesktopService struct {
	root       string
	state      string
	core       *core.Installer
	configPath string
	instances  []MASInstance
	activeID   string
	loaded     bool
	apiURL     string
	stagingMgr *ArchiveStagingManager

	activePlan          *core.Plan
	activePlanRequest   any
	activePlanArchiveID string
	activePlanArchive   []byte
	activePlanHash      [32]byte
	activePlanReport    packagezip.Report
}

func NewDesktopService() *DesktopService {
	root := os.Getenv("SUBMODHUB_MAS_ROOT")
	configDir, _ := os.UserConfigDir()
	mgr, _ := NewArchiveStagingManager("")
	apiURL := os.Getenv("SUBMODHUB_API_URL")
	if apiURL == "" {
		apiURL = "http://100.72.137.92:18082"
	}
	return &DesktopService{
		root:       root,
		configPath: filepath.Join(configDir, "SubmodHub", "instances.json"),
		apiURL:     apiURL,
		stagingMgr: mgr,
	}
}

func (s *DesktopService) SetAPIURL(apiURL string) {
	if apiURL != "" {
		s.apiURL = apiURL
	}
}

func (s *DesktopService) GetAPIURL() string {
	return s.apiURL
}

func (s *DesktopService) SetMASRoot(root string) (MASStatus, error) {
	root = filepath.Clean(strings.TrimSpace(root))
	if root == "." || root == "" || !filepath.IsAbs(root) {
		return MASStatus{}, errors.New("invalid_mas_root")
	}
	if !fileExists(filepath.Join(root, "game")) {
		return MASStatus{}, errors.New("mas_game_directory_missing")
	}
	s.root = root
	s.state = filepath.Join(root, ".submodhub", "state")
	s.core = core.New(root, s.state)
	s.activePlan = nil

	// Invariant: recover any pending interrupted transactions on startup/set
	if err := s.core.RecoverPending(); err != nil {
		return MASStatus{}, err
	}

	return s.GetMASStatus()
}

func (s *DesktopService) GetMASStatus() (MASStatus, error) {
	if s.root == "" {
		return MASStatus{}, errors.New("mas_root_not_configured")
	}
	game := filepath.Join(s.root, "game")
	entries, err := os.ReadDir(filepath.Join(game, "Submods"))
	if err != nil && !os.IsNotExist(err) {
		return MASStatus{}, err
	}
	count := 0
	for _, entry := range entries {
		if entry.IsDir() {
			count++
		}
	}
	var avail int64
	if space, err := core.GetAvailableDiskSpace(s.root); err == nil {
		avail = int64(space)
	}
	return MASStatus{Root: s.root, GamePath: game, Valid: fileExists(s.root), GameExists: fileExists(game), Submods: count, AvailableBytes: avail}, nil
}

func (s *DesktopService) ScanLocalSubmods() ([]LocalSubmod, error) {
	if s.root == "" {
		return nil, errors.New("mas_root_not_configured")
	}
	base := filepath.Join(s.root, "game", "Submods")
	entries, err := os.ReadDir(base)
	if err != nil {
		if os.IsNotExist(err) {
			return []LocalSubmod{}, nil
		}
		return nil, err
	}
	nameRe := regexp.MustCompile(`\bname\s*=\s*["']([^"']+)["']`)
	authorRe := regexp.MustCompile(`\bauthor\s*=\s*["']([^"']+)["']`)
	versionRe := regexp.MustCompile(`\bversion\s*=\s*["']([^"']+)["']`)
	result := make([]LocalSubmod, 0)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		root := filepath.Join(base, entry.Name())
		item := LocalSubmod{Directory: entry.Name()}
		err = filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if info.IsDir() {
				return nil
			}
			b, readErr := os.ReadFile(path)
			if readErr != nil {
				return readErr
			}
			h := sha256.Sum256(b)
			rel, relErr := filepath.Rel(filepath.Join(s.root, "game"), path)
			if relErr != nil {
				return relErr
			}
			item.Files = append(item.Files, LocalSubmodFile{Path: filepath.ToSlash(filepath.Join("game", rel)), SHA256: hex.EncodeToString(h[:]), Size: info.Size()})
			if strings.HasSuffix(strings.ToLower(path), ".rpy") || strings.HasSuffix(strings.ToLower(path), ".rpym") || strings.HasSuffix(strings.ToLower(path), ".py") {
				if strings.Contains(string(b), "Submod") {
					if item.Name == "" {
						if m := nameRe.FindSubmatch(b); len(m) == 2 {
							item.Name = string(m[1])
						}
					}
					if item.Version == "" {
						if m := versionRe.FindSubmatch(b); len(m) == 2 {
							item.Version = string(m[1])
						}
					}
					if item.Author == "" {
						if m := authorRe.FindSubmatch(b); len(m) == 2 {
							item.Author = string(m[1])
						}
					}
				}
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, nil
}

func (s *DesktopService) ApplyFile(request InstallRequest) (string, error) {
	if s.core == nil {
		if _, err := s.SetMASRoot(s.root); err != nil {
			return "", err
		}
	}
	if request.OperationID == "" {
		return "", errors.New("operation_id_required")
	}
	err := s.core.Apply(core.Operation{ID: request.OperationID, Changes: []core.Change{{Path: request.Path, Content: []byte(request.Content), ExpectedSHA256: request.ExpectedSHA}}})
	if err != nil {
		return "", err
	}
	return "committed", nil
}

func (s *DesktopService) Recover(operationID string) error {
	if s.core == nil {
		if _, err := s.SetMASRoot(s.root); err != nil {
			return err
		}
	}
	return s.core.Recover(operationID)
}

func parseArchiveFiles(data []byte, category string) ([]core.PlannedFile, []string, packagezip.Report, error) {
	archiveData := data
	var spriteWarnings []string
	if category == "spritepack" {
		spriteReport, scanErr := packagezip.ScanSpriteArchive(bytes.NewReader(data), int64(len(data)), packagezip.Limits{})
		if scanErr != nil {
			return nil, nil, packagezip.Report{}, scanErr
		}
		setIDs := make([]string, 0, len(spriteReport.SpriteSets))
		for _, set := range spriteReport.SpriteSets {
			setIDs = append(setIDs, set.ID)
		}
		var err error
		archiveData, err = packagezip.BuildSpriteSelection(bytes.NewReader(data), int64(len(data)), spriteReport, setIDs)
		if err != nil {
			return nil, nil, packagezip.Report{}, err
		}
		spriteWarnings = spriteReport.Warnings
	}
	report, err := packagezip.Scan(bytes.NewReader(archiveData), int64(len(archiveData)), packagezip.Limits{})
	if err != nil {
		return nil, nil, packagezip.Report{}, err
	}
	report.Warnings = append(report.Warnings, spriteWarnings...)
	z, err := zip.NewReader(bytes.NewReader(archiveData), int64(len(archiveData)))
	if err != nil {
		return nil, nil, packagezip.Report{}, err
	}
	bySource := make(map[string]*zip.File, len(z.File))
	for _, entry := range z.File {
		bySource[entry.Name] = entry
	}
	planned := make([]core.PlannedFile, 0, len(report.Files))
	for _, file := range report.Files {
		entry := bySource[file.Source]
		if entry == nil {
			return nil, nil, packagezip.Report{}, errors.New("archive_entry_missing")
		}
		reader, openErr := entry.Open()
		if openErr != nil {
			return nil, nil, packagezip.Report{}, openErr
		}
		content, readErr := io.ReadAll(reader)
		_ = reader.Close()
		if readErr != nil {
			return nil, nil, packagezip.Report{}, readErr
		}
		target := filepath.ToSlash(filepath.Join("game", file.Target))
		if strings.HasPrefix(file.Target, "lib/") || strings.HasPrefix(file.Target, "characters/") {
			target = file.Target
		}
		planned = append(planned, core.PlannedFile{Path: target, Content: content})
	}
	return planned, report.Warnings, report, nil
}

func (s *DesktopService) PreviewArchive(request ArchiveInstallRequest) (PlanResult, error) {
	if s.core == nil {
		if _, err := s.SetMASRoot(s.root); err != nil {
			return PlanResult{}, err
		}
	}
	if err := s.core.RecoverPending(); err != nil {
		return PlanResult{}, err
	}
	if request.OperationID == "" {
		return PlanResult{}, errors.New("operation_id_required")
	}

	var data []byte
	if request.ArchiveID != "" {
		if s.stagingMgr == nil {
			return PlanResult{}, errors.New("staging_manager_not_initialized")
		}
		entry, err := s.stagingMgr.GetEntry(request.ArchiveID, request.OperationID)
		if err != nil {
			return PlanResult{}, err
		}
		if request.ExpectedSHA != "" && !strings.EqualFold(entry.SHA256, request.ExpectedSHA) {
			return PlanResult{}, errors.New("archive_hash_mismatch")
		}
		archiveData, err := os.ReadFile(entry.Path)
		if err != nil {
			return PlanResult{}, fmt.Errorf("read staged archive failed: %w", err)
		}
		data = archiveData
	} else if request.ArchiveBase64 != "" {
		const maxBridgeBase64Len = 22 * 1024 * 1024
		if len(request.ArchiveBase64) > maxBridgeBase64Len {
			return PlanResult{}, errors.New("archive_too_large_for_bridge")
		}
		decoded, err := base64.StdEncoding.DecodeString(request.ArchiveBase64)
		if err != nil {
			return PlanResult{}, errors.New("invalid_archive_base64")
		}
		data = decoded
	} else {
		return PlanResult{}, errors.New("archive_source_required")
	}

	hash := sha256.Sum256(data)
	if request.ExpectedSHA != "" && !strings.EqualFold(hex.EncodeToString(hash[:]), request.ExpectedSHA) {
		return PlanResult{}, errors.New("archive_hash_mismatch")
	}

	plannedFiles, warnings, report, err := parseArchiveFiles(data, request.Category)
	if err != nil {
		return PlanResult{}, err
	}

	manifest, err := s.core.LoadManifest()
	if err != nil {
		return PlanResult{}, err
	}

	blobs := s.core.GetBlobs()
	for _, f := range plannedFiles {
		if _, err := blobs.Put(f.Content); err != nil {
			return PlanResult{}, err
		}
	}

	kind := "install"
	if request.ModID != "" {
		if _, exists := manifest.Installations[request.ModID]; exists {
			kind = "update"
		}
	}

	plan, err := core.PlanInstall(manifest, s.root, blobs, core.InstallOperation{
		OperationID:    request.OperationID,
		InstallationID: request.ModID,
		ModID:          request.ModID,
		VersionID:      request.VersionID,
		Version:        request.Version,
		Title:          request.Title,
		Priority:       request.Priority,
		Files:          plannedFiles,
	})
	if err != nil {
		return PlanResult{}, err
	}

	if s.activePlanArchiveID != "" && s.activePlanArchiveID != request.ArchiveID && s.stagingMgr != nil {
		s.stagingMgr.ReleaseArchive(s.activePlanArchiveID)
	}
	s.activePlanArchiveID = request.ArchiveID
	s.activePlan = plan
	s.activePlanRequest = request
	s.activePlanArchive = data
	s.activePlanHash = hash
	s.activePlanReport = report

	actions := make([]PlanPreviewAction, 0, len(plan.Actions))
	for _, a := range plan.Actions {
		actionType := "CREATE"
		backupReq := false
		reason := "新建文件"
		switch a.Action {
		case core.ActionWrite:
			if a.CurrentExists {
				actionType = "OVERWRITE"
				backupReq = true
				reason = "覆盖已有文件"
			} else {
				actionType = "CREATE"
				reason = "新建文件"
			}
		case core.ActionMetadataOnly:
			actionType = "METADATA_ONLY"
			reason = "仅调整归属，无需更改磁盘"
		}

		cSrc := resolveSourceTitle(a.CurrentSource, manifest)

		tSrc := a.TargetSource
		if tSrc == "" || tSrc == request.ModID || tSrc == request.OperationID {
			tSrc = request.Title
			if tSrc == "" {
				tSrc = request.ModID
			}
		} else {
			tSrc = resolveSourceTitle(tSrc, manifest)
		}

		actions = append(actions, PlanPreviewAction{
			Path:           a.Path,
			Action:         actionType,
			CurrentSource:  cSrc,
			TargetSource:   tSrc,
			CurrentHash:    a.CurrentHash,
			TargetHash:     a.TargetHash,
			CurrentExists:  a.CurrentExists,
			TargetExists:   a.TargetExists,
			BackupRequired: backupReq,
			Reason:         reason,
		})
	}

	risks := make([]PlanPreviewRisk, 0, len(plan.Risks))
	for _, r := range plan.Risks {
		risks = append(risks, PlanPreviewRisk{
			Type:        r.Type,
			Path:        r.Path,
			Description: r.Description,
		})
	}

	// Add package warnings as risks
	for _, w := range warnings {
		risks = append(risks, PlanPreviewRisk{
			Type:        "package_warning",
			Description: w,
		})
	}

	return PlanResult{
		PlanID:     plan.PlanID,
		Root:       s.root,
		Generation: plan.Generation,
		Kind:       kind,
		TargetID:   request.ModID,
		ModTitle:   request.Title,
		Version:    request.Version,
		Actions:    actions,
		Blockers:   plan.Blockers,
		Risks:      risks,
		Summary: PlanPreviewSummary{
			RestoresOriginal: plan.Summary.RestoresOriginal,
			RestoresLayer:    plan.Summary.RestoresLayer,
			MetadataOnly:     plan.Summary.MetadataOnly,
			DeletesAdded:     plan.Summary.DeletesAdded,
			WritesNew:        plan.Summary.WritesNew,
		},
	}, nil
}

func (s *DesktopService) PreviewUninstallWithOpID(targetID, uninstallOpID string) (PlanResult, error) {
	if s.core == nil {
		if _, err := s.SetMASRoot(s.root); err != nil {
			return PlanResult{}, err
		}
	}
	if err := s.core.RecoverPending(); err != nil {
		return PlanResult{}, err
	}
	if targetID == "" {
		return PlanResult{}, errors.New("target_id_required")
	}

	manifest, err := s.core.LoadManifest()
	if err != nil {
		return PlanResult{}, err
	}

	// Check if this installation exists in manifest
	if _, ok := manifest.Installations[targetID]; !ok {
		// Check receipts
		receipts, rErr := s.ListInstalledArchives()
		if rErr == nil {
			for _, rec := range receipts {
				if rec.ModID == targetID || rec.OperationID == targetID {
					// Fallback synthesis
					targetID = rec.OperationID
					break
				}
			}
		}
	}

	if uninstallOpID == "" {
		uninstallOpID = fmt.Sprintf("uninstall_%s_%d", targetID, time.Now().UnixNano())
	}

	plan, err := core.PlanUninstall(manifest, s.root, s.core.GetBlobs(), targetID, uninstallOpID)
	if err != nil {
		return PlanResult{}, err
	}

	s.activePlan = plan
	s.activePlanRequest = targetID

	actions := make([]PlanPreviewAction, 0, len(plan.Actions))
	for _, a := range plan.Actions {
		actionType := "REMOVE"
		reason := "移除文件"
		switch a.Action {
		case core.ActionRestoreOriginal:
			actionType = "RESTORE"
			reason = "恢复游戏/外部原文件"
		case core.ActionRestoreLayer:
			actionType = "RESTORE"
			reason = "恢复有效活动模组文件"
		case core.ActionDelete:
			actionType = "REMOVE"
			reason = "移除模组新增文件"
		case core.ActionMetadataOnly:
			actionType = "METADATA_ONLY"
			reason = "仅移除归属，保留高层文件"
		}

		cSrc := resolveSourceTitle(a.CurrentSource, manifest)

		tSrc := a.TargetSource
		if tSrc == "none" {
			tSrc = "(移除)"
		} else {
			tSrc = resolveSourceTitle(tSrc, manifest)
		}

		actions = append(actions, PlanPreviewAction{
			Path:           a.Path,
			Action:         actionType,
			CurrentSource:  cSrc,
			TargetSource:   tSrc,
			CurrentHash:    a.CurrentHash,
			TargetHash:     a.TargetHash,
			CurrentExists:  a.CurrentExists,
			TargetExists:   a.TargetExists,
			BackupRequired: false,
			Reason:         reason,
		})
	}

	risks := make([]PlanPreviewRisk, 0, len(plan.Risks))
	for _, r := range plan.Risks {
		risks = append(risks, PlanPreviewRisk{
			Type:        r.Type,
			Path:        r.Path,
			Description: r.Description,
		})
	}

	return PlanResult{
		PlanID:     plan.PlanID,
		Root:       s.root,
		Generation: plan.Generation,
		Kind:       "uninstall",
		TargetID:   targetID,
		Actions:    actions,
		Blockers:   plan.Blockers,
		Risks:      risks,
		Summary: PlanPreviewSummary{
			RestoresOriginal: plan.Summary.RestoresOriginal,
			RestoresLayer:    plan.Summary.RestoresLayer,
			MetadataOnly:     plan.Summary.MetadataOnly,
			DeletesAdded:     plan.Summary.DeletesAdded,
			WritesNew:        plan.Summary.WritesNew,
		},
	}, nil
}

func (s *DesktopService) GetPriorityOverview() (*core.PriorityOverview, error) {
	if s.core == nil {
		if _, err := s.SetMASRoot(s.root); err != nil {
			return nil, err
		}
	}
	return s.core.GetPriorityOverview()
}

func (s *DesktopService) PreviewPriority(priorities map[string]int) (PlanResult, error) {
	if s.core == nil {
		if _, err := s.SetMASRoot(s.root); err != nil {
			return PlanResult{}, err
		}
	}
	manifest, err := s.core.LoadManifest()
	if err != nil {
		return PlanResult{}, err
	}
	plan, err := core.PlanPriority(manifest, s.root, s.core.GetBlobs(), core.PriorityChangeRequest{
		Priorities: priorities,
	})
	if err != nil {
		return PlanResult{}, err
	}
	s.activePlan = plan
	s.activePlanRequest = priorities
	s.activePlanArchiveID = ""
	s.activePlanArchive = nil

	actions := make([]PlanPreviewAction, 0, len(plan.Actions))
	for _, act := range plan.Actions {
		actionStr := "OVERWRITE"
		reasonStr := "priority stack change"
		if act.Action == core.ActionMetadataOnly {
			actionStr = "METADATA_ONLY"
			reasonStr = "priority owner change (identical content)"
		} else if act.Action == core.ActionRestoreLayer {
			actionStr = "OVERWRITE"
		}
		actions = append(actions, PlanPreviewAction{
			Path:           act.Path,
			Action:         actionStr,
			CurrentSource:  act.CurrentSource,
			TargetSource:   act.TargetSource,
			CurrentHash:    act.CurrentHash,
			TargetHash:     act.TargetHash,
			CurrentExists:  act.CurrentExists,
			TargetExists:   act.TargetExists,
			BackupRequired: false,
			Reason:         reasonStr,
		})
	}

	return PlanResult{
		PlanID:     plan.PlanID,
		Root:       s.root,
		Generation: plan.Generation,
		Kind:       "priority",
		TargetID:   "priority_adjustment",
		ModTitle:   "模组图层与覆盖优先级调整",
		Version:    "",
		Actions:    actions,
		Blockers:   plan.Blockers,
		Risks:      []PlanPreviewRisk{},
		Summary: PlanPreviewSummary{
			RestoresOriginal: plan.Summary.RestoresOriginal,
			RestoresLayer:    plan.Summary.RestoresLayer,
			MetadataOnly:     plan.Summary.MetadataOnly,
			DeletesAdded:     plan.Summary.DeletesAdded,
			WritesNew:        plan.Summary.WritesNew,
		},
	}, nil
}

func (s *DesktopService) PreviewUninstall(targetID string) (PlanResult, error) {
	return s.PreviewUninstallWithOpID(targetID, "")
}

func (s *DesktopService) ExecutePlan(request ExecutePlanRequest) (ArchiveInstallResult, error) {
	if s.core == nil {
		if _, err := s.SetMASRoot(s.root); err != nil {
			return ArchiveInstallResult{}, err
		}
	}
	if s.activePlan == nil || s.activePlan.PlanID != request.PlanID {
		return ArchiveInstallResult{}, errors.New("plan_stale")
	}
	if s.activePlan.Root != s.root {
		return ArchiveInstallResult{}, errors.New("plan_stale")
	}
	if len(s.activePlan.Blockers) > 0 {
		return ArchiveInstallResult{}, errors.New("plan_blocked")
	}

	plan := s.activePlan
	activeReq := s.activePlanRequest
	defer func() {
		if req, ok := activeReq.(ArchiveInstallRequest); ok && req.ArchiveID != "" && s.stagingMgr != nil {
			s.stagingMgr.ReleaseArchive(req.ArchiveID)
		}
		s.activePlanArchiveID = ""
	}()
	tx, err := s.core.NewTransaction(plan)
	if err != nil {
		return ArchiveInstallResult{}, err
	}
	defer tx.Close()

	// Coordinate receipt update atomically within transaction boundary
	if plan.OperationType == "install" {
		req, ok := s.activePlanRequest.(ArchiveInstallRequest)
		if ok && req.ModID != "" {
			newReceipts, pErr := s.projectedInstalledArchives(req, s.activePlanReport, hex.EncodeToString(s.activePlanHash[:]), int64(len(s.activePlanArchive)))
			if pErr != nil {
				return ArchiveInstallResult{}, pErr
			}
			data, mErr := json.MarshalIndent(newReceipts, "", "  ")
			if mErr != nil {
				return ArchiveInstallResult{}, mErr
			}
			tx.SetReceiptUpdate(s.installedArchivesPath(), data)
		}
	} else if plan.OperationType == "uninstall" {
		targetID, ok := s.activePlanRequest.(string)
		if ok {
			newReceipts, pErr := s.projectedRemoveInstalledArchive(targetID)
			if pErr != nil {
				return ArchiveInstallResult{}, pErr
			}
			data, mErr := json.MarshalIndent(newReceipts, "", "  ")
			if mErr != nil {
				return ArchiveInstallResult{}, mErr
			}
			tx.SetReceiptUpdate(s.installedArchivesPath(), data)
		}
	}

	if err := tx.Execute(); err != nil {
		s.activePlan = nil
		s.activePlanRequest = nil
		s.activePlanArchive = nil
		return ArchiveInstallResult{}, err
	}

	s.activePlan = nil
	s.activePlanRequest = nil
	s.activePlanArchive = nil

	return ArchiveInstallResult{
		State:    "committed",
		Files:    len(plan.Actions),
		Warnings: []string{},
	}, nil
}

func (s *DesktopService) ApplyArchive(request ArchiveInstallRequest) (ArchiveInstallResult, error) {
	preview, err := s.PreviewArchive(request)
	if err != nil {
		return ArchiveInstallResult{}, err
	}
	if len(preview.Blockers) > 0 {
		return ArchiveInstallResult{}, fmt.Errorf("plan_blocked: %s", strings.Join(preview.Blockers, "; "))
	}
	return s.ExecutePlan(ExecutePlanRequest{
		PlanID:    preview.PlanID,
		Confirmed: true,
	})
}

func (s *DesktopService) Uninstall(operationID, uninstallOperationID string) (string, error) {
	preview, err := s.PreviewUninstallWithOpID(operationID, uninstallOperationID)
	if err != nil {
		return "", err
	}
	if len(preview.Blockers) > 0 {
		return "", fmt.Errorf("plan_blocked: %s", strings.Join(preview.Blockers, "; "))
	}
	res, err := s.ExecutePlan(ExecutePlanRequest{
		PlanID:    preview.PlanID,
		Confirmed: true,
	})
	if err != nil {
		return "", err
	}
	return res.State, nil
}


func resolveSourceTitle(src string, manifest *core.Manifest) string {
	if src == "original" || src == "" {
		return "游戏/外部原文件"
	}
	if src == "none" {
		return "(无)"
	}
	if manifest != nil && manifest.Installations != nil {
		if inst, ok := manifest.Installations[src]; ok && inst != nil {
			if inst.Title != "" {
				return inst.Title
			}
			if inst.ModID != "" {
				return inst.ModID
			}
		}
		for _, inst := range manifest.Installations {
			if inst != nil && (inst.ModID == src || inst.OperationID == src) {
				if inst.Title != "" {
					return inst.Title
				}
				if inst.ModID != "" {
					return inst.ModID
				}
			}
		}
	}
	return src
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func (s *DesktopService) StageArchive(request StageArchiveRequest) (StagedArchiveInfo, error) {
	if s.stagingMgr == nil {
		mgr, err := NewArchiveStagingManager("")
		if err != nil {
			return StagedArchiveInfo{}, err
		}
		s.stagingMgr = mgr
	}
	effectiveBase := request.APIBase
	if effectiveBase == "" || strings.HasPrefix(effectiveBase, "wails://") || strings.HasPrefix(effectiveBase, "http://wails.") || strings.HasPrefix(effectiveBase, "https://wails.") || strings.HasPrefix(effectiveBase, "/") {
		apiServer := strings.TrimRight(s.apiURL, "/")
		effectiveBase = apiServer + "/api/v1"
	}
	request.APIBase = effectiveBase
	return s.stagingMgr.Stage(context.Background(), request)
}

func (s *DesktopService) GetStageProgress(operationID string) (StageProgress, error) {
	if s.stagingMgr == nil {
		return StageProgress{}, nil
	}
	return s.stagingMgr.GetProgress(operationID), nil
}

func (s *DesktopService) CancelStage(operationID string) error {
	if s.stagingMgr == nil {
		return nil
	}
	s.stagingMgr.Cancel(operationID)
	return nil
}

func (s *DesktopService) ReleaseArchive(archiveID string) error {
	if s.stagingMgr != nil && archiveID != "" {
		s.stagingMgr.ReleaseArchive(archiveID)
	}
	return nil
}

func (s *DesktopService) ListInstalledModFiles(installationID, modID string) (*core.InstalledFileList, error) {
	if s.root == "" {
		return nil, &core.Error{Code: "invalid_mas_root", Err: errors.New("mas_root_not_configured")}
	}
	if s.core == nil {
		if _, err := s.SetMASRoot(s.root); err != nil {
			return nil, err
		}
	}
	return s.core.ListInstalledModFiles(installationID, modID)
}
