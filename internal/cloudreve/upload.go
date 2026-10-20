package cloudreve

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
)

type uploadSession struct {
	SessionID  string   `json:"sessionID"`
	ChunkSize  int64    `json:"chunkSize"`
	UploadURLs []string `json:"uploadURLs"`
	Credential string   `json:"credential"`
}

// Upload reconciles by deterministic object name before creating a session.
// A caller must independently read back and hash the returned object before ready.
func (c *Client) Upload(ctx context.Context, directory, name string, source io.ReaderAt, size int64) (Object, error) {
	if size <= 0 || size > 128<<20 || name == "" || path.Base(name) != name || strings.ContainsAny(name, "/\\") || !strings.HasPrefix(directory, "/") {
		return Object{}, errors.New("cloudreve_upload_invalid")
	}
	listing, err := c.EnsureDirectory(ctx, directory)
	if err != nil {
		return Object{}, err
	}
	find := func(objects []Object) (Object, bool, error) {
		for _, o := range objects {
			if o.Name == name {
				if o.Size != size || o.Type != "file" {
					return Object{}, false, errors.New("cloudreve_object_conflict")
				}
				return o, true, nil
			}
		}
		return Object{}, false, nil
	}
	if obj, ok, err := find(listing.Objects); ok || err != nil {
		return obj, err
	}
	if listing.Policy.Type != "local" && listing.Policy.Type != "remote" {
		return Object{}, errors.New("cloudreve_upload_policy_unsupported")
	}
	var session uploadSession
	if err = c.do(ctx, "PUT", "/file/upload", map[string]any{"path": directory, "name": name, "size": size, "policy_id": listing.Policy.ID}, &session); err != nil {
		return Object{}, err
	}
	if session.SessionID == "" || strings.ContainsAny(session.SessionID, "/\\?#") {
		return Object{}, errors.New("cloudreve_upload_session_invalid")
	}
	chunkSize := session.ChunkSize
	if chunkSize == 0 {
		chunkSize = size
	}
	if chunkSize < 0 {
		return Object{}, errors.New("cloudreve_upload_session_invalid")
	}
	// Session chunks are streamed through SectionReader, never buffered as a file.
	for offset, index := int64(0), 0; offset < size; index++ {
		count := min(chunkSize, size-offset)
		chunk := io.NewSectionReader(source, offset, count)
		if listing.Policy.Type == "local" {
			if lockErr := c.mu.LockContext(ctx); lockErr != nil {
				return Object{}, lockErr
			}
			err = c.raw(ctx, "POST", "/file/upload/"+session.SessionID+"/"+strconv.Itoa(index), chunk, "application/octet-stream", nil)
			c.mu.Unlock()
		} else {
			if len(session.UploadURLs) != 1 {
				return Object{}, errors.New("cloudreve_upload_session_invalid")
			}
			err = c.remoteChunk(ctx, session.UploadURLs[0], session.Credential, index, chunk, count)
		}
		// Mutating chunk requests are never blindly replayed after session loss.
		if err != nil {
			return Object{}, err
		}
		offset += count
	}
	listing, err = c.List(ctx, directory)
	if err != nil {
		return Object{}, err
	}
	if obj, ok, err := find(listing.Objects); ok || err != nil {
		return obj, err
	}
	return Object{}, errors.New("cloudreve_upload_object_not_found")
}
func (c *Client) remoteChunk(ctx context.Context, address, credential string, index int, body io.Reader, size int64) error {
	u, err := url.Parse(address)
	if err != nil || !c.allowedStorageURL(u) {
		return errors.New("cloudreve_upload_origin_forbidden")
	}
	q := u.Query()
	q.Set("chunk", strconv.Itoa(index))
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, "POST", u.String(), body)
	if err != nil {
		return errors.New("cloudreve_upload_request_invalid")
	}
	req.Header.Set("Authorization", credential)
	req.Header.Set("Content-Type", "application/octet-stream")
	req.ContentLength = size
	// A separate client has no cookie jar and cannot redirect authorization.
	client := &http.Client{Timeout: c.cfg.Timeout, Transport: c.http.Transport, CheckRedirect: c.http.CheckRedirect}
	resp, err := client.Do(req)
	if err != nil {
		return errors.New("cloudreve_upload_transport_failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("cloudreve_upload_http_%d", resp.StatusCode)
	}
	var env envelope
	if json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&env) != nil {
		return errors.New("cloudreve_response_invalid")
	}
	if env.Code != 0 {
		return apiError(env.Code)
	}
	return nil
}
func (c *Client) allowedStorageURL(u *url.URL) bool {
	if u == nil || u.User != nil || u.Fragment != "" || u.Host == "" || (u.Scheme != "https" && !(c.cfg.AllowInsecureForTesting && u.Scheme == "http")) {
		return false
	}
	for _, origin := range c.cfg.AllowedDownloadOrigins {
		if strings.EqualFold(origin, u.Scheme+"://"+u.Host) {
			return true
		}
	}
	return false
}

// Verify streams an independent unauthenticated read and checks every byte.
func (c *Client) OpenDownload(ctx context.Context, link Link) (*http.Response, error) {
	u, err := url.Parse(link.URL)
	if err != nil || !c.allowedStorageURL(u) {
		return nil, errors.New("cloudreve_download_origin_forbidden")
	}
	req, err := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	if err != nil {
		return nil, errors.New("cloudreve_download_request_invalid")
	}
	client := &http.Client{Timeout: c.cfg.Timeout, Transport: c.http.Transport, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 4 || !c.allowedStorageURL(req.URL) {
			return errors.New("cloudreve_download_redirect_forbidden")
		}
		return nil
	}}
	res, err := client.Do(req)
	if err != nil {
		return nil, errors.New("cloudreve_download_transport_failed")
	}
	if res.StatusCode != http.StatusOK {
		res.Body.Close()
		return nil, errors.New("cloudreve_download_http_failed")
	}
	return res, nil
}
