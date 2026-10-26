package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	core "github.com/reze/submodhub/internal/install"
	"github.com/reze/submodhub/internal/maspath"
	packagezip "github.com/reze/submodhub/internal/package"
)

type MASStatus struct {
	Root             string `json:"root"`
	GamePath         string `json:"game_path"`
	Valid            bool   `json:"valid"`
	GameExists       bool   `json:"game_exists"`
	Submods          int    `json:"submods"`
	MASVersion       string `json:"mas_version"`
	AvailableBytes   int64  `json:"available_bytes"`
	TotalBytes       int64  `json:"total_bytes"`
	Diagnostic       string `json:"diagnostic,omitempty"`
	DiagnosticDetail string `json:"diagnostic_detail,omitempty"`
}

type InstallRequest struct {
	OperationID string `json:"operation_id"`
	Path        string `json:"path"`
	Content     string `json:"content"`
	ExpectedSHA string `json:"expected_sha256"`
}

type ArchiveInstallRequest struct {
	Category            string   `json:"category"`
	OperationID         string   `json:"operation_id"`
	ArchiveBase64       string   `json:"archive_base64,omitempty"`
	ArchiveID           string   `json:"archive_id,omitempty"`
	ExpectedSHA         string   `json:"expected_sha256"`
	ModID               string   `json:"mod_id"`
	VersionID           string   `json:"version_id"`
	Version             string   `json:"version"`
	Title               string   `json:"title"`
	Author              string   `json:"author,omitempty"`
	Priority            int      `json:"priority,omitempty"`
	SpriteSetIDs        []string `json:"sprite_set_ids,omitempty"`
	SpriteSelectionHash string   `json:"sprite_selection_hash,omitempty"`
}

type ArchiveInstallResult struct {
	State                  string   `json:"state"`
	Files                  int      `json:"files"`
	Warnings               []string `json:"warnings"`
	SpriteSetIDs           []string `json:"sprite_set_ids,omitempty"`
	SpriteSelectionHash    string   `json:"sprite_selection_hash,omitempty"`
	SelectedSpriteSetCount int      `json:"selected_sprite_set_count,omitempty"`
}

// LocalSubmod and LocalSubmodFile are defined in local_submods.go

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
	PlanID                 string              `json:"plan_id"`
	OperationID            string              `json:"operation_id,omitempty"`
	BackupID               string              `json:"backup_id,omitempty"`
	Root                   string              `json:"root"`
	Generation             int64               `json:"generation"`
	Kind                   string              `json:"kind"` // install, update, uninstall
	TargetID               string              `json:"target_id"`
	ModTitle               string              `json:"mod_title"`
	Version                string              `json:"version"`
	Priority               int                 `json:"priority"`
	SpriteSetIDs           []string            `json:"sprite_set_ids,omitempty"`
	SpriteSelectionHash    string              `json:"sprite_selection_hash,omitempty"`
	SelectedSpriteSetCount int                 `json:"selected_sprite_set_count,omitempty"`
	Actions                []PlanPreviewAction `json:"actions"`
	CleanupPaths           []string            `json:"cleanup_paths,omitempty"`
	Blockers               []string            `json:"blockers"`
	Risks                  []PlanPreviewRisk   `json:"risks"`
	Summary                PlanPreviewSummary  `json:"summary"`
}

type ExecutePlanRequest struct {
	PlanID    string `json:"plan_id"`
	Confirmed bool   `json:"confirmed"`
}

type OperationProgress struct {
	Stage          string `json:"stage"`
	CurrentFile    string `json:"current_file,omitempty"`
	ProcessedFiles int    `json:"processed_files"`
	TotalFiles     int    `json:"total_files"`
	BytesProcessed int64  `json:"bytes_processed"`
	TotalBytes     int64  `json:"total_bytes"`
	Percent        int    `json:"percent"`
}

type OperationError struct {
	Code    string                 `json:"code"`
	Message string                 `json:"message"`
	Details map[string]interface{} `json:"details,omitempty"`
}

type OperationDetail struct {
	OperationID            string            `json:"operation_id"`
	InstallationID         string            `json:"installation_id"`
	TargetInstallationID   string            `json:"target_installation_id,omitempty"`
	ModID                  string            `json:"mod_id"`
	ModTitle               string            `json:"mod_title"`
	VersionID              string            `json:"version_id"`
	VersionStr             string            `json:"version_str"`
	Kind                   string            `json:"kind"`
	State                  string            `json:"state"` // committed, rolled_back, needs_manual_recovery, recoverable, planned, applying...
	Phase                  string            `json:"phase"`
	Progress               OperationProgress `json:"progress"`
	Error                  *OperationError   `json:"error,omitempty"`
	ConflictPath           string            `json:"conflict_path,omitempty"`
	ExpectedHash           string            `json:"expected_hash,omitempty"`
	ActualHash             string            `json:"actual_hash,omitempty"`
	BackupID               string            `json:"backup_id,omitempty"`
	CanRollback            bool              `json:"can_rollback"`
	SpriteSetIDs           []string          `json:"sprite_set_ids,omitempty"`
	SpriteSelectionHash    string            `json:"sprite_selection_hash,omitempty"`
	SelectedSpriteSetCount int               `json:"selected_sprite_set_count,omitempty"`
	CreatedAt              string            `json:"created_at"`
	UpdatedAt              string            `json:"updated_at"`
}

