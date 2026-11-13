/**
 * 文案合并点：两端各自维护一份，缺键时以中文为准（见 translate.ts）。
 */
import { zh } from './messages/zh';
import { en } from './messages/en';
import type { Lang } from './types';

export const messages: Record<Lang, Record<string, string>> = { zh, en };
