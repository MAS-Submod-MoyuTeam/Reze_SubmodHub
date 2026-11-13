import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TRANSFER_BYTES,
  parseSettingsTransfer,
  summarizeSettingsTransfer,
} from './settings-transfer.js';
import type { SettingsTransferDocument } from './settings-api.js';

const validDocument = () => ({
  format: 'submodhub-settings',
  version: 1,
  exported_at: '2026-11-12T02:15:32Z',
  settings: {
    github_proxy_template: 'https://proxy.example/{url}',
    github_sync_max_age: '4h30m0s',
    tag_catalog: [
      { name: '工具', children: [{ name: '绘图' }, { name: '诊断' }] },
      { name: '音乐' },
    ],
  },
  download_nodes: [
    { id: 'cloud-one', name: 'Cloud', type: 'cloudreve', credential_configured: true },
  ],
});

test('accepts a document the server itself produced', () => {
  const text = JSON.stringify(validDocument());
  const parsed = parseSettingsTransfer(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.document.format, 'submodhub-settings');
  assert.equal(parsed.ok && parsed.document.settings.tag_catalog?.length, 2);
});

test('rejects anything that is not this settings document', () => {
  const cases: Array<[string, string, string]> = [
    ['not json at all', '{', 'invalid_json'],
    ['a bare array', '[]', 'not_settings_document'],
    ['some other JSON file', '{"hello":"world"}', 'not_settings_document'],
    ['a catalog export', '{"groups":[]}', 'not_settings_document'],
    [
      'a newer document version',
      JSON.stringify({ ...validDocument(), version: 2 }),
      'unsupported_version',
    ],
    [
      'a document without a tag catalog',
      JSON.stringify({ format: 'submodhub-settings', version: 1, settings: {} }),
      'invalid_shape',
    ],
    [
      'a document whose settings is not an object',
      JSON.stringify({ format: 'submodhub-settings', version: 1, settings: [] }),
      'invalid_shape',
    ],
  ];
  for (const [label, text, issue] of cases) {
    const parsed = parseSettingsTransfer(text);
    assert.deepEqual(parsed, { ok: false, issue }, label);
  }
});

test('refuses a file larger than the server body cap before parsing it', () => {
  const oversized = 'x'.repeat(MAX_TRANSFER_BYTES + 1);
  assert.deepEqual(parseSettingsTransfer(oversized), { ok: false, issue: 'file_too_large' });
  // A file that only claims to be too large is rejected on the reported size,
  // which is what the file picker actually knows before reading anything.
  assert.deepEqual(parseSettingsTransfer('{}', MAX_TRANSFER_BYTES + 1), {
    ok: false,
    issue: 'file_too_large',
  });
  assert.equal(parseSettingsTransfer('{"format":"submodhub-settings","version":1,"settings":[]}', MAX_TRANSFER_BYTES).ok, false);
});

test('summarizes what an import will replace', () => {
  const doc = parseSettingsTransfer(JSON.stringify(validDocument()));
  assert.equal(doc.ok, true);
  if (!doc.ok) return;
  assert.deepEqual(summarizeSettingsTransfer(doc.document), {
    tagGroupCount: 2,
    tagChildCount: 2,
    nodeCount: 1,
    nodesUnchanged: false,
    includesToken: false,
    proxy: 'https://proxy.example/{url}',
    syncMaxAge: '4h30m0s',
  });
});

test('an absent node list means "leave the nodes alone", an empty one means "delete them"', () => {
  const withoutNodes = validDocument();
  delete (withoutNodes as { download_nodes?: unknown }).download_nodes;
  const absent = parseSettingsTransfer(JSON.stringify(withoutNodes));
  assert.equal(absent.ok, true);
  if (!absent.ok) return;
  const absentSummary = summarizeSettingsTransfer(absent.document);
  assert.equal(absentSummary.nodesUnchanged, true);
  assert.equal(absentSummary.nodeCount, 0);

  const empty = parseSettingsTransfer(JSON.stringify({ ...validDocument(), download_nodes: [] }));
  assert.equal(empty.ok, true);
  if (!empty.ok) return;
  const emptySummary = summarizeSettingsTransfer(empty.document);
  assert.equal(emptySummary.nodesUnchanged, false);
  assert.equal(emptySummary.nodeCount, 0);

  const nulled = parseSettingsTransfer(JSON.stringify({ ...validDocument(), download_nodes: null }));
  assert.equal(nulled.ok, true);
  if (!nulled.ok) return;
  assert.equal(summarizeSettingsTransfer(nulled.document).nodesUnchanged, true);
});

test('summary reports defaults for a document that omits the optional settings', () => {
  const bare: SettingsTransferDocument = {
    format: 'submodhub-settings',
    version: 1,
    settings: { tag_catalog: [{ name: '工具' }] },
  };
  const summary = summarizeSettingsTransfer(bare);
  assert.equal(summary.proxy, '');
  assert.equal(summary.syncMaxAge, '');
  assert.equal(summary.tagChildCount, 0);
  assert.equal(summary.includesToken, false);
});

test('a token in the document is surfaced, an empty one is not', () => {
  const withToken: SettingsTransferDocument = {
    format: 'submodhub-settings',
    version: 1,
    settings: { tag_catalog: [{ name: '工具' }], github_token: 'ghp_example' },
  };
  assert.equal(summarizeSettingsTransfer(withToken).includesToken, true);
  const cleared: SettingsTransferDocument = {
    ...withToken,
    settings: { ...withToken.settings, github_token: '' },
  };
  assert.equal(summarizeSettingsTransfer(cleared).includesToken, false);
});
