package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"slices"
	"sync"
	"time"

	"github.com/reze/submodhub/internal/cloudreve"
)

var errMirrorVerification = errors.New("mirror_verification_failed")

type ArchiveMirror struct {
	NodeID       string    `json:"node_id"`
	NodeRevision uint64    `json:"node_revision"`
	VersionID    string    `json:"version_id"`
	SHA256       string    `json:"sha256"`
	SizeBytes    int64     `json:"size_bytes"`
	ObjectName   string    `json:"object_name"`
	FileID       string    `json:"file_id,omitempty"`
	State        string    `json:"state"`
	Attempts     int       `json:"attempts"`
	RetryAt      time.Time `json:"retry_at"`
	ErrorCode    string    `json:"error_code,omitempty"`
}
type cloudreveSession struct {
	revision uint64
	client   *cloudreve.Client
}
type deliveryRuntime struct {
	links      map[deliveryLinkKey]deliveryLinkEntry
	mu         sync.Mutex
	clients    map[string]cloudreveSession
	workerOnce sync.Once
}

func mirrorCandidate(c Catalog, v Version) bool {
	if v.State != "published" || v.ArchivePath == "" || v.SHA256 == "" {
		return false
	}
	for _, m := range c.Mods {
		if m.ID == v.ModID {
			return !m.Unpublished && m.Category != "spritepack" && (v.SourceType != "github_releases" || m.LatestVersionID == v.ID)
		}
	}
	return false
}
func (s *Store) reconcileMirrors(recoverUploading bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	previous := s.Catalog.ArchiveMirrors
	updated := slices.DeleteFunc(slices.Clone(previous), func(m ArchiveMirror) bool {
		v, ok := s.Catalog.Versions[m.VersionID]
		return !ok || !mirrorCandidate(s.Catalog, v) || v.SHA256 != m.SHA256 || !slices.ContainsFunc(s.Catalog.DeliveryNodes, func(n DeliveryNode) bool { return n.ID == m.NodeID && n.Type == "cloudreve" })
	})
	changed := len(updated) != len(previous)
	for _, n := range s.Catalog.DeliveryNodes {
		if !n.Enabled || n.Type != "cloudreve" {
			continue
		}
		for _, v := range s.Catalog.Versions {
			if !mirrorCandidate(s.Catalog, v) {
				continue
			}
			index := slices.IndexFunc(updated, func(m ArchiveMirror) bool { return m.NodeID == n.ID && m.VersionID == v.ID && m.SHA256 == v.SHA256 })
			fresh := ArchiveMirror{NodeID: n.ID, NodeRevision: n.Revision, VersionID: v.ID, SHA256: v.SHA256, SizeBytes: v.SizeBytes, ObjectName: fmt.Sprintf("%s-%s-%s.zip", v.ModID, v.ID, v.SHA256), State: "pending"}
			if index < 0 {
				updated = append(updated, fresh)
				changed = true
				continue
			}
			old := updated[index]
			if old.NodeRevision != n.Revision {
				updated[index] = fresh
				changed = true
			} else if recoverUploading && old.State == "uploading" {
				old.State = "pending"
				updated[index] = old
				changed = true
			}
		}
	}
	if !changed {
		return nil
	}
	s.Catalog.ArchiveMirrors = updated
	if err := s.saveLocked(); err != nil {
		s.Catalog.ArchiveMirrors = previous
		return err
	}
	return nil
}
func (s *Store) cloudreveClient(n DeliveryNode) (*cloudreve.Client, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	s.deliveryRuntime.mu.Lock()
	defer s.deliveryRuntime.mu.Unlock()
	if s.deliveryRuntime.clients == nil {
		s.deliveryRuntime.clients = map[string]cloudreveSession{}
	}
	if cached, ok := s.deliveryRuntime.clients[n.ID]; ok && cached.revision == n.Revision {
		return cached.client, nil
	}
	password, err := s.DeliverySecrets.Open(n.ID, n.CredentialCiphertext)
	if err != nil {
		return nil, err
	}
	c, err := cloudreve.New(cloudreve.Config{BaseURL: n.APIBaseURL, Username: n.Username, Password: password, AllowedDownloadOrigins: n.AllowedDownloadOrigins, Timeout: 5 * time.Minute})
	if err != nil {
		return nil, err
	}
	s.deliveryRuntime.clients[n.ID] = cloudreveSession{n.Revision, c}
	return c, nil
}

