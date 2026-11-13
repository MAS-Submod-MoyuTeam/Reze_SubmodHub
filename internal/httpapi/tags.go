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
// Name is the canonical, untranslated storage key — it is what mod.Tags holds
// and what tagCatalogNames prunes against — while DisplayName is the localized
// label a chooser actually reads. Leaving the localized name empty is normal:
// readers then fall back to zh and finally to Name itself, so a brand-new tag
// never renders as blank.
//
// Every tag also carries its own Description: the admin writes it once and the
// same sentence explains the tag in the author picker and in the catalog
// filter, so a name like "杂项" is not the only thing a chooser has to go on.
type TagGroup struct {
	Name        string        `json:"name"`
	DisplayName LocalizedText `json:"display_name,omitempty"`
	Description LocalizedText `json:"description,omitempty"`
	Children    []TagChild    `json:"children,omitempty"`
}

// TagChild is a child tag. It is a full tag (name + localized display name and
// description) rather than a bare string so a sub-tag can explain itself
// exactly like its parent.
type TagChild struct {
	Name        string        `json:"name"`
	DisplayName LocalizedText `json:"display_name,omitempty"`
	Description LocalizedText `json:"description,omitempty"`
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
//
// Display names are seeded because this is the only place that knows what the
// Chinese labels mean: an English reader of a fresh deployment should still see
// "Tools", not "工具". Name stays the Chinese word, which is what existing mods
// already stored in their Tags.
func defaultTagCatalog() []TagGroup {
	return []TagGroup{
		{Name: "工具", DisplayName: LocalizedText{"zh": "工具", "en": "Tools"}},
		{Name: "话题", DisplayName: LocalizedText{"zh": "话题", "en": "Topics"}},
		{Name: "功能", DisplayName: LocalizedText{"zh": "功能", "en": "Features"}},
		{Name: "UI", DisplayName: LocalizedText{"zh": "UI", "en": "UI"}},
		{Name: "音乐", DisplayName: LocalizedText{"zh": "音乐", "en": "Music"}},
		{Name: "背景", DisplayName: LocalizedText{"zh": "背景", "en": "Backgrounds"}},
		{Name: "杂项", DisplayName: LocalizedText{"zh": "杂项", "en": "Misc"}},
		{Name: "小游戏", DisplayName: LocalizedText{"zh": "小游戏", "en": "Minigames"}},
		{Name: "窗口反应", DisplayName: LocalizedText{"zh": "窗口反应", "en": "Window Reactions"}},
		{Name: "整活", DisplayName: LocalizedText{"zh": "整活", "en": "Fun & Memes"}},
		{Name: "浪漫", DisplayName: LocalizedText{"zh": "浪漫", "en": "Romance"}},
		{Name: "ai", DisplayName: LocalizedText{"zh": "AI", "en": "AI"}},
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

// cloneTagCatalog deep-copies the catalog, including the localized maps: a map
// is a reference, so sharing one between the store and a response would let a
// caller's mutation reach persisted settings.
func cloneTagCatalog(groups []TagGroup) []TagGroup {
	out := make([]TagGroup, len(groups))
	for i, group := range groups {
		out[i] = TagGroup{
			Name:        group.Name,
			DisplayName: group.DisplayName.clone(),
			Description: group.Description.clone(),
		}
		if len(group.Children) > 0 {
			children := make([]TagChild, len(group.Children))
			for j, child := range group.Children {
				children[j] = TagChild{
					Name:        child.Name,
					DisplayName: child.DisplayName.clone(),
					Description: child.Description.clone(),
				}
			}
			out[i].Children = children
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

// normalizeTagDisplayName trims a localized label. It may be empty: the reader
// then falls back to zh and finally to the canonical Name, so an untranslated
// tag still has a label. The same length budget as the name applies per
// language, since it is rendered in the same chip.
func normalizeTagDisplayName(raw LocalizedText) (LocalizedText, error) {
	return normalizeLocalizedRunes("invalid_tag_catalog", "标签显示名", raw, maxTagNameRunes)
}

// normalizeTagDescription trims the explanation and enforces the one-line
// budget per language entry. An empty description is allowed: tags whose name
// already says it all do not need filler text.
func normalizeTagDescription(raw LocalizedText) (LocalizedText, error) {
	return normalizeLocalizedRunes("invalid_tag_catalog", "标签描述", raw, maxTagDescriptionRunes)
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
		displayName, err := normalizeTagDisplayName(group.DisplayName)
		if err != nil {
			return nil, err
		}
		description, err := normalizeTagDescription(group.Description)
		if err != nil {
			return nil, err
		}
		if len(group.Children) > maxTagChildren {
			return nil, violation("invalid_tag_catalog", "主标签 %q 下的子标签最多 %d 个", name, maxTagChildren)
		}
		normalized := TagGroup{Name: name, DisplayName: displayName, Description: description}
		for _, raw := range group.Children {
			child, err := normalizeTagName(raw.Name)
			if err != nil {
				return nil, err
			}
			childDisplayName, err := normalizeTagDisplayName(raw.DisplayName)
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
			normalized.Children = append(normalized.Children, TagChild{Name: child, DisplayName: childDisplayName, Description: childDescription})
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

// pruneModTagsForCatalogLocked removes every tag the given catalog no longer
// defines from the stored mods, keeping the "a mod only carries catalog tags"
// invariant in the same save as the catalog write. It returns the previous tag
// lists keyed by mod index so a failed save can restore them.
// Callers must hold s.mu for writing.
func (s *Store) pruneModTagsForCatalogLocked(catalog []TagGroup) map[int][]string {
	allowed := tagCatalogNames(catalog)
	pruned := make(map[int][]string)
	for i := range s.Catalog.Mods {
		tags := s.Catalog.Mods[i].Tags
		kept := make([]string, 0, len(tags))
		for _, tag := range tags {
			if allowed[tag] {
				kept = append(kept, tag)
			}
		}
		if len(kept) == len(tags) {
			continue
		}
		pruned[i] = tags
		s.Catalog.Mods[i].Tags = kept
	}
	return pruned
}

// localizedEqual compares two localized values key by key: maps are reference
// types, so == would compare identity and every re-save would look like a change.
func localizedEqual(a, b LocalizedText) bool {
	if len(a) != len(b) {
		return false
	}
	for lang, text := range a {
		if b[lang] != text {
			return false
		}
	}
	return true
}

func tagChildEqual(a, b TagChild) bool {
	return a.Name == b.Name && localizedEqual(a.DisplayName, b.DisplayName) && localizedEqual(a.Description, b.Description)
}

// tagCatalogEqual decides whether an edit actually changed the catalog, so the
// audit trail does not claim a change for a no-op save.
func tagCatalogEqual(a, b []TagGroup) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		// Descriptions and display names are part of the catalog: editing one
		// changes what every chooser reads, so it has to count as a change.
		if a[i].Name != b[i].Name || !localizedEqual(a[i].DisplayName, b[i].DisplayName) || !localizedEqual(a[i].Description, b[i].Description) {
			return false
		}
		if len(a[i].Children) != len(b[i].Children) {
			return false
		}
		for j := range a[i].Children {
			if !tagChildEqual(a[i].Children[j], b[i].Children[j]) {
				return false
			}
		}
	}
	return true
}

// publicTagCatalog exposes the catalog to anonymous clients so the author picker
// and the catalog filters share one source of truth. Revision lets a client
// notice that the admin changed the catalog.
//
// The localized objects are always sent whole: the client owns the language
// choice and may render two languages side by side. ?lang= (or Accept-Language)
// only adds the language this request resolved to and a convenience label per
// tag, so a thin client does not have to re-implement the fallback rules.
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
	lang := resolveLanguage(r)
	writeJSON(w, 200, map[string]any{"groups": publicTagGroups(groups, lang), "revision": revision, "lang": lang})
}

// publicTagWire is one catalog entry as a client reads it: the full localized
// objects plus labels resolved for the requested language.
type publicTagWire struct {
	Name            string               `json:"name"`
	DisplayName     LocalizedText        `json:"display_name,omitempty"`
	Description     LocalizedText        `json:"description,omitempty"`
	Label           string               `json:"label"`
	DescriptionText string               `json:"description_text,omitempty"`
	Children        []publicChildTagWire `json:"children,omitempty"`
}

type publicChildTagWire struct {
	Name            string        `json:"name"`
	DisplayName     LocalizedText `json:"display_name,omitempty"`
	Description     LocalizedText `json:"description,omitempty"`
	Label           string        `json:"label"`
	DescriptionText string        `json:"description_text,omitempty"`
}

// tagLabel resolves a tag's visible label: the requested language, then zh, then
// the canonical Name. Name is never empty, so the label always renders.
// tagLabel resolves the label a reader sees for a tag.
//
// Only the requested language's own translation counts; there is no fallback to
// another language. The canonical Name is also the Chinese label, so a tag that
// only carries an English name still reads correctly in Chinese instead of
// flipping to English. A tag with no translations at all reads as its Name.
func tagLabel(name string, display LocalizedText, lang string) string {
	if lang == "" {
		return name
	}
	if label := strings.TrimSpace(display[lang]); label != "" {
		return label
	}
	return name
}

func publicTagGroups(groups []TagGroup, lang string) []publicTagWire {
	out := make([]publicTagWire, len(groups))
	for i, group := range groups {
		wire := publicTagWire{
			Name:            group.Name,
			DisplayName:     group.DisplayName,
			Description:     group.Description,
			Label:           tagLabel(group.Name, group.DisplayName, lang),
			DescriptionText: group.Description.For(lang),
		}
		for _, child := range group.Children {
			wire.Children = append(wire.Children, publicChildTagWire{
				Name:            child.Name,
				DisplayName:     child.DisplayName,
				Description:     child.Description,
				Label:           tagLabel(child.Name, child.DisplayName, lang),
				DescriptionText: child.Description.For(lang),
			})
		}
		out[i] = wire
	}
	return out
}
