package main

import (
	"errors"
	"testing"
)

type mockStorageAccessProvider struct {
	status   AndroidStorageAccessStatus
	reqRes   AndroidStorageAccessRequestResult
	statErr  error
	reqErr   error
	reqCount int
}

func (m *mockStorageAccessProvider) GetStorageAccess() (AndroidStorageAccessStatus, error) {
	if m.statErr != nil {
		return AndroidStorageAccessStatus{State: "error"}, m.statErr
	}
	return m.status, nil
}

func (m *mockStorageAccessProvider) RequestStorageAccess() (AndroidStorageAccessRequestResult, error) {
	m.reqCount++
	if m.reqErr != nil {
		return AndroidStorageAccessRequestResult{Opened: false, Error: m.reqErr.Error()}, m.reqErr
	}
	return m.reqRes, nil
}

func TestStorageAccessGuard_DefaultDeny(t *testing.T) {
	cases := []struct {
		name    string
		state   string
		statErr error
	}{
		{name: "empty_state", state: ""},
		{name: "denied", state: "denied"},
		{name: "unsupported", state: "unsupported"},
		{name: "error_state", state: "error"},
		{name: "unknown_state", state: "pending"},
		{name: "provider_error", state: "", statErr: errors.New("jni failure")},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			provider := &mockStorageAccessProvider{
				status:  AndroidStorageAccessStatus{State: tc.state},
				statErr: tc.statErr,
			}
			guard := NewStorageAccessGuard(provider)
			err := guard.Check()
			if err == nil {
				t.Fatalf("expected Check() to fail for state %q, but got nil", tc.state)
			}
			if !errors.Is(err, ErrPermissionLost) && err.Error() != "permission_lost" {
				t.Fatalf("expected ErrPermissionLost, got: %v", err)
			}
		})
	}
}

func TestStorageAccessGuard_GrantedSucceeds(t *testing.T) {
	provider := &mockStorageAccessProvider{
		status: AndroidStorageAccessStatus{
			State:    "granted",
			Root:     "/storage/emulated/0/MAS/",
			GamePath: "/storage/emulated/0/MAS/game",
		},
	}
	guard := NewStorageAccessGuard(provider)
	if err := guard.Check(); err != nil {
		t.Fatalf("expected Check() to succeed when granted, got: %v", err)
	}
}

func TestStorageAccessGuard_RequestSettingsDoesNotChangeState(t *testing.T) {
	provider := &mockStorageAccessProvider{
		status: AndroidStorageAccessStatus{State: "denied"},
		reqRes: AndroidStorageAccessRequestResult{Opened: true},
	}
	guard := NewStorageAccessGuard(provider)

	// Before requesting, check must fail
	if err := guard.Check(); err == nil {
		t.Fatal("expected Check() to fail initially")
	}

	// Request opening settings
	res, err := guard.RequestAccess()
	if err != nil {
		t.Fatalf("unexpected error on RequestAccess: %v", err)
	}
	if !res.Opened {
		t.Fatal("expected Opened == true")
	}

	// Check() MUST still fail after settings page opened, because provider status is still denied!
	if err := guard.Check(); err == nil {
		t.Fatal("expected Check() to still fail after settings opened because permission is not granted")
	}
}

func TestStorageAccessGuard_RevocationDetectedImmediately(t *testing.T) {
	provider := &mockStorageAccessProvider{
		status: AndroidStorageAccessStatus{State: "granted"},
	}
	guard := NewStorageAccessGuard(provider)

	if err := guard.Check(); err != nil {
		t.Fatalf("expected Check() to pass initially, got: %v", err)
	}

	// User revokes permission in background
	provider.status = AndroidStorageAccessStatus{State: "denied"}

	// Fresh call must fail immediately
	err := guard.Check()
	if err == nil {
		t.Fatal("expected Check() to fail immediately after revocation")
	}
	if !errors.Is(err, ErrPermissionLost) && err.Error() != "permission_lost" {
		t.Fatalf("expected ErrPermissionLost, got: %v", err)
	}
}