// forgetDeliverySession discards stale cookie jars when credentials or nodes change.
func (s *Store) forgetDeliverySession(id string) {
	s.deliveryRuntime.mu.Lock()
	delete(s.deliveryRuntime.clients, id)
	for key := range s.deliveryRuntime.links {
		if key.NodeID == id {
			delete(s.deliveryRuntime.links, key)
		}
	}
	s.deliveryRuntime.mu.Unlock()
}
func (s *Store) finishMirror(job ArchiveMirror, fileID string, workErr error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	nIndex := slices.IndexFunc(s.Catalog.DeliveryNodes, func(n DeliveryNode) bool { return n.ID == job.NodeID && n.Enabled && n.Revision == job.NodeRevision })
	if nIndex < 0 {
		return nil
	}
	index := slices.IndexFunc(s.Catalog.ArchiveMirrors, func(m ArchiveMirror) bool {
		return m.NodeID == job.NodeID && m.VersionID == job.VersionID && m.SHA256 == job.SHA256 && m.NodeRevision == job.NodeRevision
	})
	if index < 0 {
		return nil
	}
	prev := s.Catalog.ArchiveMirrors[index]
	next := prev
	next.Attempts++
	if workErr == nil {
		next.State = "ready"
		next.FileID = fileID
		next.ErrorCode = ""
		next.RetryAt = time.Time{}
	} else {
		next.State = "failed"
		next.ErrorCode = "mirror_provider_failed"
		if errors.Is(workErr, errMirrorVerification) {
			next.ErrorCode = errMirrorVerification.Error()
			if nonce, err := randomToken(); err == nil {
				next.ObjectName = fmt.Sprintf("%s-%s-%s-%s.zip", job.VersionID, job.NodeID, job.SHA256, nonce[:16])
			}
		}
		if errors.Is(workErr, cloudreve.ErrUnknownExpiry) {
			next.ErrorCode = "cloudreve_download_expiry_unknown"
		}
		next.RetryAt = time.Now().UTC().Add(time.Minute * time.Duration(1<<min(next.Attempts, 10)))
	}
	s.Catalog.ArchiveMirrors[index] = next
	if err := s.saveLocked(); err != nil {
		s.Catalog.ArchiveMirrors[index] = prev
		return err
	}
	return nil
}
func (s *Store) claimMirror() (ArchiveMirror, DeliveryNode, Version, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, job := range s.Catalog.ArchiveMirrors {
		if job.State != "pending" && (job.State != "failed" || job.Attempts >= 8 || time.Now().Before(job.RetryAt)) {
			continue
		}
		v, ok := s.Catalog.Versions[job.VersionID]
		if !ok || !mirrorCandidate(s.Catalog, v) || v.SHA256 != job.SHA256 {
			continue
		}
		for _, n := range s.Catalog.DeliveryNodes {
			if n.ID != job.NodeID || !n.Enabled || n.Revision != job.NodeRevision {
				continue
			}
			prev := job
			job.State = "uploading"
			s.Catalog.ArchiveMirrors[i] = job
			if err := s.saveLocked(); err != nil {
				s.Catalog.ArchiveMirrors[i] = prev
				return ArchiveMirror{}, DeliveryNode{}, Version{}, false, err
			}
			return job, n, v, true, nil
		}
	}
	return ArchiveMirror{}, DeliveryNode{}, Version{}, false, nil
}
func (s *Store) copyMirror(ctx context.Context, job ArchiveMirror, n DeliveryNode, v Version) (string, error) {
	client, err := s.cloudreveClient(n)
	if err != nil {
		return "", err
	}
	file, err := os.Open(v.ArchivePath)
	if err != nil {
		return "", errors.New("mirror_local_archive_unavailable")
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.Size() != v.SizeBytes {
		return "", errMirrorVerification
	}
	obj, err := client.Upload(ctx, n.Directory, job.ObjectName, file, v.SizeBytes)
	if err != nil {
		return "", err
	}
	link, err := client.Download(ctx, obj.ID)
	if err != nil {
		return "", err
	}
	res, err := client.OpenDownload(ctx, link)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.ContentLength >= 0 && res.ContentLength != v.SizeBytes {
		return "", errMirrorVerification
	}
	h := sha256.New()
	count, err := io.CopyBuffer(h, io.LimitReader(res.Body, v.SizeBytes+1), make([]byte, 64<<10))
	if err != nil || count != v.SizeBytes || hex.EncodeToString(h.Sum(nil)) != v.SHA256 {
		return "", errMirrorVerification
	}
	return obj.ID, nil
}

// StartDeliveryWorker starts one bounded worker. It reads existing scanned archives,
// allocates no archive-sized memory and performs no network I/O under Store.mu.
func (s *Store) StartDeliveryWorker(ctx context.Context) {
	s.deliveryRuntime.workerOnce.Do(func() {
		go s.runDeliveryWorker(ctx, 15*time.Second)
	})
}
func (s *Store) runDeliveryWorker(ctx context.Context, interval time.Duration) {
	recoverUploading := true
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if ctx.Err() != nil {
			return
		}
		if reconcileErr := s.reconcileMirrors(recoverUploading); reconcileErr == nil {
			recoverUploading = false
			job, n, v, ok, err := s.claimMirror()
			if err != nil {
				log.Print("[delivery-mirror] claim persistence failed; retrying")
			}
			if err == nil && ok {
				workCtx, cancel := context.WithTimeout(ctx, 15*time.Minute)
				id, workErr := s.copyMirror(workCtx, job, n, v)
				cancel()
				if s.finishMirror(job, id, workErr) != nil {
					log.Print("[delivery-mirror] completion persistence failed; retrying recovery")
					recoverUploading = true
				} else {
					continue
				}
			}
		} else {
			log.Print("[delivery-mirror] reconciliation persistence failed; retrying")
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
