import React, { useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { TagGroup } from '../../../ui/tags-api';
import { tagChildNames } from '../../../ui/tags-api';
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
 *
 * 每一项按聊天列表的样子排：第一行标签名，第二行小号灰色描述。
 * 子标签默认折叠——目录一多，全展开会把选择器撑得比整个弹窗还高；
 * 没有子标签的主标签不显示折叠按钮。
 */
export const TagPicker: React.FC<Props> = ({ groups, value, onChange, max = MAX_MOD_TAGS, disabled = false, loading = false, error = null }) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const atCap = value.length >= max;

  const row = (name: string, description: string | undefined, main: boolean) => {
    const selected = main ? groupHasSelection(groups, value, name) : value.includes(name);
    const blocked = !selected && atCap;
    return (
      <button
        key={name}
        type="button"
        role="button"
        data-tag={name}
        data-tag-selected={selected ? 'true' : 'false'}
        aria-pressed={selected}
        aria-label={description ? `${name}：${description}` : name}
        title={description || undefined}
        disabled={disabled || blocked}
        onClick={() => onChange(toggleTagSelection(groups, value, name, max))}
        className={[
          'w-full text-left rounded border px-2 py-1 transition-colors',
          main ? 'font-medium' : '',
          selected ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-neutral-200 bg-white text-neutral-800 hover:border-emerald-600',
          blocked || disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
        ].join(' ').trim()}
      >
        <span className="flex items-center gap-1 text-[11px]">
          {selected ? <Check className="w-3 h-3 shrink-0" aria-hidden="true" /> : null}
          <span className="truncate">#{name}</span>
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
        <div className="space-y-1 rounded border border-neutral-200 bg-neutral-50/60 p-1.5 max-h-64 overflow-y-auto">
          {groups.map((group) => {
            const children = tagChildNames(group);
            const isOpen = expanded[group.name] === true;
            const hasChildren = children.length > 0;
            return (
              <div key={group.name} data-testid={`tag-picker-group-${group.name}`}>
                <div className="flex items-start gap-1">
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={() => setExpanded((current) => ({ ...current, [group.name]: !isOpen }))}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? '收起' : '展开'} ${group.name} 的子标签（${children.length} 个）`}
                      data-testid={`tag-picker-toggle-${group.name}`}
                      className="mt-1 p-0.5 rounded text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-700 cursor-pointer"
                    >
                      {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                  ) : (
                    <span className="w-4 shrink-0" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    {row(group.name, group.description, true)}
                  </div>
                </div>
                {hasChildren && isOpen ? (
                  <div
                    className="ml-4 mt-1 pl-2 border-l border-neutral-200 space-y-1"
                    data-testid={`tag-picker-children-${group.name}`}
                  >
                    {(group.children ?? []).map((child) => row(child.name, child.description, false))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-neutral-500">
        {value.length === 0 ? '至少选择一个标签。' : ''}标签由管理员维护，不能自行新增。
      </p>
    </div>
  );
};
