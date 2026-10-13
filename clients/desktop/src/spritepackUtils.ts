export function normalizeSpriteSetIDs(ids?: string[] | null): string[] {
  if (!Array.isArray(ids)) return [];
  const clean = ids
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0);
  return Array.from(new Set(clean)).sort();
}

export function isSpriteSelectionValid(
  selectedSets: string[],
  manifestSets: Array<{ id: string }>,
  loading: boolean,
  error?: string | null,
): boolean {
  if (loading || Boolean(error)) return false;
  if (selectedSets.length === 0 || manifestSets.length === 0) return false;
  return selectedSets.every((id) => manifestSets.some((set) => set.id === id));
}
