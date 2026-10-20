// cloudreve-probe uses environment credentials in a fresh process without browser
// cookies. It prints only non-sensitive validation results.
package main

import (
	"archive/zip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/reze/submodhub/internal/cloudreve"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	transfer := flag.Bool("create-temporary-file", false, "explicitly create, download and delete one unique ZIP in the configured project directory")
	size := flag.Int64("payload-bytes", 35, "ZIP payload bytes (35..134086656); large probe may consume storage and bandwidth")
	flag.Parse()
	if *size < 35 || *size > 128<<20-(128<<10) {
		return errors.New("probe_size_invalid")
	}
	cfg := cloudreve.Config{BaseURL: os.Getenv("CLOUDREVE_API_URL"), Username: os.Getenv("CLOUDREVE_USERNAME"), Password: os.Getenv("CLOUDREVE_PASSWORD"), AllowedDownloadOrigins: strings.Fields(os.Getenv("CLOUDREVE_DOWNLOAD_ORIGINS")), Timeout: 10 * time.Minute}
	client, err := cloudreve.New(cfg)
	if err != nil {
		return err
	}
	directory := os.Getenv("CLOUDREVE_DIRECTORY")
	if directory == "" || directory == "/" {
		return errors.New("project_directory_required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	if _, err = client.List(ctx, directory); err != nil {
		return err
	}
	if !*transfer {
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": true, "scope": "authentication_and_directory_metadata", "created_files": false})
	}
	// Create a real ZIP with stored random payload; its memory use is bounded.
	tmp, err := os.CreateTemp("", "submodhub-probe-*.zip")
	if err != nil {
		return errors.New("probe_temp_failed")
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	writer := zip.NewWriter(tmp)
	part, err := writer.CreateHeader(&zip.FileHeader{Name: "probe.bin", Method: zip.Store})
	if err != nil {
		return errors.New("probe_zip_failed")
	}
	if _, err = io.CopyN(part, rand.Reader, *size); err != nil {
		return errors.New("probe_zip_failed")
	}
	if writer.Close() != nil {
		return errors.New("probe_zip_failed")
	}
	info, _ := tmp.Stat()
	tmp.Seek(0, io.SeekStart)
	localHash := sha256.New()
	if _, err = io.Copy(localHash, tmp); err != nil {
		return errors.New("probe_read_failed")
	}
	nonce := make([]byte, 16)
	if _, err = rand.Read(nonce); err != nil {
		return errors.New("probe_entropy_failed")
	}
	name := "submodhub-probe-" + hex.EncodeToString(nonce) + ".zip"
	object, err := client.Upload(ctx, directory, name, tmp, info.Size())
	if err != nil {
		return err
	}
	// Cleanup uses only this process's returned identity and verifies disappearance.
	cleanup := func() error {
		cleanupCtx, stop := context.WithTimeout(context.Background(), 30*time.Second)
		defer stop()
		return client.DeleteCreatedObject(cleanupCtx, directory, object)
	}
	link, err := client.Download(ctx, object.ID)
	if err != nil {
		if cleanup() != nil {
			return errors.New("probe_failed_and_cleanup_unconfirmed")
		}
		return err
	}
	res, err := client.OpenDownload(ctx, link)
	if err != nil {
		if cleanup() != nil {
			return errors.New("probe_failed_and_cleanup_unconfirmed")
		}
		return err
	}
	remoteHash := sha256.New()
	count, readErr := io.Copy(remoteHash, io.LimitReader(res.Body, info.Size()+1))
	res.Body.Close()
	verified := readErr == nil && count == info.Size() && hex.EncodeToString(remoteHash.Sum(nil)) == hex.EncodeToString(localHash.Sum(nil))
	if cleanup() != nil {
		return errors.New("probe_cleanup_unconfirmed")
	}
	if !verified {
		return errors.New("probe_hash_or_size_mismatch")
	}
	return json.NewEncoder(os.Stdout).Encode(map[string]any{"ok": true, "scope": "zip_upload_independent_download_sha256_cleanup", "archive_bytes": info.Size(), "sha256_verified": true, "cleanup_confirmed": true, "signature_expiry_confirmed": link.ExpiresAt.After(time.Now())})
}
