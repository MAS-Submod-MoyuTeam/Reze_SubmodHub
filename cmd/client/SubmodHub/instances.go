package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	core "github.com/reze/submodhub/internal/install"
	"github.com/reze/submodhub/internal/maspath"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type MASInstance struct {
	ID     string    `json:"id"`
	Label  string    `json:"label"`
	Root   string    `json:"root"`
	Status MASStatus `json:"status"`
}

type MASInstancesState struct {
	Instances []MASInstance `json:"instances"`
	ActiveID  string        `json:"active_id"`
}

func (s *DesktopService) loadInstances() error {
	if s.loaded {
		return nil
	}
	data, err := os.ReadFile(s.configPath)
	if errors.Is(err, os.ErrNotExist) {
		s.instances = []MASInstance{}
		s.loaded = true
		return nil
	}
	if err != nil {
		return err
	}
	var stored MASInstancesState
	if err := json.Unmarshal(data, &stored); err != nil {
		return err
	}
	s.loaded = true
	s.instances, s.activeID = stored.Instances, stored.ActiveID
	for _, instance := range s.instances {
		if instance.ID == s.activeID {
			if _, err := s.SetMASRoot(instance.Root); err != nil {
				s.activeID = ""
			}
			break
		}
	}
	return nil
}

func (s *DesktopService) saveInstances() error {
	if err := os.MkdirAll(filepath.Dir(s.configPath), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(MASInstancesState{Instances: s.instances, ActiveID: s.activeID}, "", "  ")
	if err != nil {
		return err
	}
	temp := s.configPath + ".tmp"
	if err := os.WriteFile(temp, data, 0o600); err != nil {
		return err
	}
	if err := os.Rename(temp, s.configPath); err != nil {
		_ = os.Remove(temp)
		return err
	}
	return nil
}

func (s *DesktopService) ListMASInstances() (MASInstancesState, error) {
	if s.isAndroid() {
		fixedRoot := maspath.AndroidMASRoot
		status := MASStatus{
			Root:           fixedRoot,
			GamePath:       maspath.AndroidGameDirectory(),
			Valid:          false,
			GameExists:     false,
			AvailableBytes: 0,
		}
		if s.checkStorageAccess() == nil {
			status = inspectMASRoot(fixedRoot)
		}
		return MASInstancesState{
			Instances: []MASInstance{
				{
					ID:     "android-mas",
					Label:  "MAS (Android)",
					Root:   fixedRoot,
					Status: status,
				},
			},
			ActiveID: "android-mas",
		}, nil
	}

	if err := s.loadInstances(); err != nil {
		return MASInstancesState{}, err
	}
	items := make([]MASInstance, len(s.instances))
	copy(items, s.instances)
	for i := range items {
		items[i].Status = inspectMASRoot(items[i].Root)
	}
	return MASInstancesState{Instances: items, ActiveID: s.activeID}, nil
}

func inspectMASRoot(root string) MASStatus {
	game := filepath.Join(root, "game")
	var avail int64
	if space, err := core.GetAvailableDiskSpace(root); err == nil {
		avail = int64(space)
	}
	status := MASStatus{Root: root, GamePath: game, Valid: fileExists(root), GameExists: fileExists(game), AvailableBytes: avail}
	if entries, err := os.ReadDir(filepath.Join(game, "Submods")); err == nil {
		for _, entry := range entries {
			if entry.IsDir() {
				status.Submods++
			}
		}
	}
	return status
}

func (s *DesktopService) AddMASInstance(label, root string) (MASInstancesState, error) {
	if s.isAndroid() {
		return MASInstancesState{}, errors.New("unsupported_platform")
	}
	if err := s.loadInstances(); err != nil {
		return MASInstancesState{}, err
	}
	root = filepath.Clean(strings.TrimSpace(root))
	if !filepath.IsAbs(root) || !fileExists(filepath.Join(root, "game")) {
		return MASInstancesState{}, errors.New("mas_game_directory_missing")
	}
	for _, item := range s.instances {
		if strings.EqualFold(item.Root, root) {
			return MASInstancesState{}, errors.New("mas_instance_already_exists")
		}
	}
	label = strings.TrimSpace(label)
	if label == "" {
		label = filepath.Base(root)
	}
	instance := MASInstance{ID: fmt.Sprintf("mas-%d", time.Now().UnixNano()), Label: label, Root: root}
	s.instances = append(s.instances, instance)
	previousID := s.activeID
	s.activeID = instance.ID
	if _, err := s.SetMASRoot(root); err != nil {
		s.instances = s.instances[:len(s.instances)-1]
		s.activeID = previousID
		return MASInstancesState{}, err
	}
	if err := s.saveInstances(); err != nil {
		return MASInstancesState{}, err
	}
	return s.ListMASInstances()
}

func (s *DesktopService) SelectMASInstance(id string) (MASInstancesState, error) {
	if s.isAndroid() {
		if id != "android-mas" && id != "" {
			return MASInstancesState{}, errors.New("mas_instance_not_found")
		}
		if _, err := s.SetMASRoot(maspath.AndroidMASRoot); err != nil {
			return MASInstancesState{}, err
		}
		return s.ListMASInstances()
	}

	if err := s.loadInstances(); err != nil {
		return MASInstancesState{}, err
	}
	for _, item := range s.instances {
		if item.ID == id {
			if _, err := s.SetMASRoot(item.Root); err != nil {
				return MASInstancesState{}, err
			}
			s.activeID = id
			if err := s.saveInstances(); err != nil {
				return MASInstancesState{}, err
			}
			return s.ListMASInstances()
		}
	}
	return MASInstancesState{}, errors.New("mas_instance_not_found")
}

func (s *DesktopService) RemoveMASInstance(id string) (MASInstancesState, error) {
	if s.isAndroid() {
		return MASInstancesState{}, errors.New("unsupported_platform")
	}
	if err := s.loadInstances(); err != nil {
		return MASInstancesState{}, err
	}
	for i, item := range s.instances {
		if item.ID == id {
			s.instances = append(s.instances[:i], s.instances[i+1:]...)
			if s.activeID == id {
				s.activeID = ""
				s.root = ""
				s.core = nil
				s.state = ""
			}
			if err := s.saveInstances(); err != nil {
				return MASInstancesState{}, err
			}
			return s.ListMASInstances()
		}
	}
	return MASInstancesState{}, errors.New("mas_instance_not_found")
}

func (s *DesktopService) LaunchMASInstance(id string) error {
	if s.isAndroid() {
		return errors.New("unsupported_platform")
	}
	if err := s.loadInstances(); err != nil {
		return err
	}
	for _, instance := range s.instances {
		if instance.ID != id {
			continue
		}
		if !fileExists(filepath.Join(instance.Root, "game")) {
			return errors.New("mas_game_directory_missing")
		}
		executable := filepath.Join(instance.Root, "DDLC.exe")
		info, err := os.Stat(executable)
		if errors.Is(err, os.ErrNotExist) || (err == nil && info.IsDir()) {
			return errors.New("mas_executable_missing")
		}
		if err != nil {
			return err
		}
		cmd := exec.Command(executable)
		cmd.Dir = instance.Root
		if err := cmd.Start(); err != nil {
			return err
		}
		return cmd.Process.Release()
	}
	return errors.New("mas_instance_not_found")
}

func (s *DesktopService) BrowseMASDirectory() (string, error) {
	if s.isAndroid() {
		return "", errors.New("unsupported_platform")
	}
	return application.Get().Dialog.OpenFile().CanChooseFiles(false).CanChooseDirectories(true).SetTitle("选择 MAS 游戏根目录").PromptForSingleSelection()
}
