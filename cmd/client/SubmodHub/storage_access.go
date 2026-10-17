package main

import (
	"errors"
	"strings"

	"github.com/reze/submodhub/internal/maspath"
)

var (
	ErrPermissionLost = errors.New("permission_lost")
	ErrInvalidMASRoot = errors.New("invalid_mas_root")
)

type AndroidStorageAccessStatus struct {
	State    string `json:"state"` // "granted" | "denied" | "unsupported" | "error"
	Root     string `json:"root"`
	GamePath string `json:"game_path"`
}

type AndroidStorageAccessRequestResult struct {
	Opened bool   `json:"opened"`
	Error  string `json:"error,omitempty"`
}

type StorageAccessProvider interface {
	GetStorageAccess() (AndroidStorageAccessStatus, error)
	RequestStorageAccess() (AndroidStorageAccessRequestResult, error)
}

type StorageAccessGuard struct {
	provider StorageAccessProvider
}

func NewStorageAccessGuard(provider StorageAccessProvider) *StorageAccessGuard {
	return &StorageAccessGuard{provider: provider}
}

// Check evaluates the real-time storage permission state.
// Any state other than "granted" returns ErrPermissionLost.
func (g *StorageAccessGuard) Check() error {
	if g.provider == nil {
		return ErrPermissionLost
	}
	status, err := g.provider.GetStorageAccess()
	if err != nil {
		return ErrPermissionLost
	}
	if strings.ToLower(strings.TrimSpace(status.State)) != "granted" {
		return ErrPermissionLost
	}
	return nil
}

func (g *StorageAccessGuard) RequestAccess() (AndroidStorageAccessRequestResult, error) {
	if g.provider == nil {
		return AndroidStorageAccessRequestResult{Opened: false, Error: "no_provider"}, errors.New("no_storage_access_provider")
	}
	return g.provider.RequestStorageAccess()
}

func defaultAndroidStorageStatus() AndroidStorageAccessStatus {
	return AndroidStorageAccessStatus{
		State:    "denied",
		Root:     maspath.AndroidMASRoot,
		GamePath: maspath.AndroidGameDirectory(),
	}
}
