import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapDependencyInput, mapDependencyRangeInput, mapDependencySelection } from './dependencyMapping';

const mods = [
  { id: 'mod_core', title: 'MAS Core', is_published: true },
  { id: 'mod_draft', title: 'Draft', is_published: false },
] as any;

test('links an exact published title while retaining the entered dependency name', () => {
  const result = mapDependencyInput({ mod_id: 'MAS Core', mod_title: 'MAS Core', version_range: '*', required: true }, 'MAS Core', mods, 'owner');
  assert.equal(result.linked_mod_id, 'mod_core');
  assert.equal(result.mod_id, 'MAS Core');
});

test('keeps unmatched input as an ordinary MAS dependency', () => {
  const result = mapDependencyInput({ mod_id: 'Old Core', mod_title: 'Old Core', version_range: '*', required: true }, 'Old Core', mods, 'owner');
  assert.equal(result.linked_mod_id, undefined);
  assert.equal(result.mod_title, 'Old Core');
});

test('does not link unpublished or self matches', () => {
  assert.equal(mapDependencyInput({ mod_id: 'Draft', version_range: '*', required: true }, 'Draft', mods, 'owner').linked_mod_id, undefined);
  assert.equal(mapDependencyInput({ mod_id: 'owner', version_range: '*', required: true }, 'mod_core', [{ id: 'mod_core', title: 'Core', is_published: true }] as any, 'mod_core').linked_mod_id, undefined);
});

test('allows a dependency to use a custom minimum and maximum range', () => {
  const result = mapDependencyRangeInput({ mod_id: 'Core', version_range: '*', required: true }, '>=1.2.0 <=2.0.0');
  assert.equal(result.version_range, '>=1.2.0 <=2.0.0');
});

test('preserves strict open range syntax for server-side validation', () => {
  const result = mapDependencyRangeInput({ mod_id: 'Core', version_range: '*', required: true }, '1.0.0<X<2.0.0');
  assert.equal(result.version_range, '1.0.0<X<2.0.0');
});

test('leaves an empty dependency range empty for an unrestricted dependency', () => {
  const result = mapDependencyRangeInput({ mod_id: 'Core', version_range: '>=1.0.0', required: true }, '  ');
  assert.equal(result.version_range, '');
});

test('explicit catalog selection links the selected mod even when titles are duplicated', () => {
  const dependency = { mod_id: 'MAS Core', mod_title: 'MAS Core', version_range: '', required: true };
  const result = mapDependencySelection(dependency, { id: 'second', title: 'Core' } as any);
  assert.equal(result.mod_id, 'MAS Core');
  assert.equal(result.linked_mod_id, 'second');
  const typed = mapDependencyInput(dependency, 'Core', [
    { id: 'first', title: 'Core', is_published: true },
    { id: 'second', title: 'Core', is_published: true },
  ] as any, 'owner');
  assert.equal(typed.linked_mod_id, undefined);
});

test('manual selection clears automatically discovered candidates', () => {
  const result = mapDependencySelection({ mod_id: 'Core', mod_title: 'Core', linked_mod_ids: ['first', 'second'], version_range: '', required: true }, { id: 'second', title: 'Core' } as any);
  assert.equal(result.linked_mod_id, 'second');
  assert.equal(result.linked_mod_ids, undefined);
});

test('new dependency selection uses the full catalog name after a partial search', () => {
  const result = mapDependencySelection({ mod_id: 'Uni', mod_title: 'Uni', version_range: '', required: true }, { id: 'mod_unisync', title: 'Unisync' } as any, false);
  assert.equal(result.mod_id, 'Unisync');
  assert.equal(result.mod_title, 'Unisync');
  assert.equal(result.linked_mod_id, 'mod_unisync');
});
