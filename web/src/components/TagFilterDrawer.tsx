import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m } from './Motion';
import { drawerVariants, overlayVariants } from '../../../ui/motion-presets';
import { Check, ChevronDown, ChevronRight, Minus, X } from 'lucide-react';
import {
  activeTagFilterCount,
  describeTagFilterLocalized,
  isTagRowExpanded,
  rowActiveCount,
  tagFilterDisplayNames,
  type TagFilterEntry,
  type TagFilterRow,
  type TagFilterStates,
  type TagGroupCollapse,
} from '../../../ui/tag-filter';
import { resolveTagName } from '../../../ui/tags-api';
import { useI18n } from '../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 抽屉里渲染的行：目录顺序在前，目录外的历史标签追加在后。 */
  rows: TagFilterRow[];
  states: TagFilterStates;
  onToggle: (name: string) => void;
  onClear: () => void;
  /** 目录读取中 / 读取失败：此时不渲染标签，只说明状态（目录外的历史标签仍可选）。 */
  loading?: boolean;
  error?: string | null;
}

/**
 * 目录标签筛选抽屉（Web 浅色版）。
 *
 * 标签默认不选；点一次为「包含此标签」，再点一次为「排除此标签」，第三次回到未选。
 * 每一项按聊天列表的样子排：第一行标签名，第二行小号灰色描述；子标签默认折叠，
 * 没有子标签的主标签不出现折叠按钮。
 * 每个标签的可访问名都带当前状态与描述（`工具（包含）：绘图与脚本类工具`），
 * 键盘与读屏不必靠颜色区分。三态语义与判定都在 `ui/tag-filter.ts`，客户端用的是同一份。
 */
