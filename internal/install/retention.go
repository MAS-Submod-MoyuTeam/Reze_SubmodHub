package install

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// CompletedRetention is how long a finished transaction keeps its journal and
// the before-images only that journal still references. Losing them cannot
// affect install/update/uninstall/repair: those read manifest.json, never a
// finished journal.
const CompletedRetention = 7 * 24 * time.Hour

// PruneResult reports what a retention pass removed. Counts are for logging and
// tests; callers must treat the pass as best effort.
type PruneResult struct {
	Skipped                bool  `json:"skipped"`
	DeletedJournals        int   `json:"deleted_journals"`
	RetainedJournals       int   `json:"retained_journals"`
	DeletedLegacyJournals  int   `json:"deleted_legacy_journals"`
	RetainedLegacyJournals int   `json:"retained_legacy_journals"`
	DeletedLegacyBackups   int   `json:"deleted_legacy_backups"`
	DeletedBlobs           int   `json:"deleted_blobs"`
	RetainedBlobs          int   `json:"retained_blobs"`
	FreedBytes             int64 `json:"freed_bytes"`
}

// PruneCompleted deletes journals that reached a terminal phase before the
// retention cutoff, together with everything only they referenced: blobs, and
// the pre-schema-2 backup directories of legacy journals.
//
// Safety rules, in order of authority:
//  1. manifest.json is the source of truth. If it cannot be read nothing is
//     deleted, because a broken manifest would make every blob look orphaned.
//  2. Only committed/rolled_back journals expire. planned, prepared, applying,
//     committing and needs_manual_recovery always survive: they are recovery
//     material, and so are the blobs they reference.
//  3. Unparsable journals and journals without a usable timestamp are kept. This
//     pass never destroys evidence it cannot classify.
//  4. Legacy journals (state root *.json) follow the same rule. Their
//     state/backups/<journal file name> directory is removed with them, since
//     nothing else references that per-operation snapshot.
//  5. A blob survives when its hash appears in manifest.json (original snapshot
//     or any layer, including shadowed lower layers) or in any retained journal.
//  6. A blob also survives while its content has been needed inside the
//     retention window. BlobStore.Put refreshes the mtime of an existing blob, so
//     this protects targets staged by a preview that has not been confirmed yet,
//     even when the plan holding them lives only in client memory.
func (i *Installer) PruneCompleted(now time.Time) (PruneResult, error) {
	var result PruneResult
	if i == nil || i.state == "" {
		return result, &Error{Code: "invalid_state", Err: errors.New("installer state is not configured")}
	}

	lock, err := i.acquireLock()
	if err != nil {
		if IsCode(err, "instance_busy") {
			// Another transaction owns the state right now; the next pass retries.
			result.Skipped = true
			return result, nil
		}
		return result, err
	}
	defer lock.Release()

	manifest, err := i.LoadManifest()
	if err != nil {
		return result, &Error{Code: "manifest_corrupt", Err: err}
	}

	cutoff := now.Add(-CompletedRetention)

	type journalEntry struct {
		path string
		j    TxJournal
	}
	type legacyEntry struct {
		path string
		// fileID is derived from the file name, which is what writeJournal uses
		// for both the file and the state/backups/<id> snapshot directory. The
		// Operation.ID embedded in the JSON can disagree when a file was renamed
		// or tampered with; the name is the only thing that describes this file.
		fileID string
		j      Journal
	}

	var journals []journalEntry
	if entries, readErr := os.ReadDir(filepath.Join(i.state, "journals")); readErr == nil {
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			path := filepath.Join(i.state, "journals", entry.Name())
			raw, readFileErr := os.ReadFile(path)
			if readFileErr != nil {
				continue
			}
			var j TxJournal
			if jsonErr := json.Unmarshal(raw, &j); jsonErr != nil {
				continue
			}
			if j.OperationID == "" {
				j.OperationID = strings.TrimSuffix(entry.Name(), ".json")
			}
			journals = append(journals, journalEntry{path: path, j: j})
		}
	}

	var legacyJournals []legacyEntry
	if entries, readErr := os.ReadDir(i.state); readErr == nil {
		for _, entry := range entries {
			if entry.IsDir() || entry.Name() == "manifest.json" || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			path := filepath.Join(i.state, entry.Name())
			raw, readFileErr := os.ReadFile(path)
			if readFileErr != nil {
				continue
			}
			var j Journal
			if jsonErr := json.Unmarshal(raw, &j); jsonErr != nil {
				continue
			}
			fileID := strings.TrimSuffix(entry.Name(), ".json")
			legacyJournals = append(legacyJournals, legacyEntry{path: path, fileID: fileID, j: j})
		}
	}

	retained := make([]journalEntry, 0, len(journals))
	expired := make([]journalEntry, 0, len(journals))
	for _, entry := range journals {
		if !isFinishedPhase(entry.j.Phase) {
			retained = append(retained, entry)
			continue
		}
		finishedAt := entry.j.UpdatedAt
		if finishedAt.IsZero() {
			finishedAt = entry.j.CreatedAt
		}
		if finishedAt.IsZero() || !finishedAt.Before(cutoff) {
			retained = append(retained, entry)
			continue
		}
		expired = append(expired, entry)
	}

	retainedLegacy := make([]legacyEntry, 0, len(legacyJournals))
	expiredLegacy := make([]legacyEntry, 0, len(legacyJournals))
	for _, entry := range legacyJournals {
		if !isFinishedLegacyState(entry.j.State) {
			retainedLegacy = append(retainedLegacy, entry)
			continue
		}
		finishedAt := entry.j.UpdatedAt
		if finishedAt.IsZero() || !finishedAt.Before(cutoff) {
			retainedLegacy = append(retainedLegacy, entry)
			continue
		}
		expiredLegacy = append(expiredLegacy, entry)
	}

	referenced := manifestBlobHashes(manifest)
	for _, entry := range retained {
		collectJournalBlobHashes(&entry.j, referenced)
	}
	for _, entry := range retainedLegacy {
		collectLegacyBlobHashes(i.state, &entry.j, referenced)
	}

	// Journals first: if the process dies mid-pass the next run simply finishes
	// the blob sweep, and no retained journal ever points at a deleted blob.
	for _, entry := range expired {
		if removeErr := os.Remove(entry.path); removeErr != nil && !os.IsNotExist(removeErr) {
			return result, removeErr
		}
		result.DeletedJournals++
	}
	result.RetainedJournals = len(retained)

	for _, entry := range expiredLegacy {
		if removeErr := os.Remove(entry.path); removeErr != nil && !os.IsNotExist(removeErr) {
			return result, removeErr
		}
		result.DeletedLegacyJournals++
		backupFiles, backupBytes := removeLegacyBackupDir(i.state, entry.fileID)
		result.DeletedLegacyBackups += backupFiles
		result.FreedBytes += backupBytes
	}
	result.RetainedLegacyJournals = len(retainedLegacy)

	// The sweep runs even when nothing expired this time. An orphan outlives the
	// journal that mentioned it: a process killed between the deletes above and
	// this sweep leaves blobs nobody references, and skipping the sweep here
	// would strand them forever. The walk costs one directory read per prefix
	// directory plus one stat per unreferenced candidate, not per blob.
	blobsDir := filepath.Join(i.state, "blobs")
	if _, statErr := os.Stat(blobsDir); statErr == nil {
		deleted, retainedCount, freed := pruneBlobs(blobsDir, referenced, cutoff)
		result.DeletedBlobs = deleted
		result.RetainedBlobs = retainedCount
		result.FreedBytes += freed
	}

	return result, nil
}

