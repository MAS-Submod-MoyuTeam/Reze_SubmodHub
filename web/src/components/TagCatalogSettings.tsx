import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, RefreshCw, Trash2, X } from 'lucide-react';
import { readSession } from '../../../ui/auth-api';
import { updateSettings, type SiteSettings } from '../../../ui/settings-api';
import type { TagGroup } from '../../../ui/tags-api';

export const MAX_TAG_GROUPS = 20;
export const MAX_TAG_CHILDREN = 6;
export const MAX_TAG_NAME_LENGTH = 24;

function cloneGroups(groups: TagGroup[]): TagGroup[] {
  return groups.map((group) => ({ name: group.name, children: group.children ? [...group.children] : undefined }));
}

/** 与服务端一致的名称规则：trim 后非空、长度受限、不含逗号或井号。 */
export function validateTagName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return '标签名不能为空';
  if ([...name].length > MAX_TAG_NAME_LENGTH) return `标签名最多 ${MAX_TAG_NAME_LENGTH} 个字符`;
  if (name.includes(',') || name.includes('#')) return '标签名不能包含逗号或井号';
  return null;
}

function catalogNames(groups: TagGroup[]): Set<string> {
  const names = new Set<string>();
  for (const group of groups) {
    names.add(group.name);
    for (const child of group.children ?? []) names.add(child);
  }
  return names;
}

/** 名称在整份目录里必须唯一：模组只存扁平名称，重名会让选择产生歧义。 */
export function duplicateTagName(raw: string, groups: TagGroup[]): string | null {
  const name = raw.trim();
  return catalogNames(groups).has(name) ? `标签名「${name}」已存在` : null;
}

export function addMainTag(groups: TagGroup[], raw: string): { groups: TagGroup[]; error: string | null } {
  const error = validateTagName(raw) ?? duplicateTagName(raw, groups);
  if (error) return { groups, error };
  if (groups.length >= MAX_TAG_GROUPS) return { groups, error: `主标签最多 ${MAX_TAG_GROUPS} 个` };
  return { groups: [...cloneGroups(groups), { name: raw.trim() }], error: null };
}

export function addChildTag(groups: TagGroup[], parent: string, raw: string): { groups: TagGroup[]; error: string | null } {
  const error = validateTagName(raw) ?? duplicateTagName(raw, groups);
  if (error) return { groups, error };
  const index = groups.findIndex((group) => group.name === parent);
  if (index < 0) return { groups, error: '主标签不存在' };
  const children = groups[index].children ?? [];
  if (children.length >= MAX_TAG_CHILDREN) return { groups, error: `每个主标签最多 ${MAX_TAG_CHILDREN} 个子标签` };
  const next = cloneGroups(groups);
  next[index].children = [...children, raw.trim()];
  return { groups: next, error: null };
}

export function removeMainTag(groups: TagGroup[], parent: string): TagGroup[] {
  return cloneGroups(groups.filter((group) => group.name !== parent));
}

export function removeChildTag(groups: TagGroup[], parent: string, child: string): TagGroup[] {
  return cloneGroups(groups.map((group) => (
    group.name === parent
      ? { name: group.name, children: (group.children ?? []).filter((name) => name !== child) }
      : group
  )));
}

