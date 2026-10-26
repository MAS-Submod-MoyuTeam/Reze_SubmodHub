export type DiskUsage = {
  /** Integer occupancy percentage of the volume, 0–100. */
  percent: number;
  /** Bytes currently occupied on the volume. */
  usedBytes: number;
};

/**
 * Occupancy of the volume hosting the active MAS instance.
 *
 * Returns null when the backend reported no capacity or no free space, so the
 * caller can render an explicit unknown state instead of inventing a bar width.
 * Out-of-range readings (free space above capacity) are clamped instead of
 * producing negative occupancy.
 */
export function computeDiskUsage(
  availableBytes?: number | null,
  totalBytes?: number | null,
): DiskUsage | null {
  if (typeof availableBytes !== 'number' || typeof totalBytes !== 'number') return null;
  if (!Number.isFinite(availableBytes) || !Number.isFinite(totalBytes)) return null;
  if (totalBytes <= 0) return null;

  const usedBytes = Math.min(Math.max(totalBytes - availableBytes, 0), totalBytes);
  return { percent: Math.round((usedBytes / totalBytes) * 100), usedBytes };
}