func isFinishedPhase(phase string) bool {
	return phase == TxPhaseCommitted || phase == TxPhaseRolledBack
}

// isFinishedLegacyState mirrors getTxJournal's legacy mapping: a missing state
// reads as committed. That also means a legacy journal truncated down to "{}"
// counts as finished once it is old enough; it is safe to drop because such a
// file carries no Backups and no Changes, so it can never restore anything.
func isFinishedLegacyState(state string) bool {
	return state == "" || state == "committed" || state == TxPhaseRolledBack
}

// addReferencedHash records a hash the sweep must keep. Hashes are compared
// against blob file names, which are always lower case, so the set is folded to
// lower case: an upper-case hash from a hand-edited manifest or a journal written
// by an older build must not turn a live blob into an orphan.
func addReferencedHash(set map[string]bool, hash string) {
	if hash == "" {
		return
	}
	set[strings.ToLower(hash)] = true
}

func manifestBlobHashes(m *Manifest) map[string]bool {
	set := make(map[string]bool)
	if m == nil {
		return set
	}
	for _, rec := range m.Files {
		if rec == nil {
			continue
		}
		addReferencedHash(set, rec.Original.Hash)
		for _, layer := range rec.Layers {
			addReferencedHash(set, layer.Hash)
		}
	}
	return set
}

