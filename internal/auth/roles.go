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

// RoleForGroupIDs maps only explicitly configured Flarum group IDs to
// administrator. Other forum groups do not imply SubmodHub author or reviewer
// permissions.
//
// Callers pass the group IDs cached on the session, not a role frozen at login,
// so a changed whitelist or a membership change takes effect on the next
// request instead of at the next login.
func RoleForGroupIDs(groupIDs []string, adminGroupIDs map[string]bool) string {
	for _, id := range groupIDs {
		if id != "" && adminGroupIDs[id] {
			return "admin"
		}
	}
	return "user"
}

// RoleForFlarum applies RoleForGroupIDs to a freshly fetched forum profile.
func RoleForFlarum(profile FlarumProfile, adminGroupIDs map[string]bool) string {
	ids := make([]string, 0, len(profile.Groups))
	for _, group := range profile.Groups {
		ids = append(ids, group.ID)
	}
	return RoleForGroupIDs(ids, adminGroupIDs)
}
