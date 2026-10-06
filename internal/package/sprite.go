package packagezip

import (
	"encoding/json"
	"strings"
)

func parseSprite(source string, data []byte) Sprite {
	s := Sprite{Source: source}
	var raw map[string]json.RawMessage
	if len(data) > 2<<20 || json.Unmarshal(data, &raw) != nil {
		s.Unknown = true
		return s
	}
	if value, ok := raw["giftname"]; ok {
		if json.Unmarshal(value, &s.GiftName) != nil {
			s.Unknown = true
		}
	}
	var name, typ, group string
	if value, ok := raw["name"]; ok {
		if json.Unmarshal(value, &name) != nil {
			s.Unknown = true
		}
	}
	if value, ok := raw["type"]; ok {
		_ = json.Unmarshal(value, &typ)
	}
	if value, ok := raw["select_info"]; ok {
		var info map[string]json.RawMessage
		if json.Unmarshal(value, &info) == nil {
			if g, exists := info["group"]; exists {
				if json.Unmarshal(g, &group) != nil {
					s.Unknown = true
				}
			}
		} else {
			s.Unknown = true
		}
	}
	if strings.ContainsAny(group, `/\\`) || group == "." || group == ".." {
		s.Unknown = true
		group = ""
	}
	s.GiftGroup = group
	if name != "" {
		s.Identity = strings.Join([]string{typ, name}, ":")
	} else {
		s.Unknown = true
	}
	return s
}
