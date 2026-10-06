package auth

import "strings"

func ParseGroupIDs(value string) map[string]bool {
	ids := map[string]bool{}
	for _, id := range strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == '，' || r == ';' || r == '；' }) {
		if id = strings.TrimSpace(id); id != "" {
			ids[id] = true
		}
	}
	return ids
}

// RoleForFlarum maps only explicitly configured group IDs to administrator.
// Other forum groups do not imply SubmodHub author or reviewer permissions.
func RoleForFlarum(profile FlarumProfile, adminGroupIDs map[string]bool) string {
	for _, group := range profile.Groups {
		if adminGroupIDs[group.ID] {
			return "admin"
		}
	}
	return "user"
}
