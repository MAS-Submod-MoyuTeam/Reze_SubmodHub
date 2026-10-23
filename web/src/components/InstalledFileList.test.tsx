import React from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  InstalledFileList,
  getFileExtension,
} from './InstalledFileList';
import { InstalledMod, InstalledFileList as InstalledFileListDTO } from '../types/submodhub';
import { MOCK_INSTALLED_FILES } from '../data/mockData';

const sampleMod: InstalledMod = {
  id: 'inst_extra',
  mod_id: 'mod_extra_everything',
  title: 'Extra Everything',
  version: '1.2.0',
  category: 'submod',
  is_managed: true,
  installed_at: '2026-09-21T10:00:00Z',
  priority: 20,
};

test('getFileExtension extracts file extensions correctly', () => {
  assert.equal(getFileExtension('game/submods/core.rpy'), '.rpy');
  assert.equal(getFileExtension('assets/image.PNG'), '.PNG');
  assert.equal(getFileExtension('no_ext'), '');
});

test('returns null when mod is null', () => {
  const markup = renderToStaticMarkup(<InstalledFileList mod={null} onClose={() => {}} />);
  assert.equal(markup, '');
});

test('renders installed files with summary counts and file paths', () => {
  const mockData: InstalledFileListDTO = MOCK_INSTALLED_FILES['mod_extra_everything'];
  const markup = renderToStaticMarkup(
    <InstalledFileList mod={sampleMod} onClose={() => {}} initialData={mockData} />
  );

  // Mod title and tag
  assert.match(markup, /Extra Everything/);
  assert.match(markup, /RezeHub 托管/);

  // Summary statistics
  assert.match(markup, /登记文件总数/);
  assert.match(markup, />4</); // total 4 files
  assert.match(markup, /当前生效中/);
  assert.match(markup, />3</); // 3 active
  assert.match(markup, /外部修改 \(漂移\)/);
  assert.match(markup, />1</); // 1 drifted

  // Drift alert banner
  assert.match(markup, /安全提示：检测到 1 个文件存在外部哈希漂移/);

  // Rendered file paths
  assert.match(markup, /ee_core\.rpy/);
  assert.match(markup, /ee_dialogue\.rpy/);
  assert.match(markup, /overridden_helper\.rpy/);
  assert.match(markup, /user_modified_config\.rpy/);

  // Overridden and Drifted labels
  assert.match(markup, /外部修改/);
  assert.match(markup, /生效中/);
  assert.match(markup, /被覆盖/);
});

test('renders error state when error is provided', () => {
  const markup = renderToStaticMarkup(
    <InstalledFileList
      mod={sampleMod}
      onClose={() => {}}
      initialError={{ message: 'MAS 根目录访问权限已失效，请重新授权存储目录', code: 'permission_lost' }}
    />
  );

  assert.match(markup, /查询失败/);
  assert.match(markup, /MAS 根目录访问权限已失效/);
  assert.match(markup, /permission_lost/);
  assert.match(markup, /重试加载/);
});

test('renders unmanaged mod title and label correctly', () => {
  const unmanagedMod: InstalledMod = {
    id: 'inst_unmanaged',
    mod_id: 'unmanaged_community_dialogue',
    title: '未托管手动放置的对话脚本',
    version: '未知',
    category: 'submod',
    is_managed: false,
    installed_at: '2026-10-01T00:00:00Z',
    priority: 0,
  };
  const mockData: InstalledFileListDTO = MOCK_INSTALLED_FILES['unmanaged_community_dialogue'];

  const markup = renderToStaticMarkup(
    <InstalledFileList mod={unmanagedMod} onClose={() => {}} initialData={mockData} />
  );

  assert.match(markup, /未托管检测文件/);
  assert.match(markup, /custom_topic_fluff\.rpy/);
});