type DesktopService struct {
	mu         sync.Mutex
	root       string
	state      string
	core       *core.Installer
	configPath string
	instances  []MASInstance
	activeID   string
	loaded     bool
	apiURL     string
	stagingMgr *ArchiveStagingManager

	storageGuard        *StorageAccessGuard
	storageProvider     StorageAccessProvider
	isAndroidOverride   bool
	androidRootOverride string
	inspectDir          func(root string) MASStatus

	candidateRegistrationsResolver func(candidateID string) ([]string, error)

	appUpdater *AppUpdateBindings
	mutations  clientMutationGate

	activePlan          *core.Plan
	activePlanRequest   any
	activePlanArchiveID string
	activePlanArchive   []byte
	activePlanHash      [32]byte
	activePlanReport    packagezip.Report
}

func (s *DesktopService) isAndroid() bool {
	return isAndroidPlatform || s.isAndroidOverride
}

func (s *DesktopService) checkStorageAccess() error {
	if !s.isAndroid() {
		return nil
	}
	if s.storageGuard == nil {
		if s.storageProvider != nil {
			s.storageGuard = NewStorageAccessGuard(s.storageProvider)
		} else {
			return ErrPermissionLost
		}
	}
	return s.storageGuard.Check()
}

func (s *DesktopService) SetStorageAccessProvider(provider StorageAccessProvider) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.storageProvider = provider
	s.storageGuard = NewStorageAccessGuard(provider)
}

func (s *DesktopService) GetAndroidStorageAccess() (AndroidStorageAccessStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.storageProvider == nil {
		return defaultAndroidStorageStatus(), nil
	}
	return s.storageProvider.GetStorageAccess()
}

func (s *DesktopService) RequestAndroidStorageAccess() (AndroidStorageAccessRequestResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.storageProvider == nil {
		return AndroidStorageAccessRequestResult{Opened: false, Error: "no_provider"}, errors.New("no_storage_access_provider")
	}
	return s.storageProvider.RequestStorageAccess()
}

func NewDesktopService() *DesktopService {
	provider := newPlatformStorageAccessProvider()
	guard := NewStorageAccessGuard(provider)

	configBase, _ := getPlatformInternalConfigDir()
	cacheDir, _ := getPlatformInternalCacheDir()
	mgr, _ := NewArchiveStagingManager(cacheDir)

	root := os.Getenv("SUBMODHUB_MAS_ROOT")
	if isAndroidPlatform && root == "" {
		root = strings.TrimRight(maspath.AndroidMASRoot, "/")
	}
	apiURL := os.Getenv("SUBMODHUB_API_URL")
	if apiURL == "" {
		apiURL = "https://rezehub.0721play.icu"
	}
	appUpdater, _ := newAppUpdateBindings(nil, filepath.Join(cacheDir, appUpdateCacheDirectory), "", apiURL)
	return &DesktopService{
		root:            root,
		configPath:      filepath.Join(configBase, "instances.json"),
		apiURL:          apiURL,
		stagingMgr:      mgr,
		storageProvider: provider,
		storageGuard:    guard,
		appUpdater:      appUpdater,
	}
}

func (s *DesktopService) SetAPIURL(apiURL string) {
	if apiURL != "" {
		s.apiURL = apiURL
		if s.appUpdater != nil && s.appUpdater.service != nil {
			s.appUpdater.service.SetAPIBaseURL(apiURL)
		}
	}
}

func (s *DesktopService) GetAPIURL() string {
	return s.apiURL
}

func (s *DesktopService) SetCandidateRegistrationsResolver(fn func(candidateID string) ([]string, error)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.candidateRegistrationsResolver = fn
}

func (s *DesktopService) internalStorageDir() string {
	if s.configPath != "" {
		return filepath.Dir(s.configPath)
	}
	dir, err := getPlatformInternalConfigDir()
	if err != nil || dir == "" {
		return "."
	}
	return dir
}

func (s *DesktopService) newCore(root, state string) *core.Installer {
	installer := core.New(root, state)
	if s.isAndroid() {
		lockPath := maspath.AndroidInstanceLockPath(s.internalStorageDir(), root)
		installer.SetLockPath(lockPath)
	}
	return installer
}

