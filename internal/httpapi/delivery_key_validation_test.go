package httpapi

import (
	"strings"
	"testing"
)

func TestRelayNodeRejectsShortCredential(t *testing.T) {
	in := deliveryNodeInput{ID: "relay", Name: "Relay", Type: "github_relay", Weight: 1, Capabilities: []string{"github"}, BaseURL: "https://relay.example", Password: "short"}
	if _, err := in.node(); err == nil {
		t.Fatal("short relay authorization key accepted")
	}
	in.Password = strings.Repeat("k", 32)
	if _, err := in.node(); err != nil {
		t.Fatal(err)
	}
	in.Password = ""
	if _, err := in.node(); err != nil {
		t.Fatal("blank edit secret must preserve current key")
	}
}
