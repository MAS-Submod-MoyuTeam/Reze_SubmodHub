import React from 'react';
import { LANG_LABELS, SUPPORTED_LANGS, useI18n, type Lang } from '../i18n';

interface Props {
  className?: string;
}

/**
 * 语言切换器（下拉框）。
 *
 * 用原生 `<select>` 而不是自绘按钮组：键盘操作、读屏播报、移动端选择器
 * 都由系统负责，不必自己维护 radiogroup 的方向键漫游。
 *
 * 视觉上要跟顶栏其他按钮对齐，所以做了三件事：
 * - `appearance-none` 关掉系统原生外观，否则各平台画出来的箭头/内边距都不一样；
 * - 尺寸沿用顶栏按钮的 `py-1.5 text-xs rounded`，不另设固定高度；
 * - 箭头自己用图标画在右侧，`pr-7` 给它留位。
 *
 * 左侧还有一个地球图标：只用语言名当提示时，用户得先读懂当前语言才知道
 * 这是个切换入口；地球图标是跨语言通用的「语言」符号，`title`/`aria-label`
 * 同时给出文字说明，两种线索互为补充。图标与箭头都 `pointer-events-none`，
 * 点在它们身上等于点在 select 上。
 */
export const LanguageSwitcher: React.FC<Props> = ({ className = '' }) => {
  const { lang, setLang, t } = useI18n();
  const label = t('common.switchLanguage');

  return (
    <div className={`relative inline-flex items-center ${className}`.trim()}>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-neutral-500"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
        <path d="M2 12h20" />
      </svg>
      <select
        value={lang}
        onChange={(event) => setLang(event.target.value as Lang)}
        aria-label={label}
        title={label}
        data-testid="language-switcher"
        className="cursor-pointer appearance-none rounded border border-neutral-200 bg-white py-1.5 pl-7 pr-7 text-xs font-medium text-neutral-800 outline-none transition-colors hover:border-neutral-300 hover:bg-neutral-50 active:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
      >
        {SUPPORTED_LANGS.map((option: Lang) => (
          <option key={option} value={option} lang={option === 'zh' ? 'zh-CN' : 'en'}>
            {LANG_LABELS[option]}
          </option>
        ))}
      </select>
      {/* 指针穿透到下面的 select，点箭头也等于点下拉框。 */}
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute right-1.5 h-3 w-3 text-neutral-500"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
};