func (s *DesktopService) SetMASRoot(root string) (MASStatus, error) {
	finish, err := s.mutations.begin()
	if err != nil {
		return MASStatus{}, err
	}
	defer finish()

	if s.isAndroid() {
		if err := maspath.ValidateAndroidMASRoot(root); err != nil {
			return MASStatus{}, ErrInvalidMASRoot
		}
		if err := s.checkStorageAccess(); err != nil {
			return MASStatus{}, err
		}
		root = strings.TrimRight(maspath.AndroidMASRoot, "/")
	} else {
		root = filepath.Clean(strings.TrimSpace(root))
		if root == "." || root == "" || !filepath.IsAbs(root) {
			return MASStatus{}, errors.New("invalid_mas_root")
		}
	}
	if !fileExists(filepath.Join(root, "game")) {
		return MASStatus{}, errors.New("mas_game_directory_missing")
	}
	s.root = root
	s.state = filepath.Join(root, ".submodhub", "state")
	s.core = s.newCore(root, s.state)
	s.activePlan = nil

	// Invariant: recover any pending interrupted transactions on startup/set
	if err := s.core.RecoverPending(); err != nil {
		if !core.IsDisplayableRecoveryError(err) {
			return MASStatus{}, err
		}
	}

	// Retention: finished transactions keep their recovery material for
	// CompletedRetention, then their journal and unreferenced blobs are dropped.
	s.pruneFinishedTransactions()

	return s.GetMASStatus()
}

func (s *DesktopService) GetMASStatus() (MASStatus, error) {
	if err := s.checkStorageAccess(); err != nil {
		return MASStatus{}, err
	}
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
	var avail, capacity int64
	if available, total, err := core.GetDiskSpace(s.root); err == nil {
		avail = int64(available)
		capacity = int64(total)
	}
	return MASStatus{Root: s.root, GamePath: game, Valid: fileExists(s.root), GameExists: fileExists(game), Submods: count, AvailableBytes: avail, TotalBytes: capacity}, nil
}

func (s *DesktopService) ScanLocalSubmods() ([]LocalSubmod, error) {
	if err := s.checkStorageAccess(); err != nil {
		return nil, err
	}
	if s.root == "" {
		return nil, errors.New("mas_root_not_configured")
	}
	var manifest *core.Manifest
	if s.core != nil {
		if m, err := s.core.LoadManifest(); err == nil {
			manifest = m
		}
	}
	return scanLocalSubmodsCore(s.root, manifest)
}

func (s *DesktopService) ApplyFile(request InstallRequest) (string, error) {
	finish, err := s.mutations.begin()
	if err != nil {
		return "", err
	}
	defer finish()

	if err := s.checkStorageAccess(); err != nil {
		return "", err
	}
	if s.core == nil {
		if _, err := s.SetMASRoot(s.root); err != nil {
			return "", err
		}
	}
	if request.OperationID == "" {
		return "", errors.New("operation_id_required")
	}
	err = s.core.Apply(core.Operation{ID: request.OperationID, Changes: []core.Change{{Path: request.Path, Content: []byte(request.Content), ExpectedSHA256: request.ExpectedSHA}}})
	if err != nil {
		return "", err
	}
	s.pruneFinishedTransactions()
	return "committed", nil
}

