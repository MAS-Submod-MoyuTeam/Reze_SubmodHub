import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorModPublished as published } from './submission-api';

test('an unpublished mod stays hidden when its retained latest version is published', () => {
  assert.equal(published({ id: 'old-maica', latest_version_id: 'v1', unpublished: true }, [
    { id: 'v1', mod_id: 'old-maica', state: 'published' },
  ]), false);
});

test('only a published latest version belonging to the mod makes it public', () => {
  const mod = { id: 'maica', latest_version_id: 'v1' };
  assert.equal(published(mod, [{ id: 'v1', mod_id: 'maica', state: 'published' }]), true);
  assert.equal(published(mod, [{ id: 'v1', mod_id: 'maica', state: 'scanning' }]), false);
  assert.equal(published(mod, [{ id: 'v1', mod_id: 'other', state: 'published' }]), false);
  assert.equal(published({ id: 'maica' }, []), false);
});
