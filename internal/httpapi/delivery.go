package httpapi

import (
	"context"
	"crypto/rand"
	"math/big"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/reze/submodhub/internal/delivery"
)

type downloadDescription struct {
	CompletionToken        string    `json:"completion_token"`
	URL                    string    `json:"url"`
	ExpiresAt              time.Time `json:"expires_at"`
	SHA256                 string    `json:"sha256"`
	SizeBytes              int64     `json:"size_bytes"`
	DeliveryType           string    `json:"delivery_type"`
	NodeID                 string    `json:"node_id"`
	AllowedDownloadOrigins []string  `json:"allowed_download_origins"`
	FallbackReason         string    `json:"fallback_reason,omitempty"`
}

func weightedDeliveryOrder(nodes []DeliveryNode) []DeliveryNode {
	pending := slices.Clone(nodes)
	out := make([]DeliveryNode, 0, len(nodes))
	for len(pending) > 0 {
		total := 0
		for _, n := range pending {
			total += max(1, n.Weight)
		}
		selected, err := rand.Int(rand.Reader, big.NewInt(int64(total)))
		index := 0
		if err == nil {
			weight := int(selected.Int64())
			for i, n := range pending {
				weight -= max(1, n.Weight)
				if weight < 0 {
					index = i
					break
				}
			}
		}
		out = append(out, pending[index])
		pending = slices.Delete(pending, index, index+1)
	}
	return out
}
func (s *Store) resolveDelivery(r *http.Request, v Version) downloadDescription {
	out := downloadDescription{URL: "/api/v1/archives/" + v.ID, ExpiresAt: time.Now().UTC().Add(15 * time.Minute), SHA256: v.SHA256, SizeBytes: v.SizeBytes, DeliveryType: "builtin", NodeID: "builtin", AllowedDownloadOrigins: []string{}}
	s.mu.RLock()
	nodes := slices.Clone(s.Catalog.DeliveryNodes)
	mirrors := slices.Clone(s.Catalog.ArchiveMirrors)
	sprite := false
	for _, m := range s.Catalog.Mods {
		if m.ID == v.ModID {
			sprite = m.Category == "spritepack"
			break
		}
	}
	s.mu.RUnlock()
	if r.URL.Query().Get("delivery") == "builtin" {
		out.FallbackReason = "client_requested_builtin"
		return out
	}
	if sprite {
		return out
	}
	ready := []DeliveryNode{}
	relays := []DeliveryNode{}
	for _, n := range nodes {
		if !n.Enabled {
			continue
		}
		if n.Type == "cloudreve" {
			for _, m := range mirrors {
				if m.NodeID == n.ID && m.NodeRevision == n.Revision && m.VersionID == v.ID && m.SHA256 == v.SHA256 && m.SizeBytes == v.SizeBytes && m.State == "ready" && m.FileID != "" {
					ready = append(ready, n)
					break
				}
			}
		}
		if n.Type == "github_relay" && v.GitHubSource != nil {
			relays = append(relays, n)
		}
	}
	forNodesCtx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	for _, n := range weightedDeliveryOrder(ready) {
		fileID := ""
		for _, m := range mirrors {
			if m.NodeID == n.ID && m.NodeRevision == n.Revision && m.VersionID == v.ID && m.SHA256 == v.SHA256 && m.State == "ready" {
				fileID = m.FileID
				break
			}
		}
		link, err := s.resolveCloudreveLink(forNodesCtx, n, fileID)
		if err != nil {
			out.FallbackReason = "external_unavailable"
			continue
		}
		// Resolve outside the Store lock, then recheck the configuration and visibility.
		s.mu.RLock()
		current, exists := s.Catalog.Versions[v.ID]
		valid := exists && current.State == "published" && current.SHA256 == v.SHA256
		active := slices.ContainsFunc(s.Catalog.DeliveryNodes, func(now DeliveryNode) bool { return now.ID == n.ID && now.Enabled && now.Revision == n.Revision })
		s.mu.RUnlock()
		if !valid || !active {
			out.FallbackReason = "delivery_configuration_changed"
			continue
		}
		expiry := minTime(link.ExpiresAt.Add(-15*time.Second), time.Now().Add(5*time.Minute))
		if !expiry.After(time.Now()) {
			continue
		}
		out.URL = link.URL
		out.ExpiresAt = expiry.UTC()
		out.DeliveryType = "cloudreve"
		out.NodeID = n.ID
		out.AllowedDownloadOrigins = slices.Clone(n.AllowedDownloadOrigins)
		out.FallbackReason = ""
		return out
	}
	for _, n := range weightedDeliveryOrder(relays) {
		s.mu.RLock()
		key, err := s.DeliverySecrets.Open(n.ID, n.CredentialCiphertext)
		s.mu.RUnlock()
		if err != nil {
			out.FallbackReason = "external_unavailable"
			continue
		}
		expiry := time.Now().UTC().Add(2 * time.Minute)
		token, err := delivery.SignTicket(key, delivery.Ticket{Audience: n.ID, VersionID: v.ID, SourceURL: v.GitHubSource.DownloadURL, SHA256: v.SHA256, SizeBytes: v.SizeBytes, ExpiresAt: expiry.Unix()})
		if err != nil {
			out.FallbackReason = "external_unavailable"
			continue
		}
		base, err := url.Parse(n.BaseURL)
		if err != nil {
			continue
		}
		origin := base.Scheme + "://" + base.Host
		out.URL = strings.TrimRight(n.BaseURL, "/") + "/download?ticket=" + url.QueryEscape(token)
		out.ExpiresAt = expiry
		out.DeliveryType = "github_relay"
		out.NodeID = n.ID
		out.AllowedDownloadOrigins = []string{origin}
		return out
	}
	if len(nodes) > 0 && out.FallbackReason == "" {
		out.FallbackReason = "no_ready_external_node"
	}
	return out
}
func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}
