import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SITE_URL,
  MOD_LINK_SCHEME,
  isModID,
  isModLink,
  modDeepLink,
  modIDFromLink,
  modLinkPath,
  modShareURL,
} from './mod-link.js';

// 两种链接形状是这条功能唯一的对外契约：Web 地址、剪贴板、系统调起都必须
// 认同一组字符串，否则「复制出去的东西」和「能被识别的东西」会各自漂移。

test('分享链接是可直接粘贴到浏览器的路径式 URL', () => {
  assert.equal(modShareURL('mod_abc123'), `${DEFAULT_SITE_URL}/mod/mod_abc123`);
  assert.equal(modShareURL('mod_abc123', 'https://staging.example/'), 'https://staging.example/mod/mod_abc123');
  assert.equal(modShareURL('mod_abc123', 'https://staging.example///'), 'https://staging.example/mod/mod_abc123');
});

test('分享链接与深链能被自己解析回来', () => {
  assert.equal(modIDFromLink(modShareURL('mod_abc123')), 'mod_abc123');
  assert.equal(modIDFromLink(modDeepLink('mod_abc123')), 'mod_abc123');
  assert.equal(modDeepLink('mod_abc123'), `${MOD_LINK_SCHEME}://mod/mod_abc123`);
  assert.equal(modLinkPath('mod_abc123'), '/mod/mod_abc123');
});

test('深链接受大小写不同的协议与 host，结尾斜杠与查询串不影响 id', () => {
  assert.equal(modIDFromLink('REZEHUB://MOD/mod_abc123'), 'mod_abc123');
  assert.equal(modIDFromLink('rezehub://mod/mod_abc123/'), 'mod_abc123');
  assert.equal(modIDFromLink('rezehub://mod/mod_abc123?from=browser#top'), 'mod_abc123');
  assert.equal(modIDFromLink('  rezehub://mod/mod_abc123  '), 'mod_abc123');
});

test('任意站点的 /mod/<id> 都算站内链接', () => {
  // 客户端可能指向测试服务器，origin 写死会让那些实例分享出来的链接认不出来。
  assert.equal(modIDFromLink('https://rezehub.0721play.icu/mod/mod_abc123'), 'mod_abc123');
  assert.equal(modIDFromLink('http://100.72.137.92:8080/mod/mod_abc123'), 'mod_abc123');
  assert.equal(modIDFromLink('https://example.com/mod/mod_abc123/?x=1'), 'mod_abc123');
});

test('不是站内链接的形状一律返回 null', () => {
  for (const raw of [
    '',
    '   ',
    null,
    undefined,
    'plain text',
    'mod_abc123',
    'https://rezehub.0721play.icu/',
    'https://rezehub.0721play.icu/mods/mod_abc123',
    'https://rezehub.0721play.icu/mod/',
    'https://rezehub.0721play.icu/mod/mod_abc123/extra',
    'maica://mod/mod_abc123',
    'rezehub://user/mod_abc123',
    'rezehub://mod/',
    'ftp://rezehub.0721play.icu/mod/mod_abc123',
  ]) {
    assert.equal(modIDFromLink(raw as string), null, `不应解析: ${String(raw)}`);
    assert.equal(isModLink(raw as string), false, `不应识别: ${String(raw)}`);
  }
});

test('非法 mod_id（含空白、特殊字符、超长）被拒绝', () => {
  assert.equal(modIDFromLink('https://example.com/mod/mod%20abc'), null);
  assert.equal(modIDFromLink('https://example.com/mod/模组abc'), null);
  assert.equal(modIDFromLink(`https://example.com/mod/${'a'.repeat(129)}`), null);
  assert.equal(isModID('mod_abc123'), true);
  assert.equal(isModID('a'.repeat(129)), false);
  assert.equal(isModID(''), false);
  assert.equal(isModID(123), false);
});

test('分享链接里的 id 会被按 URL 规则编码，解析回来仍是同一个 id', () => {
  // encodeURIComponent 只对 id 里允许的字符集之外的字符生效，合法 id 原样输出。
  assert.equal(modShareURL('mod_ab-c123'), `${DEFAULT_SITE_URL}/mod/mod_ab-c123`);
  assert.equal(modIDFromLink(modShareURL('mod_ab-c123')), 'mod_ab-c123');
});
