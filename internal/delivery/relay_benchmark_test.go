package delivery

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type zeroStream struct{}

func (zeroStream) Read(p []byte) (int, error) { clear(p); return len(p), nil }

type discardResponse struct{ header http.Header }

func (w *discardResponse) Header() http.Header         { return w.header }
func (w *discardResponse) WriteHeader(int)             {}
func (w *discardResponse) Write(p []byte) (int, error) { return len(p), nil }

// This measures Go application allocations only. It does not measure RSS,
// network/TLS sockets, real GitHub throughput or a deployed concurrency budget.
func BenchmarkRelayStream(b *testing.B) {
	for _, size := range []int64{32 << 20, 128 << 20} {
		for _, concurrency := range []int{1, 4, 8} {
			b.Run(fmt.Sprintf("%dMiB/%dstreams", size>>20, concurrency), func(b *testing.B) {
				key := strings.Repeat("k", 32)
				relay, _ := NewRelay(RelayConfig{Audience: "n", Key: key, MaxConcurrent: 8})
				relay.open = func(ctx context.Context, source string) (*http.Response, error) {
					return &http.Response{StatusCode: 200, ContentLength: size, Body: io.NopCloser(io.LimitReader(zeroStream{}, size)), Header: http.Header{}}, nil
				}
				token, _ := SignTicket(key, Ticket{Audience: "n", VersionID: "v", SourceURL: "https://github.com/o/r/releases/download/v/a.zip", SHA256: strings.Repeat("a", 64), SizeBytes: size, ExpiresAt: time.Now().Add(time.Minute).Unix()})
				b.SetBytes(size * int64(concurrency))
				b.ReportAllocs()
				b.ResetTimer()
				for i := 0; i < b.N; i++ {
					var wg sync.WaitGroup
					wg.Add(concurrency)
					for j := 0; j < concurrency; j++ {
						go func() {
							defer wg.Done()
							relay.ServeHTTP(&discardResponse{header: http.Header{}}, httptest.NewRequest("GET", "/download?ticket="+token, nil))
						}()
					}
					wg.Wait()
				}
			})
		}
	}
}
