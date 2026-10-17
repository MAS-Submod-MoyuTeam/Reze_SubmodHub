package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

func (s *DesktopService) MatchRegistrations(names []string) (string, error) {
	payload, err := json.Marshal(struct {
		Names []string `json:"names"`
	}{Names: names})
	if err != nil {
		return "", err
	}
	request, err := http.NewRequest(http.MethodPost, strings.TrimRight(s.apiURL, "/")+"/api/v1/registrations/match", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 30 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("registration_match_http_%d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, (4<<20)+1))
	if err != nil {
		return "", err
	}
	if len(body) > 4<<20 || !json.Valid(body) {
		return "", fmt.Errorf("invalid_registration_match_response")
	}
	return string(body), nil
}
