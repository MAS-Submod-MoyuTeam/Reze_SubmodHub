package checksum

import "testing"

func TestParseAcceptsOnlyRealDigests(t *testing.T) {
	content := "# generated\n" +
		"a3f1c2b4d5e6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2  submodhub-windows-amd64.exe\n" +
		"a3f1c2b4d5e6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2 *submodhub-android-arm64-0.9.12.apk\n" +
		"deadbeef  short-hash.exe\n" +
		"\n" +
		"notahash submodhub-updater.exe\n"
	got := Parse(content)
	if len(got) != 2 {
		t.Fatalf("want two accepted entries, got %+v", got)
	}
	if got["submodhub-windows-amd64.exe"] != "a3f1c2b4d5e6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2" {
		t.Fatalf("windows entry: %+v", got)
	}
	if _, ok := got["submodhub-android-arm64-0.9.12.apk"]; !ok {
		t.Fatalf("asterisk-prefixed name must keep its filename: %+v", got)
	}
	if _, ok := got["short-hash.exe"]; ok {
		t.Fatal("non-64-character digest must not be trusted")
	}
}
