import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadInstalledFiles } from './installedFiles';
import type { InstalledItem } from './types/client';

const item = { mod_id: 'real-mod', is_managed: true, managed_operation_id: 'operation' } as InstalledItem;
test('managed files use real receipt paths, sizes, hashes and drift', async () => {
  const files = await loadInstalledFiles(item, {
    list: async (installationID, modID) => {
      assert.equal(installationID, 'operation');
      assert.equal(modID, 'real-mod');
      return { files: [{ path: 'real.rpy', size_bytes: 23, sha256: 'disk-hash', active: true, drifted: true }] };
    }, scan: async () => [],
  });
  assert.deepEqual(files, [{ path: 'real.rpy', size_bytes: 23, sha256: 'disk-hash', status: 'modified' }]);
});
test('overridden files are not labeled matching', async () => {
  const files = await loadInstalledFiles(item, {
    list: async () => ({ files: [{ path: 'shared.rpy', size_bytes: 10, sha256: 'hash', active: false, drifted: false }] }),
    scan: async () => [],
  });
  assert.equal(files[0].status, 'overridden');
});
test('unmanaged files use fresh scan sizes and hashes without claiming integrity', async () => {
  const files = await loadInstalledFiles({ ...item, is_managed: false, submod_dir_name: 'local' }, {
    list: async () => { throw new Error('unexpected manifest query'); },
    scan: async () => [{ directory: 'local', files: [{ path: 'local/script.rpy', size: 42, sha256: 'disk-hash' }] }],
  });
  assert.deepEqual(files, [{ path: 'local/script.rpy', size_bytes: 42, sha256: 'disk-hash', status: 'unmanaged' }]);
});
test('errors and missing results never fall back to preview data', async () => {
  await assert.rejects(loadInstalledFiles(item, {
    list: async () => { throw new Error('manifest_corrupt'); }, scan: async () => [],
  }), /manifest_corrupt/);
  await assert.rejects(loadInstalledFiles(item, { list: async () => null, scan: async () => [] }), /清单/);
  await assert.rejects(loadInstalledFiles({ ...item, is_managed: false }, {
    list: async () => null, scan: async () => [],
  }), /未找到/);
});
