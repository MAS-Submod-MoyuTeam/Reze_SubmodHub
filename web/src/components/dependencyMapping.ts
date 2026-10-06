import { ModDependency, ModSummary } from '../types/submodhub';

/** Preserve the MAS dependency name while linking only an exact, published catalog match. */
export function mapDependencyInput(
  dependency: ModDependency,
  input: string,
  mods: ModSummary[],
  ownerModId: string,
): ModDependency {
  const value = input.trim();
  const matches = mods.filter((mod) =>
    mod.is_published &&
    mod.id !== ownerModId &&
    (mod.title === value || mod.id === value),
  );
  const linked = matches.length === 1 ? matches[0] : undefined;
  return {
    ...dependency,
    mod_id: value,
    mod_title: value,
    linked_mod_id: linked?.id,
  };
}

export function mapDependencyRangeInput(dependency: ModDependency, input: string): ModDependency {
  return { ...dependency, version_range: input.trim() };
}

export function mapDependencySelection(dependency: ModDependency, mod: Pick<ModSummary, 'id' | 'title'>, preserveName = true): ModDependency {
  return {
    ...dependency,
    mod_id: preserveName ? dependency.mod_id || mod.title : mod.title,
    mod_title: preserveName ? dependency.mod_title || dependency.mod_id || mod.title : mod.title,
    linked_mod_id: mod.id,
  };
}
