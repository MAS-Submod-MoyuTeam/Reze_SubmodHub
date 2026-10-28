package cloudreve

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// pagedNode is a Cloudreve directory that either pages its response (the shape a
// real node has) or ignores paging altogether (the shape this client must also
// survive). Retention and read-back confirmation both depend on seeing all of it.
type pagedNode struct {
	mu       sync.Mutex
	objects  []Object
	requests int
	honors   bool
}

func (p *pagedNode) server(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "session") {
			fmt.Fprint(w, `{"code":0}`)
			return
		}
		if r.Method != "GET" || r.URL.Path != "/directory/dir" {
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			fmt.Fprint(w, `{"code":404}`)
			return
		}
		p.mu.Lock()
		p.requests++
		objects, honors := slices.Clone(p.objects), p.honors
		p.mu.Unlock()
		if honors {
			page, _ := strconv.Atoi(r.URL.Query().Get("page"))
			size, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
			if page < 1 {
				page = 1
			}
			if size <= 0 {
				size = directoryPageSize
			}
			start := min((page-1)*size, len(objects))
			objects = objects[start:min(start+size, len(objects))]
		}
		json.NewEncoder(w).Encode(map[string]any{
			"code": 0,
			"data": map[string]any{
				"objects": objects,
				"policy":  map[string]any{"id": "p", "type": "local"},
			},
		})
	}))
	t.Cleanup(srv.Close)
	return srv
}

func (p *pagedNode) requestCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.requests
}

func installers(count int) []Object {
	out := make([]Object, 0, count)
	for i := 0; i < count; i++ {
		out = append(out, Object{ID: fmt.Sprintf("id-%03d", i), Name: fmt.Sprintf("app-v1-%03d.exe", i), Type: "file", Size: 10})
	}
	return out
}

// A paged provider must not hide anything past the first page: both retention and
// its confirm step decide from this listing.
func TestListAllPagesThroughTheWholeDirectory(t *testing.T) {
	node := &pagedNode{objects: installers(250), honors: true}
	srv := node.server(t)
	c, _ := New(Config{BaseURL: srv.URL, AllowInsecureForTesting: true})

	listing, err := c.ListAll(context.Background(), "/dir")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listing.Objects) != 250 {
		t.Fatalf("paged listing must return every object: got %d", len(listing.Objects))
	}
	if got := listing.Objects[249].ID; got != "id-249" {
		t.Fatalf("last object missing from the complete listing: %q", got)
	}
	// 100 + 100 + 50 + one empty page that proves the end.
	if got := node.requestCount(); got != 4 {
		t.Fatalf("expected 4 page requests, got %d", got)
	}
	if listing.Policy.Type != "local" || listing.Policy.ID != "p" {
		t.Fatalf("policy must come from the first page: %+v", listing.Policy)
	}
}

// A provider that ignores paging answers every page with the same objects. The
// pass must stop instead of looping, and must not report duplicates.
func TestListAllStopsWhenPagingIsIgnored(t *testing.T) {
	node := &pagedNode{objects: installers(30)}
	srv := node.server(t)
	c, _ := New(Config{BaseURL: srv.URL, AllowInsecureForTesting: true})

	listing, err := c.ListAll(context.Background(), "/dir")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listing.Objects) != 30 {
		t.Fatalf("expected 30 objects once, got %d", len(listing.Objects))
	}
	if got := node.requestCount(); got != 2 {
		t.Fatalf("a paging-ignorant provider costs one extra request, got %d", got)
	}
}

func TestListAllAcceptsAnEmptyDirectory(t *testing.T) {
	node := &pagedNode{honors: true}
	srv := node.server(t)
	c, _ := New(Config{BaseURL: srv.URL, AllowInsecureForTesting: true})

	listing, err := c.ListAll(context.Background(), "/dir")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listing.Objects) != 0 {
		t.Fatalf("expected no objects, got %+v", listing.Objects)
	}
	if got := node.requestCount(); got != 1 {
		t.Fatalf("an empty directory needs one request, got %d", got)
	}
}

func TestListAllRejectsARelativeDirectory(t *testing.T) {
	node := &pagedNode{}
	srv := node.server(t)
	c, _ := New(Config{BaseURL: srv.URL, AllowInsecureForTesting: true})
	if _, err := c.ListAll(context.Background(), "dir"); err == nil || err.Error() != "cloudreve_directory_invalid" {
		t.Fatalf("relative directory must be rejected before any request: %v", err)
	}
	if got := node.requestCount(); got != 0 {
		t.Fatalf("invalid input reached the provider: %d", got)
	}
}

// A directory past the page cap is a configuration problem, not a short listing:
// truncating would let a caller confirm a deletion it never saw disappear.
func TestListAllRefusesATruncatedListing(t *testing.T) {
	node := &pagedNode{objects: installers(directoryMaxPages * directoryPageSize), honors: true}
	srv := node.server(t)
	c, _ := New(Config{BaseURL: srv.URL, AllowInsecureForTesting: true})

	listing, err := c.ListAll(context.Background(), "/dir")
	if err == nil || err.Error() != "cloudreve_directory_listing_incomplete" {
		t.Fatalf("over-cap listing must fail instead of truncating: %v", err)
	}
	if len(listing.Objects) != 0 {
		t.Fatalf("a failed listing must not return a partial result: %d objects", len(listing.Objects))
	}
	if got := node.requestCount(); got != directoryMaxPages {
		t.Fatalf("expected %d page requests, got %d", directoryMaxPages, got)
	}
}