func collectJournalBlobHashes(j *TxJournal, set map[string]bool) {
	if j == nil {
		return
	}
	for _, before := range j.BeforeFiles {
		if before.Existed {
			addReferencedHash(set, before.Hash)
		}
	}
	for _, after := range j.AfterFiles {
		if after.Exists {
			addReferencedHash(set, after.Hash)
		}
	}
}

// collectLegacyBlobHashes recognises the legacy backup map, whose values point at
// blob files for installs written by the current Apply path.
func collectLegacyBlobHashes(stateDir string, j *Journal, set map[string]bool) {
	if j == nil {
		return
	}
	blobsDir := filepath.Join(stateDir, "blobs")
	for _, backupPath := range j.Backups {
		if hash, ok := blobHashFromPath(blobsDir, backupPath); ok {
			addReferencedHash(set, hash)
		}
	}
}

func blobHashFromPath(blobsDir, path string) (string, bool) {
	if path == "" {
		return "", false
	}
	rel, err := filepath.Rel(blobsDir, filepath.Clean(path))
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
		return "", false
	}
	parts := strings.Split(filepath.ToSlash(rel), "/")
	if len(parts) != 2 {
		return "", false
	}
	hash := parts[1]
	if !isBlobHash(hash) || parts[0] != hash[:2] {
		return "", false
	}
	return hash, true
}

// removeLegacyBackupDir deletes the per-operation snapshot directory of a pruned
// legacy journal. Only a direct child of state/backups named after the journal
// file is touched.
func removeLegacyBackupDir(stateDir, fileID string) (files int, bytes int64) {
	if fileID == "" || strings.ContainsAny(fileID, `/\`) || fileID == "." || fileID == ".." {
		return 0, 0
	}
	backupsDir := filepath.Join(stateDir, "backups")
	dir := filepath.Join(backupsDir, fileID)
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return 0, 0
	}
	if err := filepath.WalkDir(dir, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return nil
		}
		if fileInfo, statErr := entry.Info(); statErr == nil {
			files++
			bytes += fileInfo.Size()
		}
		return nil
	}); err != nil {
		return 0, 0
	}
	if err := os.RemoveAll(dir); err != nil {
		return 0, 0
	}
	if remaining, readErr := os.ReadDir(backupsDir); readErr == nil && len(remaining) == 0 {
		_ = os.Remove(backupsDir)
	}
	return files, bytes
}

// pruneBlobs removes content-addressed blobs absent from referenced and older
// than cutoff, then drops prefix directories that became empty. Unknown directory
// layouts are left untouched: this sweep only ever deletes what it recognised as
// a blob.
//
// The cutoff keeps a blob whose content has been needed recently, which is how a
// preview's staged targets survive: the plan that references them lives in client
// memory, so only the blob's own timestamp can speak for it.
//
// Empty prefix directories are deliberately left behind: removing them would race
// a preview that stages a blob into that prefix without the instance lock
// (MkdirAll, then write), and it would cost a second directory read per prefix on
// every sweep. They are bounded at 256 and BlobStore reuses them.
func pruneBlobs(blobsDir string, referenced map[string]bool, cutoff time.Time) (deleted, retained int, freed int64) {
	prefixDirs, err := os.ReadDir(blobsDir)
	if err != nil {
		return 0, 0, 0
	}
	for _, prefixDir := range prefixDirs {
		if !prefixDir.IsDir() || !isBlobPrefix(prefixDir.Name()) {
			continue
		}
		dir := filepath.Join(blobsDir, prefixDir.Name())
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			name := entry.Name()
			if entry.IsDir() || !isBlobHash(name) || name[:2] != prefixDir.Name() {
				continue
			}
			// Referenced blobs are decided without touching the filesystem; only a
			// candidate for deletion needs its timestamp and size.
			if referenced[name] {
				retained++
				continue
			}
			info, statErr := entry.Info()
			if statErr != nil {
				continue
			}
			if !info.ModTime().Before(cutoff) {
				retained++
				continue
			}
			if removeErr := os.Remove(filepath.Join(dir, name)); removeErr != nil {
				continue
			}
			deleted++
			freed += info.Size()
		}
	}
	return deleted, retained, freed
}

func isBlobPrefix(name string) bool {
	return len(name) == 2 && isLowerHex(name)
}

func isBlobHash(name string) bool {
	return len(name) == 64 && isLowerHex(name)
}

func isLowerHex(s string) bool {
	for _, r := range s {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}
