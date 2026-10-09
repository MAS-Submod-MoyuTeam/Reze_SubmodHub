//go:build browser

package main

import (
	"log"
	"net/http"
)

func main() {
	service := NewDesktopService()
	mux := http.NewServeMux()
	mux.Handle("/local/", browserServiceHandler(service))
	log.Println("browser bridge listening on http://127.0.0.1:18083")
	log.Fatal(http.ListenAndServe("127.0.0.1:18083", mux))
}