func (s *DesktopService) mapJournalToDetail(j *core.TxJournal) OperationDetail {
	instID := s.activeID
	targetInstID := j.TargetInstallationID
	modID := j.ModID
	if modID == "" {
		modID = j.OperationID
	}
	modTitle := j.ModTitle
	if modTitle == "" {
		modTitle = modID
	}
	kind := j.Kind
	if kind == "" {
		kind = "install"
	}

	state := j.Phase
	canRollback := false
	switch j.Phase {
	case core.TxPhaseCommitted:
		state = "committed"
	case core.TxPhaseRolledBack:
		state = "rolled_back"
	case core.TxPhaseNeedsManualRecovery:
		state = "needs_manual_recovery"
		if j.HasRecoveryMaterial() {
			canRollback = true
		}
	case core.TxPhasePlanned:
		state = "planned"
		canRollback = true
	case core.TxPhasePrepared, core.TxPhaseApplying, core.TxPhaseCommitting:
		state = "recoverable"
		canRollback = true
	default:
		state = j.Phase
	}

	// 冲突路径只在事务确实进入人工恢复时才有意义：j.LastPath 在正常写入步骤中
	// 也会持续更新，直接透出会让每个已提交事务都显示一条并不存在的冲突文件。
	conflictPath := ""
	if j.Phase == core.TxPhaseNeedsManualRecovery {
		conflictPath = j.LastPath
	}

	totalFiles := j.TotalSteps
	if totalFiles == 0 {
		totalFiles = len(j.AfterFiles)
	}
	processedFiles := j.CurrentStep
	if j.Phase == core.TxPhaseCommitted {
		processedFiles = totalFiles
	}
	percent := 0
	if totalFiles > 0 {
		percent = (processedFiles * 100) / totalFiles
		if percent > 100 {
			percent = 100
		}
	} else if j.Phase == core.TxPhaseCommitted {
		percent = 100
	}

	stage := "操作已初始化"
	switch j.Phase {
	case core.TxPhaseCommitted:
		stage = "操作已成功提交"
	case core.TxPhaseRolledBack:
		stage = "操作已安全回滚"
	case core.TxPhaseNeedsManualRecovery:
		stage = "检测到外部冲突或异常，需要人工恢复"
	case core.TxPhasePrepared:
		stage = "快照就绪，准备应用"
	case core.TxPhaseApplying:
		stage = fmt.Sprintf("正在应用文件变更 (%d/%d)", processedFiles, totalFiles)
	case core.TxPhaseCommitting:
		stage = "正在提交清单与持久化记录"
	case core.TxPhasePlanned:
		stage = "计划已生成"
	}

	var opErr *OperationError
	if j.ErrorCode != "" || j.ErrorMessage != "" {
		opErr = &OperationError{
			Code:    j.ErrorCode,
			Message: j.ErrorMessage,
		}
	}

	backupID := ""
	if j.OperationID != "" {
		backupID = fmt.Sprintf("snapshot_%s", j.OperationID)
	}

	createdAt := j.CreatedAt.Format(time.RFC3339)
	if j.CreatedAt.IsZero() {
		createdAt = time.Now().UTC().Format(time.RFC3339)
	}
	updatedAt := j.UpdatedAt.Format(time.RFC3339)
	if j.UpdatedAt.IsZero() {
		updatedAt = createdAt
	}

	return OperationDetail{
		OperationID:          j.OperationID,
		InstallationID:       instID,
		TargetInstallationID: targetInstID,
		ModID:                modID,
		ModTitle:             modTitle,
		VersionID:            j.VersionID,
		VersionStr:           j.Version,
		Kind:                 kind,
		State:                state,
		Phase:                j.Phase,
		Progress: OperationProgress{
			Stage:          stage,
			CurrentFile:    j.LastPath,
			ProcessedFiles: processedFiles,
			TotalFiles:     totalFiles,
			Percent:        percent,
		},
		Error:                  opErr,
		ConflictPath:           conflictPath,
		ExpectedHash:           j.ExpectedHash,
		ActualHash:             j.ActualHash,
		BackupID:               backupID,
		CanRollback:            canRollback,
		SpriteSetIDs:           j.SpriteSetIDs,
		SpriteSelectionHash:    j.SpriteSelectionHash,
		SelectedSpriteSetCount: j.SelectedSpriteSetCount,
		CreatedAt:              createdAt,
		UpdatedAt:              updatedAt,
	}
}

func (s *DesktopService) ListOperations() ([]OperationDetail, error) {
	if err := s.checkStorageAccess(); err != nil {
		return nil, err
	}
	if s.core == nil {
		if _, err := s.SetMASRoot(s.root); err != nil {
			return nil, err
		}
	}
	journals, err := s.core.ListTxJournals()
	if err != nil {
		return nil, err
	}
	var res []OperationDetail
	for _, j := range journals {
		res = append(res, s.mapJournalToDetail(&j))
	}
	return res, nil
}

