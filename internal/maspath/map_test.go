package maspath

import "testing"

func TestMapLegacyPath(t *testing.T) {
	tests := []struct{ input, want string; ok bool }{
		{"game/Submods/MAICA/main.rpy", "Submods/MAICA/main.rpy", true},
		{"Submods/A/a.rpy", "Submods/A/a.rpy", true},
		{"game/python-packages/lib.py", "python-packages/lib.py", true},
		{"script.rpym", "Submods/UnGroupScripts/script.rpym", true},
		{"README.md", "", false},
		{"game/saves/save.dat", "", false},
	}
	for _, tt := range tests {
		got, ok, err := MapLegacyPath(tt.input)
		if err != nil || got != tt.want || ok != tt.ok {
			t.Errorf("MapLegacyPath(%q) = %q, %v, %v", tt.input, got, ok, err)
		}
	}
}

func TestUnsafePath(t *testing.T) {
	for _, name := range []string{"../file.rpy", "/absolute.rpy", "C:/drive.rpy", "Submods/CON/file.rpy", "foo\\bar.rpy", "Submods/../foo.rpy", "file.rpy:stream", "Submods/trailing./x.rpy"} {
		if _, _, err := MapLegacyPath(name); err == nil {
			t.Errorf("accepted %q", name)
		}
	}
}
