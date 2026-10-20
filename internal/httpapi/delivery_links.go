package httpapi

import (
	"context"
	"errors"
	"github.com/reze/submodhub/internal/cloudreve"
	"time"
)

type deliveryLinkKey struct {
	NodeID   string
	Revision uint64
	FileID   string
}
type deliveryLinkEntry struct {
	Link      cloudreve.Link
	RetryAt   time.Time
	Resolving bool
}

// One provider request per node at a time. Contending public requests fall
// through immediately instead of queueing behind a provider or mirror upload.
func (s *Store) resolveCloudreveLink(ctx context.Context, n DeliveryNode, fileID string) (cloudreve.Link, error) {
	key := deliveryLinkKey{n.ID, n.Revision, fileID}
	rt := &s.deliveryRuntime
	rt.mu.Lock()
	if rt.links == nil {
		rt.links = map[deliveryLinkKey]deliveryLinkEntry{}
	}
	now := time.Now()
	entry := rt.links[key]
	if entry.Link.ExpiresAt.After(now.Add(30 * time.Second)) {
		rt.mu.Unlock()
		return entry.Link, nil
	}
	if entry.RetryAt.After(now) {
		rt.mu.Unlock()
		return cloudreve.Link{}, errors.New("provider_backoff")
	}
	for k, v := range rt.links {
		if k.NodeID == n.ID && (v.Resolving || v.RetryAt.After(now)) {
			rt.mu.Unlock()
			return cloudreve.Link{}, errors.New("provider_busy")
		}
	}
	// Bound expired metadata, independently of the catalog and number of requests.
	for k, v := range rt.links {
		if !v.Resolving && !v.Link.ExpiresAt.After(now) && !v.RetryAt.After(now) {
			delete(rt.links, k)
		}
	}
	if len(rt.links) >= 1024 {
		rt.mu.Unlock()
		return cloudreve.Link{}, errors.New("provider_cache_busy")
	}
	entry.Resolving = true
	rt.links[key] = entry
	rt.mu.Unlock()
	short, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	client, err := s.cloudreveClient(n)
	var link cloudreve.Link
	if err == nil {
		link, err = client.Download(short, fileID)
	}
	rt.mu.Lock()
	entry = deliveryLinkEntry{Link: link}
	if err != nil {
		entry.RetryAt = time.Now().Add(30 * time.Second)
	}
	rt.links[key] = entry
	rt.mu.Unlock()
	return link, err
}
