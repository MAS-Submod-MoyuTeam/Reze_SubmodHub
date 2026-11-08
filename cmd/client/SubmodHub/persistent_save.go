package main

import (
	"bytes"
	"compress/zlib"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/nlpodyssey/gopickle/pickle"
	"github.com/nlpodyssey/gopickle/types"
)

const (
	maxPersistentFileSize     = 8 << 20
	maxPersistentUncompressed = 8 << 20
	masUnlockedSpritesKey     = "_mas_sprites_json_gifted_sprites"
	masPendingSpriteGiftsKey  = "_mas_filereacts_sprite_gifts"
)

type spriteIdentity struct {
	Type int
	ID   string
}

type masPersistentSpriteState struct {
	Unlocked map[spriteIdentity]string
	Pending  map[spriteIdentity]string
}

type persistentPassiveObject struct {
	class   string
	attrs   map[string]interface{}
	entries *types.Dict
	list    []interface{}
}

func (o *persistentPassiveObject) PyNew(...interface{}) (interface{}, error) {
	return &persistentPassiveObject{class: o.class, attrs: make(map[string]interface{}), entries: types.NewDict(), list: make([]interface{}, 0)}, nil
}

func (o *persistentPassiveObject) Set(key, value interface{}) {
	_ = o.PyDictSet(key, value)
}

func (o *persistentPassiveObject) Append(value interface{}) {
	o.list = append(o.list, value)
}

func (o *persistentPassiveObject) PyDictSet(key, value interface{}) error {
	if o.class == "renpy.python.RevertableDict" {
		o.entries.Set(key, value)
		return nil
	}
	name, ok := key.(string)
	if !ok {
		return errors.New("persistent object attribute is not a string")
	}
	if o.attrs == nil {
		o.attrs = make(map[string]interface{})
	}
	o.attrs[name] = value
	return nil
}

func (o *persistentPassiveObject) PySetState(value interface{}) error {
	if o.class == "renpy.python.RevertableList" {
		return nil
	}
	state, ok := value.(*types.Dict)
	if !ok {
		return errors.New("persistent object state is not a dictionary")
	}
	for _, entry := range *state {
		if err := o.PyDictSet(entry.Key, entry.Value); err != nil {
			return err
		}
	}
	return nil
}

type persistentPassiveCallable struct {
	kind string
}

func (c persistentPassiveCallable) Call(...interface{}) (interface{}, error) {
	switch c.kind {
	case "__builtin__.set":
		return types.NewSet(), nil
	case "collections.defaultdict":
		return types.NewDict(), nil
	case "collections.deque":
		return types.NewList(), nil
	default:
		return struct{}{}, nil
	}
}

func parseMASPersistent(compressed []byte) (result masPersistentSpriteState, parseErr error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			result = masPersistentSpriteState{}
			parseErr = fmt.Errorf("invalid persistent pickle: %v", recovered)
		}
	}()
	if len(compressed) == 0 || len(compressed) > maxPersistentFileSize {
		return masPersistentSpriteState{}, errors.New("persistent file size is invalid")
	}
	r, err := zlib.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return masPersistentSpriteState{}, err
	}
	data, readErr := io.ReadAll(io.LimitReader(r, maxPersistentUncompressed+1))
	closeErr := r.Close()
	if readErr != nil {
		return masPersistentSpriteState{}, readErr
	}
	if closeErr != nil {
		return masPersistentSpriteState{}, closeErr
	}
	if len(data) > maxPersistentUncompressed {
		return masPersistentSpriteState{}, errors.New("persistent data exceeds the decompression limit")
	}

	unpickler := pickle.NewUnpickler(bytes.NewReader(data))
	unpickler.FindClass = func(module, name string) (interface{}, error) {
		switch module + "." + name {
		case "renpy.persistent.Persistent", "renpy.preferences.Preferences",
			"renpy.python.RevertableDict", "renpy.python.RevertableList":
			return &persistentPassiveObject{class: module + "." + name}, nil
		case "__builtin__.bool", "__builtin__.float", "__builtin__.long", "__builtin__.set",
			"collections.defaultdict", "collections.deque", "datetime.date", "datetime.datetime", "datetime.timedelta":
			// Ordinary saves contain these globals; reducers resolve to inert values.
			return persistentPassiveCallable{kind: module + "." + name}, nil
		default:
			return nil, fmt.Errorf("unsupported persistent global %s.%s", module, name)
		}
	}
	root, err := unpickler.Load()
	if err != nil {
		return masPersistentSpriteState{}, err
	}
	obj, ok := root.(*persistentPassiveObject)
	if !ok || obj.class != "renpy.persistent.Persistent" {
		return masPersistentSpriteState{}, errors.New("persistent root object is invalid")
	}
	unlockedValue, unlockedOK := obj.attrs[masUnlockedSpritesKey]
	pendingValue, pendingOK := obj.attrs[masPendingSpriteGiftsKey]
	if !unlockedOK || !pendingOK {
		return masPersistentSpriteState{}, errors.New("persistent sprite gift maps are missing")
	}
	unlocked, err := parseUnlockedSpriteMap(unlockedValue)
	if err != nil {
		return masPersistentSpriteState{}, fmt.Errorf("unlocked sprite map: %w", err)
	}
	pending, err := parsePendingSpriteMap(pendingValue)
	if err != nil {
		return masPersistentSpriteState{}, fmt.Errorf("pending sprite map: %w", err)
	}
	return masPersistentSpriteState{Unlocked: unlocked, Pending: pending}, nil
}

