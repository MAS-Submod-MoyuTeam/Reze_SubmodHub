import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { InstalledView } from './InstalledView';
import { mountTestDom } from './testDom';
import type { Spritepack } from '../wails';

const basePack: Spritepack = {
  file: 'pack.json',
  name: 'Test Pack',
  author: '',
  kind: '服装',
  group: '',
  giftname: 'testgift',
  complete: true,
  missing: [],
  preview: '',
};

function view(spritepacks: Spritepack[], onDeleteSpritepack: (file: string) => Promise<void>) {
  return (
    <InstalledView
      installedMods={[]}
      spritepacks={spritepacks}
      hasValidInstance
      modsStatus="success"
      modsError={null}
      isModsInitialLoading={false}
      isModsRefreshing={false}
      spritepacksStatus="success"
      spritepacksError={null}
      isSpritepacksInitialLoading={false}
      isSpritepacksRefreshing={false}
      isVerifying={false}
      initialSubTab="spritepacks"
      onRefreshInstalled={() => {}}
      onRefreshSpritepacks={() => {}}
      onCreateSpriteGift={async () => 'gift_file'}
      onDeleteSpritepack={onDeleteSpritepack}
      onStartUninstallPlan={() => {}}
      onStartRepairPlan={() => {}}
      onStartUpdatePlan={() => {}}
      onOpenAdoptModal={() => {}}
      onInspectFiles={() => {}}
      onCheckAllUpdates={() => {}}
      onVerifyIntegrity={() => {}}
    />
  );
}

test('InstalledView shows gift state only when the save gives a definite answer', async () => {
  const dom = mountTestDom('<div id="root"></div>');
  try {
    await dom.paint(view([
      { ...basePack, file: 'unlocked.json', gift_unlocked: true },
      { ...basePack, file: 'pending.json', name: 'Pending Pack', gift_unlocked: false },
      { ...basePack, file: 'unknown.json', name: 'Unknown Pack' },
    ], async () => {}));
    const text = dom.document.getElementById('root')!.textContent || '';
    assert.match(text, /已赠送（已解锁）/);
    assert.match(text, /未赠送/);
    assert.equal(dom.document.querySelectorAll('[role="status"]').length, 2);
  } finally {
    await dom.close();
  }
});

test('InstalledView delete dialog can cancel or confirm the operation', async () => {
  const dom = mountTestDom('<div id="root"></div>');
  const removed: string[] = [];
  try {
    await dom.paint(view([basePack], async (file) => { removed.push(file); }));
    const removeButton = dom.document.querySelector<HTMLButtonElement>('button[aria-label="删除 Test Pack"]');
    assert.ok(removeButton);
    await act(async () => removeButton.click());
    const dialog = dom.document.querySelector('[role="alertdialog"]');
    assert.ok(dialog, 'delete action should open an in-app alert dialog');
    const cancel = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === '取消');
    assert.ok(cancel);
    await act(async () => cancel.click());
    assert.deepEqual(removed, []);

    await act(async () => removeButton.click());
    const confirm = [...dom.document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find((button) => button.textContent?.trim() === '确认删除');
    assert.ok(confirm);
    await act(async () => confirm.click());
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(removed, ['pack.json']);
  } finally {
    await dom.close();
  }
});
