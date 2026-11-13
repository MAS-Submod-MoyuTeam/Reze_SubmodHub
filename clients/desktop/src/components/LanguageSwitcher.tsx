import React from 'react';
import { LANG_LABELS, SUPPORTED_LANGS, useI18n, type Lang } from '../i18n';

interface Props {
  className?: string;
}

/**
 * 语言切换器（客户端深色主题，下拉框）。
 *
 * 用原生 `<select>`：键盘操作、读屏播报、移动端选择器都由系统负责，
 * 不必自己维护 radiogroup 的方向键漫游。
 *
 * 视觉上要跟标题栏的其他控件对齐，所以：
 * - `appearance-none` 关掉系统原生外观（各平台默认箭头/内边距差异很大）；
 * - 尺寸沿用标题栏控件的高度（h-6 / text-[10px]），不另起一套；
 * - 箭头自己画，`pr-5` 给它留位；深色玻璃底（neutral-800/60）与旁边的
 *   安装目录按钮一致，不引入新的强调色。
 *
 * 左侧带一个地球图标：只用语言名当提示时，用户得先读懂当前语言才知道
 * 这是切换入口；地球是跨语言通用的「语言」符号，配合 `title`/`aria-label`
 * 的文字说明，两种线索互为补充。图标与箭头都 `pointer-events-none`，
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
        className="pointer-events-none absolute left-1.5 h-3 w-3 text-neutral-400"
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
        className="wails-no-drag cursor-pointer appearance-none rounded border border-neutral-700/60 bg-neutral-800/80 py-1 pl-6 pr-5 text-[10px] font-medium leading-none text-neutral-200 outline-none transition-colors hover:border-neutral-600 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
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
        className="pointer-events-none absolute right-1 h-2.5 w-2.5 text-neutral-400"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
};
