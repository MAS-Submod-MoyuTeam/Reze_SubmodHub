import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapServerScanReport } from './scanReport';

test('maps the real upload report into the workbench report', () => {
  const report = mapServerScanReport('ver_1', {
    files: [{ source: 'game/Submods/demo/main.rpy', target: 'Submods/demo/main.rpy', size: 12, sha256: 'abc', class: 'script' }],
    unsupported: ['README.exe'], warnings: ['check file'],
    submods: [{ Source: 'main.rpy', Name: 'Demo', Version: '1.0', Unknown: true }],
    sprites: [], derived: [],
    conflicts: [{ Kind: 'submod_name', Value: 'Demo', First: 'a', Second: 'b' }],
  });
  assert.equal(report.files[0].target_path, 'Submods/demo/main.rpy');
  assert.equal(report.registrations[0].confidence, 'unknown');
  assert.equal(report.resource_stats.total_files, 1);
  assert.equal(report.blockers.length, 1);
});

test('attributes binary warnings to their file without making them blockers', () => {
  const report = mapServerScanReport('ver_binary', {
    files: [{ source: 'game/Submods/demo/helper.dll', target: 'Submods/demo/helper.dll', size: 42, sha256: 'abc123', class: 'binary' }],
    warnings: ['binary content: game/Submods/demo/helper.dll'],
  });
  assert.equal(report.resource_stats.binary_flag, true);
  assert.deepEqual(report.files[0].warnings, ['检测到二进制文件；仅提示，未自动阻断']);
  assert.deepEqual(report.blockers, []);
});

test('maps the lowercase JSON fields emitted by the Go scan API', () => {
  const report = mapServerScanReport('ver_dialogue', {
    submods: [{ source: 'game/Submods/dialogue_pack_head.rpy', author: 'P', name: '话题整合包', version: '1.27.1', unknown: false }],
  });
  assert.deepEqual(report.registrations[0], {
    submod_id: '话题整合包', source_path: 'game/Submods/dialogue_pack_head.rpy', name: '话题整合包', version: '1.27.1', author: 'P', confidence: 'known',
  });
});
