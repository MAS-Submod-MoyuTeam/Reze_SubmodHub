package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"slices"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"
)

// TagGroup is one main tag and its optional children. The catalog is the site's
// single source of truth for tags: authors pick from it and never invent names,
// so a mod's flat Tags list is unambiguous as long as names are unique inside
// the whole catalog (enforced by normalizeTagCatalog).
//
// Every tag carries its own Description: the admin writes it once and the same
// sentence explains the tag in the author picker and in the catalog filter, so
// a name like "杂项" is not the only thing a chooser has to go on.
type TagGroup struct {
	Name        string     `json:"name"`
	Description string     `json:"description,omitempty"`
	Children    []TagChild `json:"children,omitempty"`
}

// TagChild is a child tag. It is a full tag (name + description) rather than a
// bare string so a sub-tag can explain itself exactly like its parent.
type TagChild struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// Names returns the child tag names, which is what the flat mod storage and the
// pruning pass actually need.
func (g TagGroup) ChildNames() []string {
	names := make([]string, len(g.Children))
	for i, child := range g.Children {
		names[i] = child.Name
	}
	return names
}

const (
	// maxModTags caps the normalized selection (parents added automatically for
	// every selected child count too), because cards only render a short row.
	maxModTags = 8
	// maxTagGroups and maxTagChildren keep the admin page and the picker usable.
	maxTagGroups   = 20
	maxTagChildren = 6
	// maxTagNameRunes bounds one tag label; the display prefix "#" is added by
	// the UI, so it stays out of the stored name.
	maxTagNameRunes = 24
	// maxTagDescriptionRunes bounds the one-line explanation. It is rendered as
	// a secondary line under the tag name, so it has to stay readable at a
	// glance instead of wrapping into a paragraph.
	maxTagDescriptionRunes = 60
)

// tagCatalogMigrationHint is appended to a snapshot decode failure. A stored
// catalog written before child tags became {name, description} objects cannot be
// decoded any more, that is the only known cause, and the operator needs the
// command that repairs the stored document instead of a bare json error.
const tagCatalogMigrationHint = " (a stored catalog that still lists tag children as bare strings needs cmd/migrate-tag-children before this build can read it)"

// defaultTagCatalog seeds a fresh deployment (and any snapshot written before
// the catalog existed). Children are added by the admin page.
func defaultTagCatalog() []TagGroup {
	return []TagGroup{
		{Name: "工具"},
		{Name: "话题"},
		{Name: "功能"},
		{Name: "UI"},
		{Name: "音乐"},
		{Name: "背景"},
		{Name: "杂项"},
		{Name: "小游戏"},
		{Name: "窗口反应"},
		{Name: "整活"},
		{Name: "浪漫"},
		{Name: "ai"},
	}
}

// tagViolation carries the API error code that the tag rules want to report, so
// handlers do not have to re-derive it from a message.
type tagViolation struct {
	code    string
	message string
}

func (v *tagViolation) Error() string { return v.message }

func violation(code, format string, args ...any) *tagViolation {
	return &tagViolation{code: code, message: fmt.Sprintf(format, args...)}
}

// writeTagError renders a tag rule failure. Anything that is not a deliberate
// tag violation degrades to a plain validation error instead of a 500.
func writeTagError(w http.ResponseWriter, err error) {
	var v *tagViolation
	if errors.As(err, &v) {
		writeError(w, 400, v.code, v.message)
		return
	}
	writeError(w, 400, "validation_failed", err.Error())
}

func cloneTagCatalog(groups []TagGroup) []TagGroup {
	out := make([]TagGroup, len(groups))
	for i, group := range groups {
		out[i] = TagGroup{Name: group.Name, Description: group.Description}
		if len(group.Children) > 0 {
			out[i].Children = append([]TagChild(nil), group.Children...)
		}
	}
	return out
}

// effectiveTagCatalogLocked resolves an unconfigured catalog to the defaults.
// Callers must hold s.mu (read or write). The result is a copy, so a handler can
// keep using it after the lock is released.
func (s *Store) effectiveTagCatalogLocked() []TagGroup {
	if s.Catalog.Settings.TagCatalog == nil {
		return defaultTagCatalog()
	}
	return cloneTagCatalog(s.Catalog.Settings.TagCatalog)
}

func (s *Store) tagCatalog() []TagGroup {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.effectiveTagCatalogLocked()
}

// normalizeModTags validates an author's selection: every name must exist in the
// catalog, selecting a child implies its parent, duplicates and blanks collapse,
// the result follows catalog order, and at least one tag is required.
func normalizeModTags(input []string, catalog []TagGroup) ([]string, error) {
	parents := make(map[string]bool, len(catalog))
	parentOf := make(map[string]string)
	order := make(map[string]int)
	for groupIndex, group := range catalog {
		parents[group.Name] = true
		order[group.Name] = groupIndex * 100
		for childIndex, child := range group.Children {
			parentOf[child.Name] = group.Name
			order[child.Name] = groupIndex*100 + childIndex + 1
		}
	}

	selected := make(map[string]bool, len(input))
	normalized := make([]string, 0, len(input))
	add := func(name string) {
		if selected[name] {
			return
		}
		selected[name] = true
		normalized = append(normalized, name)
	}
	for _, raw := range input {
		name := strings.TrimSpace(raw)
		if name == "" {
			continue
		}
		if parents[name] {
			add(name)
			continue
		}
		parent, ok := parentOf[name]
		if !ok {
			return nil, violation("invalid_tags", "标签 %q 不在标签目录中", name)
		}
		add(parent)
		add(name)
	}
	if len(normalized) == 0 {
		return nil, violation("tags_required", "至少需要选择一个标签")
	}
	if len(normalized) > maxModTags {
		return nil, violation("too_many_tags", "标签最多 %d 个（含自动补入的主标签）", maxModTags)
	}
	sort.SliceStable(normalized, func(i, j int) bool { return order[normalized[i]] < order[normalized[j]] })
	return normalized, nil
}

