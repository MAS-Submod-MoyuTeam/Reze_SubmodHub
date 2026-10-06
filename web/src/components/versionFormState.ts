import { ModDependency } from '../types/submodhub';

export function canEditVersion(state: string): boolean {
  return state === 'draft' || state === 'rejected';
}

interface VersionFormSource {
  version: string;
  release_notes: string;
  dependencies: ModDependency[];
}

export function versionFormState(source?: VersionFormSource): { version: string; releaseNotes: string; dependencies: ModDependency[] } {
  return {
    version: source?.version || '',
    releaseNotes: source?.release_notes || '',
    dependencies: source?.dependencies.length
      ? source.dependencies.map((dependency) => ({ ...dependency }))
      : [{ mod_id: '', mod_title: '', version_range: '', required: true }],
  };
}
