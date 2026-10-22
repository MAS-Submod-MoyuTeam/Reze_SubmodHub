import React from 'react';
import type { TagGroup } from '../../../ui/tags-api';
import { MAX_MOD_TAGS, groupHasSelection, toggleTagSelection } from './tagSelection';

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
 */
export const TagPicker: React.FC<Props> = ({ groups, value, onChange, max = MAX_MOD_TAGS, disabled = false, loading = false, error = null }) => {
  const atCap = value.length >= max;
  const chip = (name: string, main: boolean) => {
    const selected = main ? groupHasSelection(groups, value, name) : value.includes(name);
    const blocked = !selected && atCap;
    return (
      <button
        key={name}
        type="button"
        role="button"
        data-tag={name}
        aria-pressed={selected}
        disabled={disabled || blocked}
        onClick={() => onChange(toggleTagSelection(groups, value, name, max))}
        className={[
          'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
          main ? 'font-medium' : '',
          selected ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-neutral-300 bg-white text-neutral-700 hover:border-emerald-600',
          blocked || disabled ? 'cursor-not-allowed opacity-40' : '',
        ].join(' ').trim()}
      >
        #{name}
      </button>
    );
  };

  return (
    <div data-testid="tag-picker" className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label className="block font-medium text-neutral-700">标签</label>
        <span className={`text-[11px] tabular-nums ${atCap ? 'text-amber-600' : 'text-neutral-500'}`}>
          已选 {value.length}/{max}
        </span>
      </div>
      {loading ? (
        <p className="text-[11px] text-neutral-500">正在读取标签目录…</p>
      ) : error ? (
        <p role="alert" className="text-[11px] text-rose-600">{error}</p>
      ) : groups.length === 0 ? (
        <p role="alert" className="text-[11px] text-rose-600">标签目录为空，请联系管理员配置后重试。</p>
      ) : (
        <div className="space-y-1.5 rounded border border-neutral-200 bg-neutral-50/60 p-2">
          {groups.map((group) => (
            <div key={group.name} className="flex flex-wrap items-center gap-1.5">
              {chip(group.name, true)}
              {group.children?.length ? (
                <div className="flex flex-wrap items-center gap-1.5 border-l border-neutral-300 pl-2">
                  {group.children.map((child) => chip(child, false))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-neutral-500">
        {value.length === 0 ? '至少选择一个标签。' : ''}标签由管理员维护，不能自行新增。
      </p>
    </div>
  );
};
