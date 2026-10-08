import semver from 'semver';

export function formatVersionLabel(version: string): string {
  return version;
}

export function sortVersionHistory<T extends { id?: string; version: string }>(
  versions: T[],
  isGitHubSource: boolean,
  latestVersionId?: string,
): T[] {
  if (!isGitHubSource) return versions;

  return [...versions].sort((left, right) => {
    if (latestVersionId && left.id === latestVersionId) return -1;
    if (latestVersionId && right.id === latestVersionId) return 1;
    const leftVersion = semver.valid(semver.clean(left.version) || '');
    const rightVersion = semver.valid(semver.clean(right.version) || '');
    if (leftVersion && rightVersion) return semver.rcompare(leftVersion, rightVersion);
    if (leftVersion) return -1;
    if (rightVersion) return 1;
    return right.version.localeCompare(left.version, undefined, { numeric: true, sensitivity: 'base' });
  });
}
