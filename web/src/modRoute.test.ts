import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG_PATH,
  historyActionFor,
  isOwnModDetailEntry,
  modDetailHistoryState,
  modIDFromLocation,
  pathForMod,
} from './modRoute.js';

const MOD = 'mod_abc123';

// 地址是详情页能否被分享、能否被外部打开的唯一依据，所以这里锁两类结论：
// 哪些地址算「打开了详情」，以及状态变化后该往历史里压/退什么。

test('详情地址能取出 mod id，其余地址一律 null', () => {
  assert.equal(modIDFromLocation({ pathname: `/mod/${MOD}` }), MOD);
  assert.equal(modIDFromLocation({ pathname: `/mod/${MOD}/` }), MOD);
  assert.equal(modIDFromLocation({ pathname: '/' }), null);
  assert.equal(modIDFromLocation({ pathname: '' }), null);
  assert.equal(modIDFromLocation({ pathname: `/mods/${MOD}` }), null);
  assert.equal(modIDFromLocation({ pathname: '/mod/' }), null);
  assert.equal(modIDFromLocation({ pathname: `/mod/${MOD}/files` }), null);
  assert.equal(modIDFromLocation({ pathname: '/mod/bad id' }), null);
  assert.equal(modIDFromLocation(null), null);
});

test('打开详情压一条带标记的新历史，因此「后退」等于关掉详情', () => {
  assert.equal(pathForMod(MOD), `/mod/${MOD}`);
  assert.deepEqual(historyActionFor(MOD, { pathname: '/' }), {
    kind: 'push',
    path: `/mod/${MOD}`,
    state: modDetailHistoryState(MOD),
  });
  assert.deepEqual(historyActionFor(MOD, { pathname: '/author' }), {
    kind: 'push',
    path: `/mod/${MOD}`,
    state: modDetailHistoryState(MOD),
  });
});

test('已经在同一个详情地址时不重复压历史', () => {
  assert.deepEqual(historyActionFor(MOD, { pathname: `/mod/${MOD}` }), { kind: 'none' });
  assert.deepEqual(historyActionFor(MOD, { pathname: `/mod/${MOD}/` }), { kind: 'none' });
});

test('关闭我们自己压出来的详情用 back，别在历史里多留一条同样的地址', () => {
  // 留在历史里的话，「后退」会把用户刚关掉的详情重新打开。
  assert.deepEqual(historyActionFor(null, { pathname: `/mod/${MOD}`, state: modDetailHistoryState(MOD) }), {
    kind: 'back',
  });
});

test('关闭用户直接用链接落地的那条详情用 replace，避免把他带出站点', () => {
  // 分享链接直接进站：这条历史是浏览器给的，下面没有我们能退回去的目录页。
  assert.deepEqual(historyActionFor(null, { pathname: `/mod/${MOD}`, state: null }), {
    kind: 'replace',
    path: CATALOG_PATH,
  });
  assert.deepEqual(historyActionFor(null, { pathname: `/mod/${MOD}` }), {
    kind: 'replace',
    path: CATALOG_PATH,
  });
});

test('当前地址不是详情时不动历史', () => {
  assert.deepEqual(historyActionFor(null, { pathname: '/' }), { kind: 'none' });
  assert.deepEqual(historyActionFor(null, { pathname: '/author' }), { kind: 'none' });
});

test('只认带 modDetail 标记的历史状态，别把别的写法当成自己的', () => {
  assert.equal(isOwnModDetailEntry(modDetailHistoryState(MOD)), true);
  assert.equal(isOwnModDetailEntry(null), false);
  assert.equal(isOwnModDetailEntry(undefined), false);
  assert.equal(isOwnModDetailEntry({}), false);
  assert.equal(isOwnModDetailEntry({ other: MOD }), false);
});
