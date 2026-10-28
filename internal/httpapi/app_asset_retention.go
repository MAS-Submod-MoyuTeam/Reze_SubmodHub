package httpapi

// App-installer retention. A Cloudreve node mirrors the installers of the
// release it currently serves; older installers are dead weight there, because
// the descriptor never advertises them, while mod archives are still delivered
// for as long as their version is published. So the software itself keeps one
// version per node and everything else is released.

import (
	"context"
	"fmt"
	"log"
	"slices"
	"strings"
	"time"

	"github.com/reze/submodhub/internal/github"
)

const (
	// appAssetPruneInterval paces retention per node revision. One pass costs a
	// directory listing, so it runs slower than the worker tick: a superseded
	// installer that survives ten extra minutes only costs disk space, while
	// listing every node every fifteen seconds costs the provider.
	appAssetPruneInterval = 10 * time.Minute
	// appAssetPruneBudget bounds one node's pass. Retention shares the single
	// delivery worker with uploads, so a provider that accepts the connection and
	// then stalls must not hold the worker for its own HTTP timeout.
	appAssetPruneBudget = 2 * time.Minute
	// appAssetObjectPrefix is the marker the object-naming rule owns. A failed
	// read-back moves an upload to "<name>-<nonce>", so an app object is matched
	// by prefix and installer shape rather than by the generated tag/hash parts.
	appAssetObjectPrefix = "app-"
	// appAssetNonceLen is how many hex characters the read-back failure suffix
	// keeps from the nonce (see finishAppMirror).
	appAssetNonceLen = 12
)

// isAppAssetObjectName reports whether an object is an installer this server
// uploaded: "app-<tag>-<sha12>-<asset>", where <asset> ends in .exe or .apk, plus
// the "<name>-<12 hex>" shape a failed read-back leaves behind. Matching that
// shape rather than "the name contains .exe" keeps mod archives — which live in
// the same directory and are never retired — out of the delete set.
func isAppAssetObjectName(name string) bool {
	if !strings.HasPrefix(name, appAssetObjectPrefix) {
		return false
	}
	lower := strings.ToLower(name)
	if isInstallerName(lower) {
		return true
	}
	// Only the trailing nonce may follow the installer suffix.
	if i := strings.LastIndexByte(lower, '-'); i > 0 {
		nonce := lower[i+1:]
		if len(nonce) == appAssetNonceLen && isLowerHex(nonce) {
			return isInstallerName(lower[:i])
		}
	}
	return false
}

func isInstallerName(name string) bool {
	return strings.HasSuffix(name, ".exe") || strings.HasSuffix(name, ".apk")
}

func isLowerHex(s string) bool {
	for i := 0; i < len(s); i++ {
		if c := s[i]; (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

// appNodeKeepSet collects the object names one node must keep for the release it
// serves. It reports false until every mirrorable asset of that release is ready
// on that node: retiring the previous installers before the new ones are
// downloadable would leave clients with nothing to fetch.
func appNodeKeepSet(n DeliveryNode, mirrors []AppAssetMirror, tag string, candidates []github.Asset) (map[string]bool, bool) {
	keep := make(map[string]bool, len(candidates))
	for _, a := range candidates {
		index := slices.IndexFunc(mirrors, func(m AppAssetMirror) bool {
			return m.NodeID == n.ID && m.NodeRevision == n.Revision && m.Tag == tag && m.AssetName == a.Name && m.State == "ready" && m.FileID != ""
		})
		if index < 0 {
			return nil, false
		}
		objectName := mirrors[index].ObjectName
		if objectName == "" {
			// A ready row without a name would leave keep matching nothing, and that
			// is the one input error which deletes the installers it must protect.
			return nil, false
		}
		keep[objectName] = true
	}
	return keep, true
}

// pruneStaleAppAssets keeps each node's app installers at the release it serves.
// It only ever runs for a node whose current release is completely ready, so a
// failing upload cannot retire a download that still works. force skips the
// pacing for tests.
func (s *Store) pruneStaleAppAssets(ctx context.Context, force bool) {
	release, sums, ok := s.appReleaseSnapshot()
	if !ok {
		return
	}
	candidates := appMirrorCandidates(release, sums)
	if len(candidates) == 0 {
		return
	}
	s.mu.RLock()
	nodes := slices.Clone(s.Catalog.DeliveryNodes)
	mirrors := slices.Clone(s.Catalog.AppAssetMirrors)
	s.mu.RUnlock()
	for _, n := range nodes {
		if !n.Enabled || n.Type != "cloudreve" || n.Directory == "" {
			continue
		}
		keep, ready := appNodeKeepSet(n, mirrors, release.TagName, candidates)
		if !ready || (!force && !s.reserveAppPrune(n)) {
			continue
		}
		passCtx, cancel := context.WithTimeout(ctx, appAssetPruneBudget)
		s.pruneNodeAppAssets(passCtx, n, keep)
		cancel()
	}
}

// pruneNodeAppAssets reads one directory and removes every app installer that is
// not part of the kept set: installers of earlier releases, plus the leftovers of
// uploads whose read-back failed. Archive objects do not match the installer
// shape, so they are never candidates even though they share the directory.
func (s *Store) pruneNodeAppAssets(ctx context.Context, n DeliveryNode, keep map[string]bool) {
	client, err := s.cloudreveClient(n)
	if err != nil {
		// Every error this path can produce is a desensitized code (provider
		// client and secret handling never include response text or request
		// URLs), so logging it is what separates "unreachable node" from
		// "deletion not confirmed" in the field.
		log.Printf("[app-release] retention skipped on %s: %v", n.ID, err)
		return
	}
	listing, err := client.ListAll(ctx, n.Directory)
	if err != nil {
		log.Printf("[app-release] retention listing failed on %s: %v", n.ID, err)
		return
	}
	stale := []string{}
	for _, object := range listing.Objects {
		if object.Type != "file" || object.ID == "" || keep[object.Name] || !isAppAssetObjectName(object.Name) {
			continue
		}
		stale = append(stale, object.ID)
	}
	if len(stale) == 0 {
		return
	}
	if err := client.RemoveObjects(ctx, n.Directory, stale); err != nil {
		log.Printf("[app-release] retiring %d superseded app assets failed on %s: %v", len(stale), n.ID, err)
		return
	}
	log.Printf("[app-release] retired %d superseded app assets on %s", len(stale), n.ID)
}

// reserveAppPrune reports whether this pass may list the node, and records the
// attempt so a provider that keeps failing is not called on every tick.
func (s *Store) reserveAppPrune(n DeliveryNode) bool {
	key := fmt.Sprintf("%s/%d", n.ID, n.Revision)
	runtime := &s.deliveryRuntime
	runtime.pruneMu.Lock()
	defer runtime.pruneMu.Unlock()
	if runtime.appPruneAt == nil {
		runtime.appPruneAt = map[string]time.Time{}
	}
	if last, ok := runtime.appPruneAt[key]; ok && time.Since(last) < appAssetPruneInterval {
		return false
	}
	runtime.appPruneAt[key] = time.Now()
	return true
}
