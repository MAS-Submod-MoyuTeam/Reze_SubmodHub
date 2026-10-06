package maspath

import "testing"

func TestAndroidMASRootIsFixedGameRoot(t *testing.T) {
	if AndroidMASRoot != "/storage/emulated/0/MAS/" {
		t.Fatalf("root = %q", AndroidMASRoot)
	}
	if AndroidGameDirectory() != "/storage/emulated/0/MAS/game" {
		t.Fatalf("game = %q", AndroidGameDirectory())
	}
}
