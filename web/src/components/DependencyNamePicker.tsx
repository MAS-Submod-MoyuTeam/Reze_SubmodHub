import React, { useEffect, useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ModSummary } from '../types/submodhub';

interface Props {
  value: string;
  options: ModSummary[];
  label: string;
  onInput?: (value: string) => void;
  onCommit: (value: string) => void;
  onSelect: (mod: ModSummary) => void;
}

export const DependencyNamePicker: React.FC<Props> = ({ value, options, label, onInput, onCommit, onSelect }) => {
  const [input, setInput] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();

  useEffect(() => setInput(value), [value]);

  const query = input.trim().toLocaleLowerCase();
  const matches = options.filter((mod) =>
    !query || mod.title.toLocaleLowerCase().includes(query) || mod.id.toLocaleLowerCase().includes(query),
  );

  const select = (mod: ModSummary) => {
    setInput(mod.title);
    setOpen(false);
    onSelect(mod);
  };

  return (
    <div className="relative min-w-56 flex-1">
      <div className="flex rounded border border-neutral-300 bg-white focus-within:border-emerald-600">
        <input
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          value={input}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setInput(event.target.value);
            setActiveIndex(0);
            setOpen(true);
            onInput?.(event.target.value);
          }}
          onBlur={() => {
            setOpen(false);
            if (input !== value) onCommit(input);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.min(index + 1, matches.length - 1));
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            }
            if (event.key === 'Enter' && open && matches[activeIndex]) {
              event.preventDefault();
              select(matches[activeIndex]);
            }
          }}
          placeholder="输入依赖名称或选择站内模组"
          className="w-full min-w-0 px-2 py-1.5 text-xs outline-none"
        />
        <button
          type="button"
          title="选择站内模组"
          aria-label="选择站内模组"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((current) => !current)}
          className="shrink-0 border-l border-neutral-200 px-2 text-neutral-600 hover:bg-neutral-100"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
      {open && (
        <div id={listId} role="listbox" className="absolute left-0 right-0 z-30 mt-1 max-h-48 overflow-y-auto rounded border border-neutral-200 bg-white shadow-lg">
          {matches.length ? matches.map((mod, index) => (
            <button
              key={mod.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => select(mod)}
              className={`block w-full px-3 py-2 text-left text-xs ${index === activeIndex ? 'bg-emerald-50' : 'hover:bg-neutral-50'}`}
            >
              <span className="block font-medium text-neutral-900">{mod.title}</span>
              <span className="block font-mono text-[10px] text-neutral-500">{mod.id}</span>
            </button>
          )) : <div className="px-3 py-2 text-xs text-neutral-500">无站内匹配；可直接使用输入的名称</div>}
        </div>
      )}
    </div>
  );
};
