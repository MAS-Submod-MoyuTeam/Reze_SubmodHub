package cloudreve

import (
	"context"
	"testing"
	"time"
)

func TestMetadataWaitHonorsCancellation(t *testing.T) {
	c, _ := New(Config{BaseURL: "https://provider.invalid"})
	c.mu.Lock()
	defer c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := c.List(ctx, "/"); done <- err }()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("missing cancellation")
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("metadata waiting on mutex ignored context")
	}
}