func passiveEntries(value interface{}) (*types.Dict, error) {
	obj, ok := value.(*persistentPassiveObject)
	if !ok || obj.class != "renpy.python.RevertableDict" || obj.entries == nil {
		return nil, errors.New("value is not a Ren'Py dictionary")
	}
	return obj.entries, nil
}

func parseSpriteIdentity(value interface{}) (spriteIdentity, error) {
	tuple, ok := value.(*types.Tuple)
	if !ok || tuple.Len() != 2 {
		return spriteIdentity{}, errors.New("sprite identity must be a two-item tuple")
	}
	typeNumber, ok := tuple.Get(0).(int)
	if !ok || typeNumber < 0 || typeNumber > 2 {
		return spriteIdentity{}, errors.New("sprite identity type is invalid")
	}
	id, ok := tuple.Get(1).(string)
	if !ok || strings.TrimSpace(id) == "" {
		return spriteIdentity{}, errors.New("sprite identity name is invalid")
	}
	return spriteIdentity{Type: int(typeNumber), ID: id}, nil
}

func parseUnlockedSpriteMap(value interface{}) (map[spriteIdentity]string, error) {
	entries, err := passiveEntries(value)
	if err != nil {
		return nil, err
	}
	out := make(map[spriteIdentity]string, len(*entries))
	for _, entry := range *entries {
		identity, err := parseSpriteIdentity(entry.Key)
		if err != nil {
			return nil, err
		}
		gift, ok := entry.Value.(string)
		if !ok || strings.TrimSpace(gift) == "" {
			return nil, errors.New("unlocked sprite gift name is invalid")
		}
		if _, exists := out[identity]; exists {
			return nil, errors.New("duplicate unlocked sprite identity")
		}
		out[identity] = gift
	}
	return out, nil
}

func parsePendingSpriteMap(value interface{}) (map[spriteIdentity]string, error) {
	entries, err := passiveEntries(value)
	if err != nil {
		return nil, err
	}
	out := make(map[spriteIdentity]string, len(*entries))
	for _, entry := range *entries {
		gift, ok := entry.Key.(string)
		if !ok || strings.TrimSpace(gift) == "" {
			return nil, errors.New("pending sprite gift name is invalid")
		}
		identity, err := parseSpriteIdentity(entry.Value)
		if err != nil {
			return nil, err
		}
		if _, exists := out[identity]; exists {
			return nil, errors.New("duplicate pending sprite identity")
		}
		out[identity] = gift
	}
	return out, nil
}

func (s *DesktopService) spriteSavePath() string {
	if s.isAndroid() {
		return filepath.Join(s.root, "saves", "persistent")
	}
	if appData := os.Getenv("APPDATA"); appData != "" {
		return filepath.Join(appData, "RenPy", "Monika After Story", "persistent")
	}
	return ""
}

func readMASPersistent(path string) (masPersistentSpriteState, error) {
	if path == "" {
		return masPersistentSpriteState{}, errors.New("persistent save path is unavailable")
	}
	file, err := os.Open(path)
	if err != nil {
		return masPersistentSpriteState{}, err
	}
	defer file.Close()
	compressed, err := io.ReadAll(io.LimitReader(file, maxPersistentFileSize+1))
	if err != nil {
		return masPersistentSpriteState{}, err
	}
	return parseMASPersistent(compressed)
}

func spriteGiftStatus(state masPersistentSpriteState, identity spriteIdentity, gift string) *bool {
	unlockedGift, unlocked := state.Unlocked[identity]
	pendingGift, pending := state.Pending[identity]
	if unlocked && (unlockedGift != gift || pending) {
		return nil
	}
	if unlocked {
		value := true
		return &value
	}
	if pending && pendingGift == gift {
		value := false
		return &value
	}
	return nil
}
