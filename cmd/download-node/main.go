package main

import (
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/reze/submodhub/internal/delivery"
)

func main() {
	concurrent := 8
	if raw := os.Getenv("DOWNLOAD_NODE_CONCURRENCY"); raw != "" {
		var err error
		concurrent, err = strconv.Atoi(raw)
		if err != nil {
			log.Fatal("invalid DOWNLOAD_NODE_CONCURRENCY")
		}
	}
	handler, err := delivery.NewRelay(delivery.RelayConfig{Audience: os.Getenv("DOWNLOAD_NODE_ID"), Key: os.Getenv("DOWNLOAD_NODE_KEY"), GitHubProxy: os.Getenv("DOWNLOAD_NODE_GITHUB_PROXY"), MaxConcurrent: concurrent})
	if err != nil {
		log.Fatal(err)
	}
	addr := os.Getenv("DOWNLOAD_NODE_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	// Access logs must omit request queries, which contain short-lived tickets.
	server := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 10 * time.Second, WriteTimeout: 11 * time.Minute, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	log.Printf("download node listening on %s", addr)
	log.Fatal(server.ListenAndServe())
}
