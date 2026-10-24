package httpapi

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/Masterminds/semver/v3"

	"github.com/reze/submodhub/internal/github"
)

// appVersionProbeInterval bounds how often the server reads the repository-root
// VERSION file. It is deliberately shorter than the release snapshot window: the
// probe costs no REST quota, so it is the cheap early warning that lets a passive
// update check notice a new release quickly.
const appVersionProbeInterval = time.Minute

// appVersionProbeBudget bounds the probe inside a request. The file is a few
// bytes and the tag check below reuses the same connection, so this only exists
// so an unreachable raw host cannot hold the descriptor open for the whole
// request budget.
const appVersionProbeBudget = 1500 * time.Millisecond

// probeAppReleaseVersion reads VERSION at most once per probe interval and
// records whether it names a release the snapshot does not have.
//
// Failures are silent by design: the probe is an optimisation, so a missing or
// unreadable file must leave the ten-minute snapshot rhythm exactly as it was.
// The window is reserved *before* the request so a failing probe is not retried
// by every arriving client.
func (s *Store) probeAppReleaseVersion(ctx context.Context) {
	if !s.reserveAppReleaseProbe() {
		return
	}
	owner, repo := s.appReleaseRepo()
	client := s.githubClient()
	version, err := client.FetchRepoVersion(ctx, owner, repo)
	if err != nil {
		s.finishAppReleaseProbe(version, false, err)
		return
	}
	// VERSION running ahead of the served tag is the *normal* state while CI
	// builds: the release workflow bumps the file first and creates the tag only
	// after every client build has finished. Asking the release API in that state
	// can only return the snapshot that is already served, so the tag itself is
	// what has to be confirmed first — and the same raw host answers that for
	// free. Without this gate the whole build window would cost one REST refresh
	// per probe window.
	tagExists := false
	if servedTag, ok := s.appReleaseServedTag(); ok && versionIsNewer(version, servedTag) {
		tagExists, err = s.appReleaseTagExists(ctx, client, owner, repo, appReleaseTagFor(version, servedTag))
		if err != nil {
			s.finishAppReleaseProbe(version, false, err)
			return
		}
	}
	s.finishAppReleaseProbe(version, tagExists, nil)
}

func (s *Store) reserveAppReleaseProbe() bool {
	state := &s.appRelease
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.probing || time.Since(state.probedAt) < appVersionProbeInterval {
		return false
	}
	state.probing = true
	return true
}

// appReleaseTagExists reports whether the tag a version would be released under
// is already in the repository. A tag that is not there cannot have a release, so
// a refresh would only re-read what is already served.
func (s *Store) appReleaseTagExists(ctx context.Context, client *github.Client, owner, repo, tag string) (bool, error) {
	_, err := client.FetchRepoVersionAt(ctx, owner, repo, tag)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, github.ErrNotFound) {
		return false, nil
	}
	return false, err
}

// finishAppReleaseProbe records one observation. It compares against the snapshot
// that is served *now*: a refresh may have completed while the probe was in
// flight, and a stale "ahead" would schedule a pointless REST call.
//
// Two gates stand between an observation and a refresh, and they answer different
// questions. tagExists answers "is there anything to fetch yet?" and removes the
// cost of the ordinary CI build window entirely. aheadVersion answers "have we
// already paid for this exact value?" and caps the pathological case where the tag
// exists but no usable release does (a draft, a prerelease, or a release that is
// still being created): that costs one refresh per VERSION value, not one per
// probe window.
func (s *Store) finishAppReleaseProbe(version string, tagExists bool, err error) {
	state := &s.appRelease
	state.mu.Lock()
	defer state.mu.Unlock()
	state.probing = false
	state.probedAt = time.Now()
	if err != nil || state.release == nil {
		// A failed read says nothing about whether a new release exists, so the
		// previous observation stands.
		return
	}
	if !versionIsNewer(version, state.release.TagName) {
		// The snapshot caught up (or VERSION moved back): nothing is outstanding.
		state.probeAhead = false
		state.aheadVersion = ""
		return
	}
	if !tagExists {
		// CI has not created the tag yet, so the release cannot exist either. No
		// refresh was paid for, so the value is deliberately not retired: the next
		// probe window must be free to promote it the moment the tag appears.
		state.probeAhead = false
		return
	}
	if version == state.aheadVersion {
		// This value already paid for a refresh and the release still is not there.
		// Waiting for a change is both cheaper and strictly more informative than
		// re-reading it every minute.
		state.probeAhead = false
		return
	}
	state.aheadVersion = version
	state.probeAhead = true
}

// appReleaseTagFor derives the tag a version would be released under, using the
// prefix the served tag already uses. The release workflow tags "v"+VERSION; the
// prefix is read from the snapshot instead of hard-coded so a repository that
// tags differently still resolves.
func appReleaseTagFor(version, servedTag string) string {
	if strings.HasPrefix(servedTag, "v") {
		return "v" + version
	}
	return version
}

// versionIsNewer compares a VERSION value against a release tag. Both sides go
// through the same semver parser, so "v0.9.13" and "0.9.13" compare equal. Anything
// unparsable is not "newer": a false positive here would cost a REST refresh on
// every check.
func versionIsNewer(probed, servedTag string) bool {
	candidate, err := semver.NewVersion(probed)
	if err != nil {
		return false
	}
	current, err := semver.NewVersion(servedTag)
	if err != nil {
		return false
	}
	return candidate.GreaterThan(current)
}
