// Web 站点的 i18n 词典：`export const messages: Record<Lang, Record<string, string>>`。
//
// 新增一条文案：
//   1. 在 zh 与 en 两个对象里各加一行，键完全相同（测试会拦住单边缺键/单边空值）。
//   2. 键名用「名字空间.语义」的点分形式，全小写 camelCase：
//        header.catalog            名字空间 = 组件/页面名
//        catalog.searchPlaceholder 页面级 + 具体控件
//        common.save               跨页面复用的动词/按钮
//   3. 需要插值时写 `{name}`，调用方传 `t('key', { name })`；不要用 + 拼字符串。
//   4. 组件里只写 `t('...')`，永远不要在组件里再写一份中文字面量兜底。
//   5. 模组/标签这类服务端下发的多语言文本走 `resolve()`，不进这里。
//
// 其他 agent 请按自己的名字空间追加（author.* / admin.* / reviewer.* / catalog.*），
// 不要改动别人已有的键值。

import type { Lang } from './types';

// 每个语言一个文件，避免多人（多 agent）同时编辑同一文件产生冲突。
// 这里只做汇总，新增语言时在 messages/ 下放一个文件并在下表的 import/展开处补一行。
import { zh } from './messages/zh';
import { en } from './messages/en';

export const messages: Record<Lang, Record<string, string>> = { zh, en };
