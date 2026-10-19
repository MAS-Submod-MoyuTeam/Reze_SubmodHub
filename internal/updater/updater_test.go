package updater

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/reze/submodhub/internal/github"
)

func TestParseSemVerAndCompare(t *testing.T) {
	tests := []struct {
		v1   string
		v2   string
		want int
	}{
		{"1.0.0", "1.0.0", 0},
		{"v1.0.1", "1.0.0", 1},
		{"0.9.5", "1.0.0", -1},
		{"1.2.3", "1.2.4", -1},
		{"1.2.4", "1.2.3", 1},
		{"2.0.0", "1.99.99", 1},
		{"1.0.0-beta.1", "1.0.0", -1},
		{"1.0.0", "1.0.0-beta.1", 1},
		{"1.0.0-beta.2", "1.0.0-beta.1", 1},
	}

	for _, tt := range tests {
		got := CompareSemVer(tt.v1, tt.v2)
		if got != tt.want {
			t.Errorf("CompareSemVer(%q, %q) = %d; want %d", tt.v1, tt.v2, got, tt.want)
		}
	}
}

func TestSelectAsset(t *testing.T) {
	assets := []github.Asset{
		{ID: 1, Name: "submodhub-windows-amd64-0.9.2.exe"},
		{ID: 2, Name: "submodhub-windows-arm64-0.9.2.exe"},
		{ID: 3, Name: "submodhub-android-arm64-0.9.2.apk"},
		{ID: 4, Name: "SHA256SUMS.txt"},
	}

	winAsset, err := SelectAsset(assets, "windows", "amd64")
	if err != nil || winAsset.ID != 1 {
		t.Fatalf("expected windows-amd64 asset, got: %+v, err: %v", winAsset, err)
	}

	winArmAsset, err := SelectAsset(assets, "windows", "arm64")
	if err != nil || winArmAsset.ID != 2 {
		t.Fatalf("expected windows-arm64 asset, got: %+v, err: %v", winArmAsset, err)
	}

	androidAsset, err := SelectAsset(assets, "android", "arm64")
	if err != nil || androidAsset.ID != 3 {
		t.Fatalf("expected android-arm64 asset, got: %+v, err: %v", androidAsset, err)
	}

	_, err = SelectAsset(assets, "freebsd", "amd64")
	if err == nil {
		t.Fatal("expected error for unsupported OS, got nil")
	}
}

func TestVerifySHA256AndSignature(t *testing.T) {
	tmpDir := t.TempDir()
	filePath := filepath.Join(tmpDir, "test.bin")
	content := []byte("hello world auto updater test payload")
	if err := os.WriteFile(filePath, content, 0644); err != nil {
		t.Fatal(err)
	}

	hasher := sha256.New()
	hasher.Write(content)
	expectedSHA := hex.EncodeToString(hasher.Sum(nil))

	if err := VerifyFileSHA256(filePath, expectedSHA); err != nil {
		t.Fatalf("sha256 verify failed: %v", err)
	}

	if err := VerifyFileSHA256(filePath, "0000000000000000000000000000000000000000000000000000000000000000"); err == nil {
		t.Fatal("expected sha256 mismatch error, got nil")
	}

	// Signature verification
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	sig := ed25519.Sign(priv, content)

	if err := VerifySignature(filePath, sig, pub); err != nil {
		t.Fatalf("signature verification failed: %v", err)
	}

	badSig := make([]byte, len(sig))
	copy(badSig, sig)
	badSig[0] ^= 0xFF
	if err := VerifySignature(filePath, badSig, pub); err == nil {
		t.Fatal("expected signature error on corrupt signature, got nil")
	}
}

func TestParseChecksums(t *testing.T) {
	content := `
# Checksums for SubmodHub
112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00  submodhub-windows-amd64.exe
aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899 *submodhub-android-arm64.apk
`
	res := ParseChecksums(content)
	if res["submodhub-windows-amd64.exe"] != "112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00" {
		t.Errorf("unexpected hash for windows exe: %s", res["submodhub-windows-amd64.exe"])
	}
	if res["submodhub-android-arm64.apk"] != "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899" {
		t.Errorf("unexpected hash for android apk: %s", res["submodhub-android-arm64.apk"])
	}
}

func TestStageManagerDownload(t *testing.T) {
	tmpDir := t.TempDir()
	sm, err := NewStageManager(tmpDir)
	if err != nil {
		t.Fatal(err)
	}

	payload := []byte("simulated-binary-update-content")
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "31")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(payload)
	}))
	defer ts.Close()

	dest := sm.StagingPath("0.9.2", "submodhub.exe")
	var progressCalled bool
	err = sm.DownloadFile(t.Context(), ts.Client(), ts.URL, dest, int64(len(payload)), func(downloaded, total int64) {
		progressCalled = true
	})
	if err != nil {
		t.Fatalf("DownloadFile failed: %v", err)
	}

	if !progressCalled {
		t.Error("expected progress callback to be invoked")
	}

	data, err := os.ReadFile(dest)
	if err != nil || string(data) != string(payload) {
		t.Fatalf("downloaded data mismatch: got %q, err: %v", string(data), err)
	}
}
