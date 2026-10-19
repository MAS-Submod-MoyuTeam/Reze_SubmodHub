type VersionEntry = { id?: string; version: string; created_at?: string };

const versionCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export function sortVersionHistory<T extends VersionEntry>(
  versions: T[],
  latestVersionId?: string,
): T[] {
  return [...versions].sort((left, right) => {
    if (latestVersionId && left.id === latestVersionId) return -1;
    if (latestVersionId && right.id === latestVersionId) return 1;

    const byVersion = versionCollator.compare(right.version, left.version);
    if (byVersion !== 0) return byVersion;
    return (right.created_at || '').localeCompare(left.created_at || '');
  });
}