export const TagFilterDrawer: React.FC<Props> = ({
  open,
  onClose,
  rows,
  states,
  onToggle,
  onClear,
  loading = false,
  error = null,
}) => {
  const { t, lang, resolve } = useI18n();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [collapse, setCollapse] = useState<TagGroupCollapse>({});
  const active = activeTagFilterCount(states);
  // 标签名走显示名（管理员可配英文），筛选状态仍然只认存储名。
  const displayNames = useMemo(() => tagFilterDisplayNames(rows), [rows]);

  // Esc 关闭：抽屉是浮层，键盘用户必须能退出，不能只靠点遮罩。
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // 打开后焦点落在关闭按钮上，读屏与键盘从抽屉开始，而不是留在背后的页面上。
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus?.();
  }, [open]);

  const tagButton = (entry: TagFilterEntry, main: boolean, stale: boolean) => {
    const state = states[entry.name];
    const label = resolveTagName(entry.name, displayNames, lang);
    const description = resolve(entry.description);
    const stateText = state === 'include'
      ? t('tagFilter.stateInclude')
      : state === 'exclude'
        ? t('tagFilter.stateExclude')
        : '';
    // 可访问名把「名字 + 状态 + 描述」凑成一句；只有一句话对读屏才有意义，
    // 三个片段各读一遍反而听不出谁在描述谁。
    // 三种组合各自成句：有描述就给描述，没有描述就只说名字和状态，
    // 都没有时退回名字本身——不拼出「名字（包含）：」这种带空冒号的残句。
    const ariaLabel = stateText && description
      ? t('tagFilter.ariaLabel', { name: label, state: stateText, description })
      : description
        ? t('tagFilter.ariaLabelPlain', { name: label, description })
        : stateText
          ? t('tagFilter.ariaLabelState', { name: label, state: stateText })
          : label;
    return (
      <button
        key={entry.name}
        type="button"
        data-tag={entry.name}
        data-tag-state={state ?? 'off'}
        aria-label={ariaLabel}
        aria-pressed={state !== undefined}
        title={stale ? t('tagFilter.staleHint') : ariaLabel}
        onClick={() => onToggle(entry.name)}
        className={[
          'w-full text-left rounded border px-2 py-1 transition-colors cursor-pointer',
          main ? 'font-medium' : '',
          stale ? 'border-dashed' : '',
          state === 'include'
            ? 'border-emerald-700 bg-emerald-700 text-white'
            : state === 'exclude'
              ? 'border-rose-300 bg-rose-50 text-rose-700 hover:border-rose-400'
              : 'border-neutral-200 bg-white text-neutral-800 hover:border-emerald-600',
        ]
          .join(' ')
          .trim()}
      >
        <span className="flex items-center gap-1 text-[11px]">
          {state === 'include' ? (
            <Check className="w-3 h-3 shrink-0" aria-hidden="true" />
          ) : state === 'exclude' ? (
            <Minus className="w-3 h-3 shrink-0" aria-hidden="true" />
          ) : null}
          <span className="truncate">{t('tagFilter.label', { name: label })}</span>
        </span>
        {description ? (
          <span
            className={`block text-[10px] leading-snug mt-0.5 ${
              state === 'include' ? 'text-emerald-100' : state === 'exclude' ? 'text-rose-500' : 'text-neutral-500'
            }`}
          >
            {description}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <AnimatePresence>
      {open && (
        <m.div
          className="fixed inset-0 z-50 flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label={t('tagFilter.title')}
          data-testid="tag-filter-drawer"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 1 }}
        >
      {/* 遮罩本身可点关闭；用 button 而不是 div，键盘用户也有明确的退出动作。 */}
          {/* 遮罩本身可点关闭；用 button 而不是 div，键盘用户也有明确的退出动作。 */}
          <m.button
            type="button"
            aria-label={t('tagFilter.close')}
            tabIndex={-1}
            onClick={onClose}
            variants={overlayVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="absolute inset-0 bg-black/40 cursor-default active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          />
          <m.aside
            variants={drawerVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="relative h-full w-full max-w-sm sm:max-w-md border-l border-neutral-200 bg-white shadow-xl flex flex-col pt-[env(safe-area-inset-top,0px)] pr-[env(safe-area-inset-right,0px)] pb-[env(safe-area-inset-bottom,0px)]"
          >
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-neutral-200">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-neutral-900">{t('tagFilter.title')}</h2>
            <p className="text-[11px] mt-0.5 text-neutral-500">
              {t('tagFilter.howItWorks')}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('tagFilter.close')}
            className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 transition-colors active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

          <div className="flex-1 overflow-y-auto overscroll-y-contain px-4 py-3 space-y-3">
          {active > 0 ? (
            <p className="text-[11px] text-neutral-500" data-testid="tag-filter-summary">
              {describeTagFilterLocalized(rows, states, lang, t)}
            </p>
          ) : null}

          {loading ? <p className="text-[11px] text-neutral-500">{t('tagFilter.loading')}</p> : null}
          {error ? (
            <p role="alert" className="text-[11px] text-rose-600">
              {error}
            </p>
          ) : null}
          {rows.length === 0 && !loading && !error ? (
            <p className="text-[11px] text-neutral-500">{t('tagFilter.empty')}</p>
          ) : null}

          {rows.map((row) => {
            const expanded = isTagRowExpanded(collapse, row);
            const groupActive = rowActiveCount(row, states);
            return (
              <div
                key={row.main.name}
                data-testid={`tag-filter-row-${row.main.name}`}
                className="border-b border-neutral-100 pb-2 last:border-b-0 last:pb-0"
              >
                <div className="flex items-start gap-1">
                  {/* 折叠按钮只负责展开，不改变筛选状态：两个动作必须分开，否则想展开的人会顺手改了筛选。 */}
                  {row.children.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setCollapse((current) => ({ ...current, [row.main.name]: !expanded }))}
                      aria-expanded={expanded}
                      aria-label={expanded
                        ? t('tagFilter.collapse', { name: resolveTagName(row.main.name, displayNames, lang) })
                        : t('tagFilter.expand', { name: resolveTagName(row.main.name, displayNames, lang), count: row.children.length })}
                      data-testid={`tag-filter-toggle-${row.main.name}`}
                      className="mt-1 p-0.5 rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                    >
                      {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </button>
                  ) : (
                    <span className="w-[1.125rem] shrink-0" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    {tagButton(row.main, true, row.stale)}
                  </div>
                  {/* 收起时也要能看出这一组里有生效的筛选，否则用户会以为筛选没生效。 */}
                  {!expanded && groupActive > 0 ? (
                    <span
                      data-testid={`tag-filter-group-active-${row.main.name}`}
                      className="mt-1 shrink-0 rounded-full bg-emerald-100 px-1.5 text-[10px] tabular-nums text-emerald-800"
                    >
                      {groupActive}
                    </span>
                  ) : null}
                </div>
                {expanded && row.children.length > 0 ? (
                  <div
                    className="ml-[1.375rem] mt-1 pl-2 border-l border-neutral-200 space-y-1"
                    data-testid={`tag-filter-children-${row.main.name}`}
                  >
                    {row.children.map((child) => tagButton(child, false, row.stale))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="px-4 py-3 border-t border-neutral-200 flex items-center justify-between gap-3">
          <span className="text-[11px] text-neutral-500 tabular-nums" data-testid="tag-filter-count">
            {active === 0 ? t('tagFilter.noneActive') : t('tagFilter.activeCount', { count: active })}
          </span>
          <button
            type="button"
            onClick={onClear}
            disabled={active === 0}
            className="px-2.5 py-1 text-[11px] font-medium rounded border border-neutral-300 text-neutral-600 hover:text-neutral-900 hover:border-neutral-400 transition-colors disabled:cursor-not-allowed disabled:opacity-40 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            {t('tagFilter.clearAll')}
          </button>
        </div>
          </m.aside>
        </m.div>
      )}
    </AnimatePresence>
  );
};