func (s *DesktopService) GetOperation(operationID string) (*OperationDetail, error) {
	if err := s.checkStorageAccess(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(operationID) == "" {
		return nil, &core.Error{Code: "validation_failed", Err: errors.New("operation_id is required")}
	}
	if strings.ContainsAny(operationID, `/\\`) {
		return nil, &core.Error{Code: "invalid_path", Path: operationID, Err: errors.New("invalid operation id")}
	}
	if s.core == nil {
		if _, err := s.SetMASRoot(s.root); err != nil {
			return nil, err
		}
	}
	txJ, err := s.core.GetTxJournal(operationID)
	if err != nil {
		return nil, err
	}
	detail := s.mapJournalToDetail(txJ)
	return &detail, nil
}

func (s *DesktopService) RollbackOperation(operationID string) error {
	finish, err := s.mutations.begin()
	if err != nil {
		return err
	}
	defer finish()

	if err := s.checkStorageAccess(); err != nil {
		return err
	}
	if strings.TrimSpace(operationID) == "" {
		return &core.Error{Code: "validation_failed", Err: errors.New("operation_id is required")}
	}
	if strings.ContainsAny(operationID, `/\\`) {
		return &core.Error{Code: "invalid_path", Path: operationID, Err: errors.New("invalid operation id")}
	}
	if s.core == nil {
		if _, err := s.SetMASRoot(s.root); err != nil {
			return err
		}
	}
	return s.core.Rollback(operationID)
}

func (s *DesktopService) Recover(operationID string) error {
	return s.RollbackOperation(operationID)
}

func parseArchiveFiles(data []byte, category string, isSelectedSpritepack bool, spriteSetIDs []string) ([]core.PlannedFile, []string, packagezip.Report, error) {
	archiveData := data
	var spriteWarnings []string
	if category == "spritepack" {
		if !isSelectedSpritepack {
			spriteReport, scanErr := packagezip.ScanSpriteArchive(bytes.NewReader(data), int64(len(data)), packagezip.Limits{})
			if scanErr != nil {
				return nil, nil, packagezip.Report{}, scanErr
			}
			setIDs := NormalizeSpriteSetIDs(spriteSetIDs)
			if len(setIDs) == 0 {
				setIDs = make([]string, 0, len(spriteReport.SpriteSets))
				for _, set := range spriteReport.SpriteSets {
					setIDs = append(setIDs, set.ID)
				}
			}
			var err error
			archiveData, err = packagezip.BuildSpriteSelection(bytes.NewReader(data), int64(len(data)), spriteReport, setIDs)
			if err != nil {
				return nil, nil, packagezip.Report{}, err
			}
			spriteWarnings = spriteReport.Warnings
		}
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
	if err := s.checkStorageAccess(); err != nil {
		return PlanResult{}, err
	}
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
	var isSelectedSpritepack bool
	var effectiveSpriteSetIDs []string
	var effectiveSpriteSelectionHash string
	var selectedSpriteSetCount int

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
		if entry.ModID != "" {
			if request.ModID != "" && request.ModID != entry.ModID {
				return PlanResult{}, errors.New("staged_mod_id_mismatch")
			}
			request.ModID = entry.ModID
		}
		if entry.VersionID != "" {
			if request.VersionID != "" && request.VersionID != entry.VersionID {
				return PlanResult{}, errors.New("staged_version_id_mismatch")
			}
			request.VersionID = entry.VersionID
		}
		if entry.Category != "" {
			if request.Category != "" && request.Category != entry.Category {
				return PlanResult{}, errors.New("staged_category_mismatch")
			}
			request.Category = entry.Category
		}
		if entry.IsSelectedSpritepack {
			if request.Category != "" && request.Category != "spritepack" {
				return PlanResult{}, errors.New("staged_category_mismatch")
			}
			request.Category = "spritepack"
			if request.SpriteSelectionHash != "" && !strings.EqualFold(request.SpriteSelectionHash, entry.SpriteSelectionHash) {
				return PlanResult{}, errors.New("sprite_selection_hash_mismatch")
			}
			if len(request.SpriteSetIDs) > 0 {
				reqNorm := NormalizeSpriteSetIDs(request.SpriteSetIDs)
				if strings.Join(reqNorm, ",") != strings.Join(entry.SpriteSetIDs, ",") {
					return PlanResult{}, errors.New("sprite_selection_mismatch")
				}
			}
			request.SpriteSetIDs = entry.SpriteSetIDs
			request.SpriteSelectionHash = entry.SpriteSelectionHash
		}
		archiveData, err := os.ReadFile(entry.Path)
		if err != nil {
			return PlanResult{}, fmt.Errorf("read staged archive failed: %w", err)
		}
		data = archiveData
		isSelectedSpritepack = entry.IsSelectedSpritepack
		effectiveSpriteSetIDs = entry.SpriteSetIDs
		effectiveSpriteSelectionHash = entry.SpriteSelectionHash
		selectedSpriteSetCount = entry.SelectedSpriteSetCount
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

	if request.Category == "spritepack" && len(effectiveSpriteSetIDs) == 0 && len(request.SpriteSetIDs) > 0 {
		effectiveSpriteSetIDs = NormalizeSpriteSetIDs(request.SpriteSetIDs)
		effectiveSpriteSelectionHash = ComputeSpriteSelectionHash(effectiveSpriteSetIDs)
		selectedSpriteSetCount = len(effectiveSpriteSetIDs)
	}

	hash := sha256.Sum256(data)
	if request.ExpectedSHA != "" && !strings.EqualFold(hex.EncodeToString(hash[:]), request.ExpectedSHA) {
		return PlanResult{}, errors.New("archive_hash_mismatch")
	}

	plannedFiles, warnings, report, err := parseArchiveFiles(data, request.Category, isSelectedSpritepack, effectiveSpriteSetIDs)
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
		OperationID:            request.OperationID,
		InstallationID:         request.ModID,
		ModID:                  request.ModID,
		VersionID:              request.VersionID,
		Version:                request.Version,
		Title:                  request.Title,
		Priority:               request.Priority,
		Files:                  plannedFiles,
		SpriteSetIDs:           effectiveSpriteSetIDs,
		SpriteSelectionHash:    effectiveSpriteSelectionHash,
		SelectedSpriteSetCount: selectedSpriteSetCount,
	})
	if err != nil {
		return PlanResult{}, err
	}

	s.mu.Lock()
	if s.activePlanArchiveID != "" && s.activePlanArchiveID != request.ArchiveID && s.stagingMgr != nil {
		s.stagingMgr.ReleaseArchive(s.activePlanArchiveID)
	}
	s.activePlanArchiveID = request.ArchiveID
	s.activePlan = plan
	s.activePlanRequest = request
	s.activePlanArchive = data
	s.activePlanHash = hash
	s.activePlanReport = report
	s.mu.Unlock()

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

	priorityVal := request.Priority
	if plan.NewManifest != nil {
		if inst, ok := plan.NewManifest.Installations[request.ModID]; ok {
			priorityVal = inst.Priority
		}
	}

	return PlanResult{
		PlanID:                 plan.PlanID,
		OperationID:            plan.OperationID,
		BackupID:               fmt.Sprintf("snapshot_%s", plan.OperationID),
		Root:                   s.root,
		Generation:             plan.Generation,
		Kind:                   kind,
		TargetID:               request.ModID,
		ModTitle:               request.Title,
		Version:                request.Version,
		Priority:               priorityVal,
		SpriteSetIDs:           effectiveSpriteSetIDs,
		SpriteSelectionHash:    effectiveSpriteSelectionHash,
		SelectedSpriteSetCount: selectedSpriteSetCount,
		Actions:                actions,
		CleanupPaths:           plan.CleanupPaths,
		Blockers:               plan.Blockers,
		Risks:                  risks,
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
	if err := s.checkStorageAccess(); err != nil {
		return PlanResult{}, err
	}
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

	s.mu.Lock()
	if s.activePlanArchiveID != "" && s.stagingMgr != nil {
		s.stagingMgr.ReleaseArchive(s.activePlanArchiveID)
	}
	s.activePlanArchiveID = ""
	s.activePlanArchive = nil
	s.activePlan = plan
	s.activePlanRequest = targetID
	s.mu.Unlock()

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
			reason = "仅移除归属，保留更高优先级文件"
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
		PlanID:       plan.PlanID,
		OperationID:  plan.OperationID,
		BackupID:     fmt.Sprintf("snapshot_%s", plan.OperationID),
		Root:         s.root,
		Generation:   plan.Generation,
		Kind:         "uninstall",
		TargetID:     targetID,
		Actions:      actions,
		CleanupPaths: plan.CleanupPaths,
		Blockers:     plan.Blockers,
		Risks:        risks,
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
	if err := s.checkStorageAccess(); err != nil {
		return nil, err
	}
	if s.core == nil {
		if _, err := s.SetMASRoot(s.root); err != nil {
			return nil, err
		}
	}
	return s.core.GetPriorityOverview()
}

func (s *DesktopService) PreviewPriority(priorities map[string]int) (PlanResult, error) {
	if err := s.checkStorageAccess(); err != nil {
		return PlanResult{}, err
	}
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
	s.mu.Lock()
	if s.activePlanArchiveID != "" && s.stagingMgr != nil {
		s.stagingMgr.ReleaseArchive(s.activePlanArchiveID)
	}
	s.activePlan = plan
	s.activePlanRequest = priorities
	s.activePlanArchiveID = ""
	s.activePlanArchive = nil
	s.mu.Unlock()

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
		cSrc := s.resolveSourceTitle(act.CurrentSource, manifest)
		tSrc := s.resolveSourceTitle(act.TargetSource, manifest)

		actions = append(actions, PlanPreviewAction{
			Path:           act.Path,
			Action:         actionStr,
			CurrentSource:  cSrc,
			TargetSource:   tSrc,
			CurrentHash:    act.CurrentHash,
			TargetHash:     act.TargetHash,
			CurrentExists:  act.CurrentExists,
			TargetExists:   act.TargetExists,
			BackupRequired: false,
			Reason:         reasonStr,
		})
	}

	return PlanResult{
		PlanID:       plan.PlanID,
		OperationID:  plan.OperationID,
		BackupID:     fmt.Sprintf("snapshot_%s", plan.OperationID),
		Root:         s.root,
		Generation:   plan.Generation,
		Kind:         "priority",
		TargetID:     "priority_adjustment",
		ModTitle:     "模组优先级调整",
		Version:      "",
		Actions:      actions,
		CleanupPaths: plan.CleanupPaths,
		Blockers:     plan.Blockers,
		Risks:        []PlanPreviewRisk{},
		Summary: PlanPreviewSummary{
			RestoresOriginal: plan.Summary.RestoresOriginal,
			RestoresLayer:    plan.Summary.RestoresLayer,
			MetadataOnly:     plan.Summary.MetadataOnly,
			DeletesAdded:     plan.Summary.DeletesAdded,
			WritesNew:        plan.Summary.WritesNew,
		},
	}, nil
}

