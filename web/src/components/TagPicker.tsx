import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { TagGroup } from '../../../ui/tags-api';
import { resolveTagName, tagChildNames, tagDescriptions, tagDisplayNames } from '../../../ui/tags-api';
import { MAX_MOD_TAGS, groupHasSelection, toggleTagSelection } from './tagSelection';
import { useI18n } from '../i18n';

interface Props {
  groups: TagGroup[];
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
}

/**
 * 标签选择器：只能从管理员维护的目录里多选，没有自由输入。
 * 主标签可单独选中；选中子标签时会自动补上主标签（与服务端规则一致）。
 *
 * 每一项按聊天列表的样子排：第一行标签名，第二行小号灰色描述。
 * 子标签默认折叠——目录一多，全展开会把选择器撑得比整个弹窗还高；
 * 没有子标签的主标签不显示折叠按钮。
 *
 * 名称与描述都是多语言文本：名称走 `resolveTagName`（没有当前语言译文时显示
 * 存储名），描述走 `resolve()` 的回退链。`data-tag` 等属性始终用存储名，
 * 因为提交给服务端的是存储名，不是译文。
 */
export const TagPicker: React.FC<Props> = ({ groups, value, onChange, max = MAX_MOD_TAGS, disabled = false, loading = false, error = null }) => {
  const { t, resolve, lang } = useI18n();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const atCap = value.length >= max;
  const displayNames = useMemo(() => tagDisplayNames(groups), [groups]);
  const descriptions = useMemo(() => tagDescriptions(groups), [groups]);

  const row = (name: string, main: boolean) => {
    const selected = main ? groupHasSelection(groups, value, name) : value.includes(name);
    const blocked = !selected && atCap;
    const label = resolveTagName(name, displayNames, lang);
    const description = resolve(descriptions.get(name));
    return (
      <button
        key={name}
        type="button"
        role="button"
        data-tag={name}
        data-tag-selected={selected ? 'true' : 'false'}
        aria-pressed={selected}
        aria-label={description ? t('tagPicker.rowLabel', { name: label, description }) : label}
        title={description || undefined}
        disabled={disabled || blocked}
        onClick={() => onChange(toggleTagSelection(groups, value, name, max))}
        className={[
          'w-full text-left rounded border px-2 py-1.5 transition-colors',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600',
          main ? 'font-medium' : '',
          selected
            ? 'border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800 active:bg-emerald-900'
            : 'border-neutral-200 bg-white text-neutral-800 hover:border-emerald-600 hover:bg-emerald-50 active:bg-emerald-100',
          blocked || disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer active:brightness-95',
        ].join(' ').trim()}
      >
        <span className="flex items-center gap-1 text-[11px]">
          {selected ? <Check className="w-3 h-3 shrink-0" aria-hidden="true" /> : null}
          <span className="truncate">#{label}</span>
        </span>
        {description ? (
          <span className={`block text-[10px] leading-snug mt-0.5 ${selected ? 'text-emerald-100' : 'text-neutral-500'}`}>
            {description}
          </span>
        ) : null}
      </button>
    );
  };

  return (
    <div data-testid="tag-picker" className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label className="block font-medium text-neutral-700">{t('tagPicker.label')}</label>
        <span className={`text-[11px] tabular-nums ${atCap ? 'text-amber-600' : 'text-neutral-500'}`}>
          {t('tagPicker.selectedOfMax', { count: value.length, max })}
        </span>
      </div>
      {loading ? (
        <p className="text-[11px] text-neutral-500">{t('tagPicker.loading')}</p>
      ) : error ? (
        <p role="alert" className="text-[11px] text-rose-600">{error}</p>
      ) : groups.length === 0 ? (
        <p role="alert" className="text-[11px] text-rose-600">{t('tagPicker.empty')}</p>
      ) : (
        <div className="space-y-1 rounded border border-neutral-200 bg-neutral-50/60 p-1.5 max-h-64 overflow-y-auto">
          {groups.map((group) => {
            const children = tagChildNames(group);
            const isOpen = expanded[group.name] === true;
            const hasChildren = children.length > 0;
            const mainLabel = resolveTagName(group.name, displayNames, lang);
            return (
              <div key={group.name} data-testid={`tag-picker-group-${group.name}`}>
                <div className="flex items-start gap-1">
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={() => setExpanded((current) => ({ ...current, [group.name]: !isOpen }))}
                      aria-expanded={isOpen}
                      aria-label={isOpen
                        ? t('tagPicker.collapseChildren', { name: mainLabel, count: children.length })
                        : t('tagPicker.expandChildren', { name: mainLabel, count: children.length })}
                      data-testid={`tag-picker-toggle-${group.name}`}
                      className="mt-1 p-0.5 rounded text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-700 cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                    >
                      {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                  ) : (
                    <span className="w-4 shrink-0" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    {row(group.name, true)}
                  </div>
                </div>
                {hasChildren && isOpen ? (
                  <div
                    className="ml-4 mt-1 pl-2 border-l border-neutral-200 space-y-1"
                    data-testid={`tag-picker-children-${group.name}`}
                  >
                    {(group.children ?? []).map((child) => row(child.name, false))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-neutral-500">
        {value.length === 0 ? t('tagPicker.atLeastOne') : ''}{t('tagPicker.hint')}
      </p>
    </div>
  );
};
