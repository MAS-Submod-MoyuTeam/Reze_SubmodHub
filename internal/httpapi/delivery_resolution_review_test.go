package httpapi

import (
	"context"
	"github.com/reze/submodhub/internal/cloudreve"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestProviderResolutionCancellationBackoffAndContention(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	hits := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/user/session" {
			w.Write([]byte(`{"code":0}`))
			return
		}
		hits++
		started <- struct{}{}
		select {
		case <-release:
		case <-r.Context().Done():
		}
		w.WriteHeader(503)
	}))
	defer provider.Close()
	c, _ := cloudreve.New(cloudreve.Config{BaseURL: provider.URL, AllowInsecureForTesting: true})
	s, _ := NewStore(t.TempDir(), Catalog{})
	n := DeliveryNode{ID: "n", Revision: 1}
	s.deliveryRuntime.clients = map[string]cloudreveSession{"n": {revision: 1, client: c}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := s.resolveCloudreveLink(ctx, n, "f"); done <- err }()
	<-started
	contendingCtx, cancelContending := context.WithCancel(context.Background())
	cancelContending()
	// A queued provider call would observe context.Canceled. The busy-node
	// branch must reject it before touching the provider or waiting on its lock.
	if _, err := s.resolveCloudreveLink(contendingCtx, n, "g"); err == nil || err.Error() != "provider_busy" {
		t.Fatalf("contending resolver did not bypass provider queue: %v", err)
	}
	cancel()
	if err := <-done; err == nil {
		t.Fatal("missing cancellation")
	}
	if _, err := s.resolveCloudreveLink(context.Background(), n, "f"); err == nil || hits != 1 {
		t.Fatal("failure was not circuit broken")
	}
	close(release)
}
func TestConfiguredNodeTransportPrivateHTTPSAndOriginBoundary(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	defer srv.Close()
	transport, err := configuredNodeTransport(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer transport.CloseIdleConnections()
	// Trust only this synthetic TLS server; production transport keeps standard roots.
	transport.TLSClientConfig = srv.Client().Transport.(*http.Transport).TLSClientConfig
	client := &http.Client{Transport: transport}
	res, err := client.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	req, _ := http.NewRequest("GET", "https://other.example/healthz", nil)
	if _, err = transport.Proxy(req); err == nil {
		t.Fatal("unconfigured origin accepted")
	}
	in := deliveryNodeInput{ID: "n", Name: "n", Type: "github_relay", Weight: 1, Capabilities: []string{"github"}, BaseURL: "https://relay.example/dn"}
	if _, err = in.node(); err == nil {
		t.Fatal("relay base path accepted")
	}
	u, _ := url.Parse(srv.URL)
	if u.Hostname() != "127.0.0.1" {
		t.Fatal("test did not use private node")
	}
}