// normalizeTagName trims a label and rejects the characters that would break the
// "#tag" rendering or the comma-separated URL filter.
func normalizeTagName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", violation("invalid_tag_catalog", "标签名不能为空")
	}
	if utf8.RuneCountInString(name) > maxTagNameRunes {
		return "", violation("invalid_tag_catalog", "标签名 %q 超过 %d 个字符", name, maxTagNameRunes)
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return "", violation("invalid_tag_catalog", "标签名 %q 含有控制字符", name)
		}
		if r == ',' || r == '#' {
			return "", violation("invalid_tag_catalog", "标签名 %q 不能包含逗号或井号", name)
		}
	}
	return name, nil
}

// normalizeTagDescription trims the explanation and enforces the one-line
// budget. An empty description is allowed: tags whose name already says it all
// do not need filler text.
func normalizeTagDescription(raw string) (string, error) {
	description := strings.TrimSpace(raw)
	if utf8.RuneCountInString(description) > maxTagDescriptionRunes {
		return "", violation("invalid_tag_catalog", "标签描述最多 %d 个字符", maxTagDescriptionRunes)
	}
	for _, r := range description {
		if unicode.IsControl(r) {
			return "", violation("invalid_tag_catalog", "标签描述不能包含换行等控制字符")
		}
	}
	return description, nil
}

// normalizeTagCatalog validates an admin edit and returns the canonical form:
// trimmed names and descriptions, deduplicated children, and globally unique
// names across both levels (flat mod storage depends on that).
func normalizeTagCatalog(input []TagGroup) ([]TagGroup, error) {
	if len(input) == 0 {
		return nil, violation("invalid_tag_catalog", "标签目录至少需要一个主标签")
	}
	if len(input) > maxTagGroups {
		return nil, violation("invalid_tag_catalog", "主标签最多 %d 个", maxTagGroups)
	}
	seen := make(map[string]bool, len(input))
	out := make([]TagGroup, 0, len(input))
	for _, group := range input {
		name, err := normalizeTagName(group.Name)
		if err != nil {
			return nil, err
		}
		if seen[name] {
			return nil, violation("invalid_tag_catalog", "标签名 %q 重复", name)
		}
		seen[name] = true
		description, err := normalizeTagDescription(group.Description)
		if err != nil {
			return nil, err
		}
		if len(group.Children) > maxTagChildren {
			return nil, violation("invalid_tag_catalog", "主标签 %q 下的子标签最多 %d 个", name, maxTagChildren)
		}
		normalized := TagGroup{Name: name, Description: description}
		for _, raw := range group.Children {
			child, err := normalizeTagName(raw.Name)
			if err != nil {
				return nil, err
			}
			childDescription, err := normalizeTagDescription(raw.Description)
			if err != nil {
				return nil, err
			}
			if slices.Contains(normalized.ChildNames(), child) {
				continue
			}
			if seen[child] {
				return nil, violation("invalid_tag_catalog", "标签名 %q 重复", child)
			}
			seen[child] = true
			normalized.Children = append(normalized.Children, TagChild{Name: child, Description: childDescription})
		}
		out = append(out, normalized)
	}
	return out, nil
}

// tagCatalogNames flattens the catalog for pruning: a mod may only keep names
// that still exist as a main tag or a child.
func tagCatalogNames(catalog []TagGroup) map[string]bool {
	names := make(map[string]bool, len(catalog))
	for _, group := range catalog {
		names[group.Name] = true
		for _, child := range group.Children {
			names[child.Name] = true
		}
	}
	return names
}

// tagCatalogEqual decides whether an edit actually changed the catalog, so the
// audit trail does not claim a change for a no-op save.
func tagCatalogEqual(a, b []TagGroup) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		// Descriptions are part of the catalog: editing one changes what every
		// chooser reads, so it has to count as a change.
		if a[i].Name != b[i].Name || a[i].Description != b[i].Description {
			return false
		}
		if !slices.Equal(a[i].Children, b[i].Children) {
			return false
		}
	}
	return true
}

// publicTagCatalog exposes the catalog to anonymous clients so the author picker
// and the catalog filters share one source of truth. Revision lets a client
// notice that the admin changed the catalog.
func (s *Store) publicTagCatalog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, 405, "method_not_allowed", "method not allowed")
		return
	}
	s.mu.RLock()
	groups := s.effectiveTagCatalogLocked()
	revision := s.Catalog.Settings.Revision
	s.mu.RUnlock()
	// The catalog changes when an admin saves it; a cached copy would keep the
	// author picker and the catalog filters on a retired tag list.
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, map[string]any{"groups": groups, "revision": revision})
}
