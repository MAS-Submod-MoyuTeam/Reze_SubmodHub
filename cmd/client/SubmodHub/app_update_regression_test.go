package main

import (
	"encoding/xml"
	"os"
	"path/filepath"
	"testing"
)

// Guard the Go/Android producer-consumer seam: files-path cannot grant access
// to an APK that lives under Android's cache directory.
func TestAPKStagingMatchesFileProviderCachePath(t *testing.T) {
	data, err := os.ReadFile("build/android/app/src/main/res/xml/file_paths.xml")
	if err != nil {
		t.Fatal(err)
	}
	var paths struct {
		Cache []struct {
			Name string `xml:"name,attr"`
			Path string `xml:"path,attr"`
		} `xml:"cache-path"`
	}
	if err := xml.Unmarshal(data, &paths); err != nil {
		t.Fatal(err)
	}
	for _, entry := range paths.Cache {
		if entry.Name != "submodhub_updates" {
			continue
		}
		if filepath.Clean(entry.Path) != appUpdateCacheDirectory {
			t.Fatalf("FileProvider cache path %q differs from staging directory %q", entry.Path, appUpdateCacheDirectory)
		}
		return
	}
	t.Fatal("APK FileProvider cache-path missing")
}
