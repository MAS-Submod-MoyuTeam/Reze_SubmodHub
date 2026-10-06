import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canEditVersion, versionFormState } from './versionFormState';

test('editing a draft prefills version, notes, and independent dependency rows', () => {
  const draft = {
    version: '1.2.0',
    release_notes: 'Existing notes',
    dependencies: [{ mod_id: 'Core', mod_title: 'Core', linked_mod_id: 'mod_core', version_range: '>1.0.0', required: true }],
  };
  const form = versionFormState(draft);
  assert.equal(form.version, '1.2.0');
  assert.equal(form.releaseNotes, 'Existing notes');
  assert.deepEqual(form.dependencies, draft.dependencies);
  form.dependencies[0].version_range = '<2.0.0';
  assert.equal(draft.dependencies[0].version_range, '>1.0.0');
});

test('creating a version starts with one empty optional dependency row', () => {
  assert.deepEqual(versionFormState(), {
    version: '',
    releaseNotes: '',
    dependencies: [{ mod_id: '', mod_title: '', version_range: '', required: true }],
  });
});

test('draft and rejected versions use the same editor but published versions do not', () => {
  assert.equal(canEditVersion('draft'), true);
  assert.equal(canEditVersion('rejected'), true);
  assert.equal(canEditVersion('published'), false);
  assert.equal(canEditVersion('ready_for_review'), false);
});
