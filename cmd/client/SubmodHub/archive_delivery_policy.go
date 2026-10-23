package main

import (
	"net/http"
	"net/url"

	"github.com/reze/submodhub/internal/delivery"
)

// The delivery origin policy is owned by internal/delivery so mod archives and
// app-update downloads cannot drift apart.
func validateArchiveDeliveryURL(base *url.URL, raw string, origins []string) (*url.URL, error) {
	return delivery.ValidateOriginURL(base, raw, origins)
}

func archiveDeliveryClient(base *url.URL, origins []string) *http.Client {
	return delivery.NewOriginClient(base, origins, 4)
}