func (s *DesktopService) PreviewRepair(targetID string) (PlanResult, error) {
	if err := s.checkStorageAccess(); err != nil {
		return PlanResult{}, err
	}
	if s.core == nil {
		if _, err := s.SetMASRoot(s.root); err != nil {
			return PlanResult{}, err
		}
	}
	targetID = strings.TrimSpace(targetID)
	if targetID == "" {
		return PlanResult{}, errors.New("target_id_required")
	}

	plan, err := s.core.PreviewRepair(targetID, fmt.Sprintf("repair_%d", time.Now().UnixNano()))
	if err != nil {
		return PlanResult{}, err
	}
	actions := make([]PlanPreviewAction, 0, len(plan.Actions))
	for _, action := range plan.Actions {
		kind := "METADATA_ONLY"
		reason := "仅确认托管层记录；无需写入磁盘"
		if action.Action == core.ActionWrite {
			kind = "CREATE"
			reason = "恢复当前活动托管层；保留现有文件备份"
			if action.CurrentExists {
				kind = "OVERWRITE"
			}
		}
		actions = append(actions, PlanPreviewAction{Path: action.Path, Action: kind, CurrentSource: action.CurrentSource, TargetSource: action.TargetSource, CurrentHash: action.CurrentHash, TargetHash: action.TargetHash, CurrentExists: action.CurrentExists, TargetExists: action.TargetExists, BackupRequired: action.Action == core.ActionWrite && action.CurrentExists, Reason: reason})
	}
	risks := make([]PlanPreviewRisk, 0, len(plan.Risks))
	for _, risk := range plan.Risks {
		risks = append(risks, PlanPreviewRisk{Type: risk.Type, Path: risk.Path, Description: risk.Description})
	}

	s.mu.Lock()
	if s.activePlanArchiveID != "" && s.stagingMgr != nil {
		s.stagingMgr.ReleaseArchive(s.activePlanArchiveID)
	}
	s.activePlanArchiveID = ""
	s.activePlanArchive = nil
	s.activePlan = plan
	s.activePlanRequest = plan.TargetInstallationID
	s.mu.Unlock()

	return PlanResult{PlanID: plan.PlanID, OperationID: plan.OperationID, Root: plan.Root, Generation: plan.Generation, Kind: "repair", TargetID: plan.TargetInstallationID, ModTitle: plan.ModTitle, Version: plan.Version, Actions: actions, CleanupPaths: plan.CleanupPaths, Blockers: plan.Blockers, Risks: risks, SpriteSetIDs: plan.SpriteSetIDs, SpriteSelectionHash: plan.SpriteSelectionHash, SelectedSpriteSetCount: plan.SelectedSpriteSetCount, Summary: PlanPreviewSummary{WritesNew: plan.Summary.WritesNew, MetadataOnly: plan.Summary.MetadataOnly}}, nil
}

