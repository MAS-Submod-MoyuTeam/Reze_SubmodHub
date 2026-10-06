package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"regexp"

	core "github.com/reze/submodhub/internal/install"
	packagezip "github.com/reze/submodhub/internal/package"
)

const defaultMASRoot = `E:\MAS_Cn001280\MAS_CN0012F0`

type MASStatus struct {
	Root       string `json:"root"`
	GamePath   string `json:"game_path"`
	Valid      bool   `json:"valid"`
	GameExists bool   `json:"game_exists"`
	Submods    int    `json:"submods"`
}
type InstallRequest struct {
	OperationID string `json:"operation_id"`
	Path        string `json:"path"`
	Content     string `json:"content"`
	ExpectedSHA string `json:"expected_sha256"`
}
type ArchiveInstallRequest struct {
	OperationID   string `json:"operation_id"`
	ArchiveBase64 string `json:"archive_base64"`
	ExpectedSHA   string `json:"expected_sha256"`
}
type ArchiveInstallResult struct {
	State    string   `json:"state"`
	Files    int      `json:"files"`
	Warnings []string `json:"warnings"`
}
type LocalSubmodFile struct { Path string `json:"path"`; SHA256 string `json:"sha256"`; Size int64 `json:"size"` }
type LocalSubmod struct { Directory string `json:"directory"`; Name string `json:"name"`; Version string `json:"version"`; Files []LocalSubmodFile `json:"files"` }
type DesktopService struct {
	root  string
	state string
	core  *core.Installer
}

func NewDesktopService() *DesktopService {
	root := os.Getenv("SUBMODHUB_MAS_ROOT")
	if root == "" && os.PathSeparator == '\\' {
		root = defaultMASRoot
	}
	return &DesktopService{root: root}
}
func (s *DesktopService) SetMASRoot(root string) (MASStatus, error) {
	root = filepath.Clean(strings.TrimSpace(root))
	if root == "." || root == "" || !filepath.IsAbs(root) {
		return MASStatus{}, errors.New("invalid_mas_root")
	}
	s.root = root
	s.state = filepath.Join(root, ".submodhub", "state")
	s.core = core.New(root, s.state)
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
	return MASStatus{Root: s.root, GamePath: game, Valid: fileExists(s.root), GameExists: fileExists(game), Submods: count}, nil
}
func (s *DesktopService) ScanLocalSubmods() ([]LocalSubmod, error) {
	if s.root == "" { return nil, errors.New("mas_root_not_configured") }
	base := filepath.Join(s.root, "game", "Submods")
	entries, err := os.ReadDir(base); if err != nil { if os.IsNotExist(err) { return []LocalSubmod{}, nil }; return nil, err }
	nameRe := regexp.MustCompile(`(?s)Submod\s*\(.*?\bname\s*=\s*["']([^"']+)["'].*?\bversion\s*=\s*["']([^"']+)["']`)
	result := make([]LocalSubmod, 0)
	for _, entry := range entries {
		if !entry.IsDir() { continue }
		root := filepath.Join(base, entry.Name()); item := LocalSubmod{Directory: entry.Name()}
		err = filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
			if walkErr != nil { return walkErr }; if info.IsDir() { return nil }
			b, readErr := os.ReadFile(path); if readErr != nil { return readErr }
			h := sha256.Sum256(b); rel, relErr := filepath.Rel(filepath.Join(s.root, "game"), path); if relErr != nil { return relErr }
			item.Files = append(item.Files, LocalSubmodFile{Path: filepath.ToSlash(filepath.Join("game", rel)), SHA256: hex.EncodeToString(h[:]), Size: info.Size()})
			if item.Name == "" && (strings.HasSuffix(strings.ToLower(path), ".rpy") || strings.HasSuffix(strings.ToLower(path), ".rpym") || strings.HasSuffix(strings.ToLower(path), ".py")) { if m := nameRe.FindSubmatch(b); len(m) == 3 { item.Name, item.Version = string(m[1]), string(m[2]) } }
			return nil
		}); if err != nil { return nil, err }
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
func (s *DesktopService) Uninstall(operationID, uninstallOperationID string) (string, error) {
	if s.core == nil {
		if _, err := s.SetMASRoot(s.root); err != nil {
			return "", err
		}
	}
	if operationID == "" || uninstallOperationID == "" {
		return "", errors.New("operation_id_required")
	}
	if err := s.core.Uninstall(operationID, uninstallOperationID); err != nil {
		return "", err
	}
	return "committed", nil
}
func (s *DesktopService) ApplyArchive(request ArchiveInstallRequest) (ArchiveInstallResult, error) {
	if s.core == nil {
		if _, err := s.SetMASRoot(s.root); err != nil {
			return ArchiveInstallResult{}, err
		}
	}
	if request.OperationID == "" {
		return ArchiveInstallResult{}, errors.New("operation_id_required")
	}
	data, err := base64.StdEncoding.DecodeString(request.ArchiveBase64)
	if err != nil {
		return ArchiveInstallResult{}, errors.New("invalid_archive_base64")
	}
	hash := sha256.Sum256(data)
	if request.ExpectedSHA != "" && !strings.EqualFold(hex.EncodeToString(hash[:]), request.ExpectedSHA) {
		return ArchiveInstallResult{}, errors.New("archive_hash_mismatch")
	}
	report, err := packagezip.Scan(bytes.NewReader(data), int64(len(data)), packagezip.Limits{})
	if err != nil {
		return ArchiveInstallResult{}, err
	}
	z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return ArchiveInstallResult{}, err
	}
	bySource := make(map[string]*zip.File, len(z.File))
	for _, entry := range z.File {
		bySource[entry.Name] = entry
	}
	changes := make([]core.Change, 0, len(report.Files))
	for _, file := range report.Files {
		entry := bySource[file.Source]
		if entry == nil {
			return ArchiveInstallResult{}, errors.New("archive_entry_missing")
		}
		reader, openErr := entry.Open()
		if openErr != nil {
			return ArchiveInstallResult{}, openErr
		}
		content, readErr := io.ReadAll(reader)
		_ = reader.Close()
		if readErr != nil {
			return ArchiveInstallResult{}, readErr
		}
		changes = append(changes, core.Change{Path: filepath.ToSlash(filepath.Join("game", file.Target)), Content: content})
	}
	if err := s.core.Apply(core.Operation{ID: request.OperationID, Changes: changes}); err != nil {
		return ArchiveInstallResult{}, err
	}
	return ArchiveInstallResult{State: "committed", Files: len(changes), Warnings: report.Warnings}, nil
}
func fileExists(path string) bool { info, err := os.Stat(path); return err == nil && info.IsDir() }