/** 上移/下移主标签；越界时原样返回。 */
export function moveMainTag(groups: TagGroup[], index: number, delta: -1 | 1): TagGroup[] {
  const target = index + delta;
  if (index < 0 || index >= groups.length || target < 0 || target >= groups.length) return groups;
  const next = cloneGroups(groups);
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

export function tagCatalogDirty(groups: TagGroup[], saved: TagGroup[]): boolean {
  return JSON.stringify(groups) !== JSON.stringify(saved);
}

interface Props {
  apiBase: string;
  groups: TagGroup[];
  revision: number;
  onSaved: (updated: SiteSettings) => void;
  onConflict: () => void;
  onToast: (type: 'success' | 'error', message: string) => void;
}

/**
 * 标签目录编辑卡片：主标签 + 子标签，只能在这里增删。
 * 保存后服务端会同步清理模组上已不存在的标签，所以这里明确提示该后果。
 */
export const TagCatalogSettings: React.FC<Props> = ({ apiBase, groups, revision, onSaved, onConflict, onToast }) => {
  const [draft, setDraft] = useState<TagGroup[]>(() => cloneGroups(groups));
  const [mainInput, setMainInput] = useState('');
  const [childInputs, setChildInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(cloneGroups(groups));
  }, [groups]);

  const dirty = useMemo(() => tagCatalogDirty(draft, groups), [draft, groups]);
  const childCount = draft.reduce((total, group) => total + (group.children?.length ?? 0), 0);

  const applyMainTag = () => {
    const result = addMainTag(draft, mainInput);
    setError(result.error);
    if (result.error) return;
    setDraft(result.groups);
    setMainInput('');
  };

  const applyChildTag = (parent: string) => {
    const result = addChildTag(draft, parent, childInputs[parent] ?? '');
    setError(result.error);
    if (result.error) return;
    setDraft(result.groups);
    setChildInputs((current) => ({ ...current, [parent]: '' }));
  };

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const session = await readSession(apiBase);
      const updated = await updateSettings({ tag_catalog: draft }, revision, session.csrf_token, apiBase);
      onSaved(updated);
      onToast('success', '标签目录已保存，作者端下次打开编辑弹窗即可看到。');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      if (message.includes('conflict') || message.includes('409')) {
        onConflict();
        onToast('error', '设置已被其他管理员修改，请重新加载后再试。');
      } else {
        setError(message);
        onToast('error', `保存标签目录失败：${message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white border border-neutral-200/90 rounded-xl shadow-xs hover:shadow-sm transition-shadow p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">标签目录</h2>
          <p className="text-[11px] text-neutral-500 mt-1">
            作者只能从这里多选标签，不能自行创建。主标签可单独选中，选中子标签时会自动带上主标签。
          </p>
        </div>
        <span className="text-[11px] tabular-nums text-neutral-500">
          主标签 {draft.length}/{MAX_TAG_GROUPS} · 子标签 {childCount}
        </span>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={mainInput}
          onChange={(event) => setMainInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              applyMainTag();
            }
          }}
          placeholder="新增主标签，例如：工具"
          aria-label="新增主标签"
          className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600"
        />
        <button
          type="button"
          onClick={applyMainTag}
          disabled={draft.length >= MAX_TAG_GROUPS}
          className="shrink-0 px-3 py-1.5 text-xs rounded border border-neutral-300 text-neutral-700 hover:border-emerald-600 disabled:opacity-40"
        >
          添加主标签
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-[11px] text-rose-600">{error}</p>
      ) : null}

      <div className="space-y-2">
        {draft.length === 0 ? (
          <p className="text-[11px] text-neutral-500">目录为空。至少需要一个主标签才能保存。</p>
        ) : draft.map((group, index) => (
          <div key={group.name} className="rounded border border-neutral-200 p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-neutral-900">#{group.name}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`上移 ${group.name}`}
                  disabled={index === 0}
                  onClick={() => setDraft(moveMainTag(draft, index, -1))}
                  className="p-1 rounded text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`下移 ${group.name}`}
                  disabled={index === draft.length - 1}
                  onClick={() => setDraft(moveMainTag(draft, index, 1))}
                  className="p-1 rounded text-neutral-500 hover:bg-neutral-100 disabled:opacity-30"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`删除 ${group.name}`}
                  onClick={() => setDraft(removeMainTag(draft, group.name))}
                  className="p-1 rounded text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(group.children ?? []).map((child) => (
                <span key={child} className="inline-flex items-center gap-1 rounded-full border border-neutral-300 bg-neutral-50 px-2 py-0.5 text-[11px] text-neutral-700">
                  {child}
                  <button type="button" aria-label={`删除子标签 ${child}`} onClick={() => setDraft(removeChildTag(draft, group.name, child))} className="text-neutral-400 hover:text-rose-600">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              {(group.children?.length ?? 0) < MAX_TAG_CHILDREN ? (
                <span className="inline-flex items-center gap-1">
                  <input
                    type="text"
                    value={childInputs[group.name] ?? ''}
                    onChange={(event) => setChildInputs((current) => ({ ...current, [group.name]: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        applyChildTag(group.name);
                      }
                    }}
                    placeholder="添加子标签"
                    aria-label={`为 ${group.name} 添加子标签`}
                    className="w-28 text-[11px] px-2 py-0.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600"
                  />
                  <button type="button" onClick={() => applyChildTag(group.name)} className="text-[11px] text-emerald-700 hover:underline">
                    添加
                  </button>
                </span>
              ) : (
                <span className="text-[11px] text-neutral-400">子标签已达上限</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-neutral-500">
        保存后，从目录里删掉的标签会同时从模组上移除；模组本身至少要保留一个标签，请在作者端重新选择。
      </p>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => { setDraft(cloneGroups(groups)); setError(null); }}
          disabled={!dirty || saving}
          className="px-3 py-1.5 text-xs rounded text-neutral-600 hover:text-neutral-900 disabled:opacity-40"
        >
          恢复
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="px-4 py-1.5 text-xs rounded bg-emerald-700 text-white font-medium hover:bg-emerald-800 disabled:opacity-40 inline-flex items-center gap-1.5"
        >
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {saving ? '保存中...' : '保存目录'}
        </button>
      </div>
    </section>
  );
};
