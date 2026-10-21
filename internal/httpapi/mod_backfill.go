package httpapi

import "time"

// BackfillModCreatedAt stamps created_at on mods that were recorded before the
// field existed. A mod's earliest version or submission is the closest provable
// upper bound for its creation time, so the backfill is monotone with the old
// "newest version first" order instead of inventing a new one; mods without any
// child record fall back to the supplied timestamp. Only missing values are
// filled, so running the script twice changes nothing. It reports how many mods
// were stamped.
func (s *Store) BackfillModCreatedAt(fallback time.Time) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	earliest := make(map[string]time.Time)
	record := func(modID string, at time.Time) {
		if modID == "" || at.IsZero() {
			return
		}
		at = at.UTC()
		if current, exists := earliest[modID]; !exists || at.Before(current) {
			earliest[modID] = at
		}
	}
	for _, version := range s.Catalog.Versions {
		if version.CreatedAt != nil {
			record(version.ModID, *version.CreatedAt)
		}
	}
	for _, submission := range s.Catalog.Submissions {
		record(submission.ModID, submission.CreatedAt)
	}
	stamped := 0
	for i := range s.Catalog.Mods {
		if s.Catalog.Mods[i].CreatedAt != nil {
			continue
		}
		at, ok := earliest[s.Catalog.Mods[i].ID]
		if !ok {
			at = fallback.UTC()
		}
		s.Catalog.Mods[i].CreatedAt = &at
		stamped++
	}
	if stamped == 0 {
		return 0, nil
	}
	return stamped, s.saveLocked()
}
