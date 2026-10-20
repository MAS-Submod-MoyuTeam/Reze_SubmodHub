package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"
)

var errDeliveryPublicationChanged = errors.New("delivery_publication_changed")
var errReceiptCapacity = errors.New("receipt_capacity")

type completionClaims struct {
	VersionID string `json:"v"`
	ModID     string `json:"m"`
	SHA256    string `json:"h"`
	SizeBytes int64  `json:"s"`
	ExpiresAt int64  `json:"e"`
	Nonce     string `json:"n"`
}
type deliveryCounters struct{ Attempts, Completed int64 }
type receiptRuntime struct {
	mu         sync.Mutex
	key        []byte
	completed  map[string]map[string]time.Time
	pending    map[string]deliveryCounters
	workerOnce sync.Once
}

func receiptHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// Tokens are stateless and process-scoped. No descriptor persists or reserves
// capacity. A restart invalidates outstanding receipts, never archive URLs.
func (s *Store) issueDownloadAttempt(v Version) (string, error) {
	s.mu.RLock()
	current, exists := s.Catalog.Versions[v.ID]
	valid := exists && current.State == "published" && current.SHA256 == v.SHA256 && current.SizeBytes == v.SizeBytes
	for _, m := range s.Catalog.Mods {
		if m.ID == v.ModID && m.Unpublished {
			valid = false
			break
		}
	}
	s.mu.RUnlock()
	if !valid {
		return "", errDeliveryPublicationChanged
	}
	nonce := make([]byte, 16)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	claims := completionClaims{v.ID, v.ModID, v.SHA256, v.SizeBytes, time.Now().Add(time.Hour).Unix(), hex.EncodeToString(nonce)}
	body, _ := json.Marshal(claims)
	rt := &s.receipts
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if rt.key == nil {
		rt.key = make([]byte, 32)
		if _, err := rand.Read(rt.key); err != nil {
			rt.key = nil
			return "", err
		}
	}
	mac := hmac.New(sha256.New, rt.key)
	mac.Write(body)
	if rt.pending == nil {
		rt.pending = map[string]deliveryCounters{}
	}
	count := rt.pending[v.ModID]
	count.Attempts++
	rt.pending[v.ModID] = count
	return base64.RawURLEncoding.EncodeToString(body) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}
func (s *Store) recordCompletion(token, versionID, hash string, size int64) error {
	if len(token) > 2048 {
		return errors.New("invalid_download_receipt")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return errors.New("invalid_download_receipt")
	}
	body, e1 := base64.RawURLEncoding.DecodeString(parts[0])
	signature, e2 := base64.RawURLEncoding.DecodeString(parts[1])
	if e1 != nil || e2 != nil {
		return errors.New("invalid_download_receipt")
	}
	rt := &s.receipts
	rt.mu.Lock()
	defer rt.mu.Unlock()
	if len(rt.key) == 0 {
		return errors.New("invalid_download_receipt")
	}
	mac := hmac.New(sha256.New, rt.key)
	mac.Write(body)
	if !hmac.Equal(mac.Sum(nil), signature) {
		return errors.New("invalid_download_receipt")
	}
	var claims completionClaims
	if json.Unmarshal(body, &claims) != nil || claims.VersionID != versionID || claims.SHA256 != hash || claims.SizeBytes != size || claims.ExpiresAt <= time.Now().Unix() {
		return errors.New("invalid_download_receipt")
	}
	if rt.completed == nil {
		rt.completed = map[string]map[string]time.Time{}
	}
	bucket := rt.completed[versionID]
	if bucket == nil {
		bucket = map[string]time.Time{}
		rt.completed[versionID] = bucket
	}
	now := time.Now()
	for key, expiry := range bucket {
		if !expiry.After(now) {
			delete(bucket, key)
		}
	}
	key := receiptHash(token)
	if _, ok := bucket[key]; ok {
		return nil
	}
	// Only reporting for this version can reach this limit. Descriptor issuance
	// and other versions never depend on this replay-protection budget.
	if len(bucket) >= 2048 {
		return errReceiptCapacity
	}
	bucket[key] = time.Unix(claims.ExpiresAt, 0)
	if rt.pending == nil {
		rt.pending = map[string]deliveryCounters{}
	}
	count := rt.pending[claims.ModID]
	count.Completed++
	rt.pending[claims.ModID] = count
	return nil
}
func (s *Store) downloadComplete(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeError(w, 405, "method_not_allowed", "POST required")
		return
	}
	if !isSameOrigin(r) {
		writeError(w, 403, "cross_origin_forbidden", "cross-origin request forbidden")
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/versions/"), "/"), "/")
	if len(parts) != 2 || parts[1] != "download-complete" {
		writeError(w, 404, "not_found", "receipt endpoint not found")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var p struct {
		Token     string `json:"completion_token"`
		SHA256    string `json:"sha256"`
		SizeBytes int64  `json:"size_bytes"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if dec.Decode(&p) != nil || dec.Decode(new(any)) != io.EOF {
		writeError(w, 400, "invalid_download_receipt", "invalid completion receipt")
		return
	}
	if err := s.recordCompletion(p.Token, parts[0], p.SHA256, p.SizeBytes); err != nil {
		if errors.Is(err, errReceiptCapacity) {
			writeError(w, 429, "receipt_busy", "completion reporting temporarily at capacity")
			return
		}
		writeError(w, 400, "invalid_download_receipt", "invalid completion receipt")
		return
	}
	writeJSON(w, 200, map[string]bool{"recorded": true})
}

// flushDownloadMetrics batches counters once per worker tick, restoring deltas
// on failure. No user-facing request holds the Store write lock or performs I/O.
func (s *Store) flushDownloadMetrics() error {
	rt := &s.receipts
	rt.mu.Lock()
	pending := rt.pending
	rt.pending = nil
	now := time.Now()
	for version, bucket := range rt.completed {
		for key, expiry := range bucket {
			if !expiry.After(now) {
				delete(bucket, key)
			}
		}
		if len(bucket) == 0 {
			delete(rt.completed, version)
		}
	}
	rt.mu.Unlock()
	if len(pending) == 0 {
		return nil
	}
	s.mu.Lock()
	previous := slices.Clone(s.Catalog.Mods)
	for i, m := range s.Catalog.Mods {
		count := pending[m.ID]
		s.Catalog.Mods[i].DownloadAttempts += count.Attempts
		s.Catalog.Mods[i].ClientReportedDownloads += count.Completed
	}
	err := s.saveLocked()
	if err != nil {
		s.Catalog.Mods = previous
	}
	s.mu.Unlock()
	if err != nil {
		rt.mu.Lock()
		if rt.pending == nil {
			rt.pending = map[string]deliveryCounters{}
		}
		for id, count := range pending {
			current := rt.pending[id]
			current.Attempts += count.Attempts
			current.Completed += count.Completed
			rt.pending[id] = current
		}
		rt.mu.Unlock()
	}
	return err
}
func (s *Store) StartDeliveryMetricsWorker(ctx context.Context) {
	s.receipts.workerOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(15 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					if s.flushDownloadMetrics() != nil {
						log.Print("[delivery-metrics] persistence failed; counters retained for retry")
					}
				}
			}
		}()
	})
}