func (s *DesktopService) PreviewUninstall(targetID string) (PlanResult, error) {
	if err := s.checkStorageAccess(); err != nil {
		return PlanResult{}, err
	}
	return s.PreviewUninstallWithOpID(targetID, "")
}

func (s *DesktopService) ExecutePlan(request ExecutePlanRequest) (ArchiveInstallResult, error) {
	finish, err := s.mutations.begin()
	if err != nil {
		return ArchiveInstallResult{}, err
	}
	defer finish()

	if err := s.checkStorageAccess(); err != nil {
		return ArchiveInstallResult{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

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
		var externalBlocker string
		for _, b := range s.activePlan.Blockers {
			if strings.HasPrefix(b, "external_change") {
				externalBlocker = b
				break
			}
		}
		if externalBlocker != "" {
			return ArchiveInstallResult{}, &core.Error{Code: "external_change", Err: errors.New(externalBlocker)}
		}
		return ArchiveInstallResult{}, errors.New("plan_blocked")
	}

	plan := s.activePlan
	s.activePlan = nil
	activeReq := s.activePlanRequest
	s.activePlanRequest = nil
	activeArchive := s.activePlanArchive
	s.activePlanArchive = nil
	activeReport := s.activePlanReport
	s.activePlanReport = packagezip.Report{}
	activeHash := s.activePlanHash
	s.activePlanHash = [32]byte{}
	archiveID := s.activePlanArchiveID
	s.activePlanArchiveID = ""

	defer func() {
		if req, ok := activeReq.(ArchiveInstallRequest); ok && req.ArchiveID != "" && s.stagingMgr != nil {
			s.stagingMgr.ReleaseArchive(req.ArchiveID)
		} else if archiveID != "" && s.stagingMgr != nil {
			s.stagingMgr.ReleaseArchive(archiveID)
		}
	}()
	tx, err := s.core.NewTransaction(plan)
	if err != nil {
		return ArchiveInstallResult{}, err
	}
	defer tx.Close()

	// Coordinate receipt update atomically within transaction boundary
	if plan.OperationType == "install" || plan.OperationType == "update" {
		req, ok := activeReq.(ArchiveInstallRequest)
		if ok && req.ModID != "" {
			newReceipts, pErr := s.projectedInstalledArchives(
				req,
				activeReport,
				hex.EncodeToString(activeHash[:]),
				int64(len(activeArchive)),
				plan.SpriteSetIDs,
				plan.SpriteSelectionHash,
				plan.SelectedSpriteSetCount,
			)
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
		targetID, ok := activeReq.(string)
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
	} else if plan.OperationType == "adopt" {
		req, ok := activeReq.(AdoptRequest)
		if ok {
			newReceipts, pErr := s.projectedAdoptInstalledArchive(req, plan)
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
		return ArchiveInstallResult{}, err
	}

	s.pruneFinishedTransactions()

	return ArchiveInstallResult{
		State:                  "committed",
		Files:                  len(plan.Actions),
		Warnings:               []string{},
		SpriteSetIDs:           plan.SpriteSetIDs,
		SpriteSelectionHash:    plan.SpriteSelectionHash,
		SelectedSpriteSetCount: plan.SelectedSpriteSetCount,
	}, nil
}

// pruneFinishedTransactions applies the transaction retention window. It never
// blocks an install/update/repair and never deletes unfinished recovery
// material; see core.Installer.PruneCompleted for the exact rules. It runs
// synchronously on purpose: the pass holds the instance lock, so overlapping it
// with the next operation would surface as instance_busy.
//
// Targets staged by a preview that has not been confirmed yet need no plan
// plumbing here: they are protected by their blob timestamps, which BlobStore.Put
// refreshes on every staging.
func (s *DesktopService) pruneFinishedTransactions() {
	if s == nil || s.core == nil {
		return
	}
	result, err := s.core.PruneCompleted(time.Now())
	if err != nil {
		log.Printf("Transaction retention: %v", err)
		return
	}
	if result.Skipped {
		return
	}
	if result.DeletedJournals > 0 || result.DeletedLegacyJournals > 0 || result.DeletedBlobs > 0 {
		log.Printf(
			"Transaction retention: removed %d finished journals (kept %d), %d legacy journals + %d legacy backup files (kept %d legacy), %d blobs (kept %d), freed %d bytes",
			result.DeletedJournals, result.RetainedJournals,
			result.DeletedLegacyJournals, result.DeletedLegacyBackups, result.RetainedLegacyJournals,
			result.DeletedBlobs, result.RetainedBlobs, result.FreedBytes,
		)
	}
}

func (s *DesktopService) ApplyArchive(request ArchiveInstallRequest) (ArchiveInstallResult, error) {
	if err := s.checkStorageAccess(); err != nil {
		return ArchiveInstallResult{}, err
	}
	preview, err := s.PreviewArchive(request)
	if err != nil {
		return ArchiveInstallResult{}, err
	}
	if len(preview.Blockers) > 0 {
		for _, b := range preview.Blockers {
			if strings.HasPrefix(b, "external_change") {
				return ArchiveInstallResult{}, &core.Error{Code: "external_change", Err: errors.New(b)}
			}
		}
		return ArchiveInstallResult{}, fmt.Errorf("plan_blocked: %s", strings.Join(preview.Blockers, "; "))
	}
	return s.ExecutePlan(ExecutePlanRequest{
		PlanID:    preview.PlanID,
		Confirmed: true,
	})
}

func (s *DesktopService) Uninstall(operationID, uninstallOperationID string) (string, error) {
	if err := s.checkStorageAccess(); err != nil {
		return "", err
	}
	preview, err := s.PreviewUninstallWithOpID(operationID, uninstallOperationID)
	if err != nil {
		return "", err
	}
	if len(preview.Blockers) > 0 {
		for _, b := range preview.Blockers {
			if strings.HasPrefix(b, "external_change") {
				return "", &core.Error{Code: "external_change", Err: errors.New(b)}
			}
		}
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

func (s *DesktopService) resolveSourceTitle(src string, manifest *core.Manifest) string {
	title := resolveSourceTitle(src, manifest)
	if title != src {
		return title
	}
	if receipts, err := s.ListInstalledArchives(); err == nil {
		for _, rec := range receipts {
			if rec.ModID == src || rec.OperationID == src {
				if rec.Title != "" {
					return rec.Title
				}
			}
		}
	}
	return src
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
	if err := s.checkStorageAccess(); err != nil {
		return nil, err
	}
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
