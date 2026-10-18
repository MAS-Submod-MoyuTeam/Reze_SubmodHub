package install

import (
	"os"
	"path"
	"path/filepath"
	"strings"
)

// compiledArtifactCandidates returns the generated cache files that belong to a
// managed source file. Only files that currently exist on disk are returned.
//
// Ren'Py compiles every .rpy into a sibling .rpyc and every .rpym into .rpymc.
// Python imports can also leave bytecode next to a module or inside __pycache__.
// All of these are derived data: they are never recorded in the manifest, but if
// they outlive their source they can keep stale code loadable (an orphan .rpyc is
// loaded by Ren'Py even when the corresponding .rpy is gone).
func compiledArtifactCandidates(root, display string) []string {
	lower := strings.ToLower(display)
	var rels []string
	switch {
	case strings.HasSuffix(lower, ".rpy"):
		rels = append(rels, display[:len(display)-len(".rpy")]+".rpyc")
	case strings.HasSuffix(lower, ".rpym"):
		rels = append(rels, display[:len(display)-len(".rpym")]+".rpymc")
	case strings.HasSuffix(lower, ".py"):
		base := display[:len(display)-len(".py")]
		rels = append(rels, base+".pyc", base+".pyo")
		rels = append(rels, pycacheArtifacts(root, display)...)
	default:
		return nil
	}

	out := make([]string, 0, len(rels))
	seen := make(map[string]bool, len(rels))
	for _, rel := range rels {
		if seen[rel] {
			continue
		}
		seen[rel] = true
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel))); err != nil {
			continue
		}
		out = append(out, rel)
	}
	return out
}

// pycacheArtifacts lists CPython's __pycache__ entries for a .py source file.
// Only bytecode belonging to that module is returned; unrelated caches in the
// same directory are preserved.
func pycacheArtifacts(root, display string) []string {
	dir := path.Dir(display)
	stem := path.Base(display[:len(display)-len(".py")])
	cacheRel := path.Join(dir, "__pycache__")
	entries, err := os.ReadDir(filepath.Join(root, filepath.FromSlash(cacheRel)))
	if err != nil {
		return nil
	}

	prefix := stem + "."
	var out []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasPrefix(name, prefix) {
			continue
		}
		if !strings.HasSuffix(name, ".pyc") && !strings.HasSuffix(name, ".pyo") {
			continue
		}
		out = append(out, path.Join(cacheRel, name))
	}
	return out
}

// planCompiledCacheCleanup records generated cache files that must be purged when
// their source script is written, restored, or deleted. This keeps compiled
// residue from shadowing new content or resurrecting an uninstalled mod while the
// files stay untracked, so they never participate in layer restore logic.
//
// Global caches such as game/cache/bytecode.rpyb and game/cache/shaders.txt are
// intentionally left alone: Ren'Py reconciles them against the scripts it scans
// and regenerates them, and they do not carry per-mod ownership.
func planCompiledCacheCleanup(plan *Plan) {
	if plan == nil || plan.NewManifest == nil {
		return
	}

	actionKeys := make(map[string]bool, len(plan.Actions))
	for _, action := range plan.Actions {
		actionKeys[action.Key] = true
	}

	seen := make(map[string]bool)
	for _, action := range plan.Actions {
		switch action.Action {
		case ActionWrite, ActionDelete, ActionRestoreOriginal, ActionRestoreLayer:
		default:
			continue
		}

		// A write/restore invalidates a cache compiled from a source that already
		// existed. If no source is present yet, a same-named compiled file may be
		// the only copy of a compiled-only script, so it is not ours to delete.
		if action.Action != ActionDelete && !action.CurrentExists {
			continue
		}

		for _, rel := range compiledArtifactCandidates(plan.Root, action.Path) {
			key := manifestCanonicalKey(rel)
			if actionKeys[key] || seen[key] {
				continue
			}
			// A compiled file managed as game content (shipped by a mod or part of
			// the original game) already has its own layer/action; never shadow it.
			if rec := plan.NewManifest.GetFile(key); rec != nil && (len(rec.Layers) > 0 || rec.Original.Exists) {
				continue
			}
			seen[key] = true
			plan.CleanupPaths = append(plan.CleanupPaths, rel)
		}
	}
}

// removeGeneratedCacheFile deletes a generated cache artifact. A missing file is
// success: it may have been cleaned between preview and execution. Windows never
// unlinks a read-only file, so clear that bit and retry once. Any other failure
// is returned to the transaction, which rolls back rather than committing with an
// orphan compiled script that could keep loading stale or uninstalled code.
func removeGeneratedCacheFile(path string) error {
	err := os.Remove(path)
	if err == nil || os.IsNotExist(err) {
		return nil
	}
	info, statErr := os.Stat(path)
	if statErr == nil && info.Mode().IsRegular() && info.Mode().Perm()&0o200 == 0 {
		if chmodErr := os.Chmod(path, info.Mode().Perm()|0o200); chmodErr == nil {
			retryErr := os.Remove(path)
			if retryErr == nil || os.IsNotExist(retryErr) {
				return nil
			}
			return retryErr
		}
	}
	return err
}
