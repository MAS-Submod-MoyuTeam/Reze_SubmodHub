package main

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"io"
	"os"
	"testing"
)

func appendUnicode(out *bytes.Buffer, value string) {
	out.WriteByte('X')
	_ = binary.Write(out, binary.LittleEndian, uint32(len(value)))
	out.WriteString(value)
}

func appendSpriteTuple(out *bytes.Buffer, spriteType int, spriteID string) {
	out.WriteByte('K')
	out.WriteByte(byte(spriteType))
	appendUnicode(out, spriteID)
	out.WriteByte(0x86) // TUPLE2
}

func persistentFixture(t *testing.T, includeUnlocked, includePending bool) []byte {
	t.Helper()
	var pickle bytes.Buffer
	pickle.Write([]byte{0x80, 2, 'c'})
	pickle.WriteString("renpy.persistent\nPersistent\n")
	pickle.Write([]byte{')', 0x81, 'q', 0, '}', '('})
	// A real MAS save always carries non-sprite state alongside the two gift
	// maps. Leaving it out is what let the parser look healthy in tests while
	// rejecting every save on disk.
	appendRevertableSet(&pickle, "_seen_images")
	if includeUnlocked {
		appendUnicode(&pickle, "_mas_sprites_json_gifted_sprites")
		pickle.Write([]byte{'c'})
		pickle.WriteString("renpy.python\nRevertableDict\n")
		pickle.Write([]byte{')', 0x81, 'q', 1, '}', '('})
		appendSpriteTuple(&pickle, 2, "shirt_id")
		appendUnicode(&pickle, "shirtgift")
		pickle.Write([]byte{'u', 'b'}) // SETITEM, BUILD
	}
	if includePending {
		appendUnicode(&pickle, "_mas_filereacts_sprite_gifts")
		pickle.Write([]byte{'c'})
		pickle.WriteString("renpy.python\nRevertableDict\n")
		pickle.Write([]byte{')', 0x81, 'q', 2, '}', '('})
		appendUnicode(&pickle, "hatgift")
		appendSpriteTuple(&pickle, 0, "hat_id")
		pickle.Write([]byte{'u', 'b'})
	}
	pickle.Write([]byte{'u', 'b', '.'}) // SETITEMS, BUILD, STOP
	var compressed bytes.Buffer
	zw := zlib.NewWriter(&compressed)
	_, _ = zw.Write(pickle.Bytes())
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return compressed.Bytes()
}

// appendRevertableSet writes an empty value whose class is RevertableSet. Real
// MAS saves carry sets (unlocked topics, seen images) next to the two gift maps,
// and an allowlist that rejected the class failed the whole file — every badge
// disappeared even though both maps were perfectly readable. Only the class name
// reaches the parser, so the contents do not matter here.
func appendRevertableSet(out *bytes.Buffer, name string) {
	appendUnicode(out, name)
	out.WriteByte('c')
	out.WriteString("renpy.python\nRevertableSet\n")
	out.Write([]byte{')', 0x81, '}', 'b'}) // NEWOBJ, empty state, BUILD
}

func TestParseMASPersistentExtractsGiftState(t *testing.T) {
	state, err := parseMASPersistent(persistentFixture(t, true, true))
	if err != nil {
		t.Fatal(err)
	}
	if state.Unlocked[spriteIdentity{Type: 2, ID: "shirt_id"}] != "shirtgift" {
		t.Fatalf("unlocked map = %#v", state.Unlocked)
	}
	if state.Pending[spriteIdentity{Type: 0, ID: "hat_id"}] != "hatgift" {
		t.Fatalf("pending map = %#v", state.Pending)
	}
}

func TestParseMASPersistentRejectsInvalidOrIncompleteData(t *testing.T) {
	for name, data := range map[string][]byte{
		"not zlib":                    []byte("not a save"),
		"missing unlocked map":        persistentFixture(t, false, true),
		"missing pending map":         persistentFixture(t, true, false),
		"unsupported opcode":          compressPickle(t, []byte{0x80, 2, 0xff, '.'}),
		"compressed file too large":   bytes.Repeat([]byte{0}, maxPersistentFileSize+1),
		"decompressed data too large": compressPickle(t, make([]byte, maxPersistentUncompressed+1)),
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := parseMASPersistent(data); err == nil {
				t.Fatal("expected parser to reject the data")
			}
		})
	}
}

func TestParseMASPersistentFromUserSave(t *testing.T) {
	path := os.Getenv("MAS_PERSISTENT_TEST_FILE")
	if path == "" {
		t.Skip("set MAS_PERSISTENT_TEST_FILE to exercise a local Ren'Py save")
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxPersistentFileSize+1))
	if err != nil {
		t.Fatal(err)
	}
	state, err := parseMASPersistent(data)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("decoded %d unlocked and %d pending sprite identities", len(state.Unlocked), len(state.Pending))
}

func compressPickle(t *testing.T, data []byte) []byte {
	t.Helper()
	var out bytes.Buffer
	zw := zlib.NewWriter(&out)
	_, _ = zw.Write(data)
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}
