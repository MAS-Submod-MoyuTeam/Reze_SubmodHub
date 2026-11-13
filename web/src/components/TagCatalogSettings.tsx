import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronUp, Languages, RefreshCw, Trash2, X } from 'lucide-react';
import { readSession } from '../../../ui/auth-api';
import { updateSettings, type SiteSettings } from '../../../ui/settings-api';
import { MAX_TAG_DESCRIPTION_LENGTH, type TagChild, type TagGroup } from '../../../ui/tags-api';
import {
  LANG_SHORT_LABELS,
  SUPPORTED_LANGS,
  useI18n,
  type Lang,
  type LocalizedText,
} from '../i18n';
import { valueSegmentClass } from './selectionStyles';

export const MAX_TAG_GROUPS = 20;
export const MAX_TAG_CHILDREN = 6;
export const MAX_TAG_NAME_LENGTH = 24;
/** 显示名是译文，没有「不能含逗号/井号」这类存储名约束，只限长度。 */
export const MAX_TAG_DISPLAY_NAME_LENGTH = MAX_TAG_NAME_LENGTH;

/**
 * 校验结果用「码 + 参数」表达，而不是直接返回中文句子：
 * 这些函数在纯模块里跑（也被测试直接调用），翻译必须留在组件里做。
 * 参数顺序固定，调用方用 `t(code, vars)` 拼。
 */
export type TagRuleError =
  | 'nameEmpty'
  | 'nameTooLong'
  | 'nameChars'
  | 'duplicate'
  | 'maxGroups'
  | 'maxChildren'
  | 'parentMissing'
  | 'descriptionTooLong'
  | 'descriptionControl'
  | 'displayNameTooLong';

export interface TagRuleIssue {
  code: TagRuleError;
  vars?: Record<string, string | number>;
}

/** 把条目翻译成语言相关的字符串；纯模块里用它给测试或调用方一个可读结果。 */
export function tagIssueText(issue: TagRuleIssue | null, t: (key: string, vars?: Record<string, string | number>) => string): string | null {
  if (!issue) return null;
  return t(`tagCatalog.${issue.code}`, issue.vars);
}

/**
 * 兼容旧调用方（测试与作者端）的字符串入口：返回键名而不是中文句子，
 * 因为纯函数模块不能 import React/i18n，真实文案由组件用 `t()` 翻。
 */
export function validateTagName(raw: string): string | null {
  const issue = tagNameIssue(raw);
  return issue ? `tagCatalog.${issue.code}` : null;
}

export function validateTagDescription(raw: string): string | null {
  const issue = tagDescriptionIssue(raw);
  return issue ? `tagCatalog.${issue.code}` : null;
}

export function validateTagDisplayName(raw: string): string | null {
  const issue = tagDisplayNameIssue(raw);
  return issue ? `tagCatalog.${issue.code}` : null;
}

export function tagNameIssue(raw: string): TagRuleIssue | null {
  const name = raw.trim();
  if (!name) return { code: 'nameEmpty' };
  if ([...name].length > MAX_TAG_NAME_LENGTH) return { code: 'nameTooLong', vars: { max: MAX_TAG_NAME_LENGTH } };
  if (name.includes(',') || name.includes('#')) return { code: 'nameChars' };
  return null;
}

/** 与服务端一致的描述规则：单行、可留空、长度受限。每种语言各自校验。 */
export function tagDescriptionIssue(raw: string): TagRuleIssue | null {
  const description = raw.trim();
  if ([...description].length > MAX_TAG_DESCRIPTION_LENGTH) {
    return { code: 'descriptionTooLong', vars: { max: MAX_TAG_DESCRIPTION_LENGTH } };
  }
  if (/[\u0000-\u001f\u007f]/.test(description)) return { code: 'descriptionControl' };
  return null;
}

/** 多语言描述逐语言校验：中文合规不代表英文也合规。 */
export function tagDescriptionsIssue(text: LocalizedText | undefined): TagRuleIssue | null {
  for (const value of Object.values(text ?? {})) {
    const issue = tagDescriptionIssue(value ?? '');
    if (issue) return issue;
  }
  return null;
}

export function tagDisplayNameIssue(raw: string): TagRuleIssue | null {
  const name = raw.trim();
  if ([...name].length > MAX_TAG_DISPLAY_NAME_LENGTH) {
    return { code: 'displayNameTooLong', vars: { max: MAX_TAG_DISPLAY_NAME_LENGTH } };
  }
  return null;
}

export function tagDisplayNamesIssue(text: LocalizedText | undefined): TagRuleIssue | null {
  for (const value of Object.values(text ?? {})) {
    const issue = tagDisplayNameIssue(value ?? '');
    if (issue) return issue;
  }
  return null;
}

function cloneGroups(groups: TagGroup[]): TagGroup[] {
  return groups.map((group) => ({
    name: group.name,
    displayName: group.displayName ? { ...group.displayName } : undefined,
    description: group.description ? { ...group.description } : undefined,
    children: group.children ? group.children.map((child) => ({ ...child })) : undefined,
  }));
}

function catalogNames(groups: TagGroup[]): Set<string> {
  const names = new Set<string>();
  for (const group of groups) {
    names.add(group.name);
    for (const child of group.children ?? []) names.add(child.name);
  }
  return names;
}

/** 名称在整份目录里必须唯一：模组只存扁平名称，重名会让选择产生歧义。 */
export function duplicateTagName(raw: string, groups: TagGroup[]): string | null {
  const name = raw.trim();
  return catalogNames(groups).has(name) ? `tagCatalog.duplicate` : null;
}

function duplicateIssue(raw: string, groups: TagGroup[]): TagRuleIssue | null {
  const name = raw.trim();
  return catalogNames(groups).has(name) ? { code: 'duplicate', vars: { name } } : null;
}

export interface TagAddResult {
  groups: TagGroup[];
  error: TagRuleIssue | null;
}

export function addMainTag(groups: TagGroup[], raw: string): TagAddResult {
  const error = tagNameIssue(raw) ?? duplicateIssue(raw, groups);
  if (error) return { groups, error };
  if (groups.length >= MAX_TAG_GROUPS) return { groups, error: { code: 'maxGroups', vars: { max: MAX_TAG_GROUPS } } };
  return { groups: [...cloneGroups(groups), { name: raw.trim() }], error: null };
}

export function addChildTag(groups: TagGroup[], parent: string, raw: string): TagAddResult {
  const error = tagNameIssue(raw) ?? duplicateIssue(raw, groups);
  if (error) return { groups, error };
  const index = groups.findIndex((group) => group.name === parent);
  if (index < 0) return { groups, error: { code: 'parentMissing' } };
  const children = groups[index].children ?? [];
  if (children.length >= MAX_TAG_CHILDREN) {
    return { groups, error: { code: 'maxChildren', vars: { max: MAX_TAG_CHILDREN } } };
  }
  const next = cloneGroups(groups);
  next[index].children = [...children, { name: raw.trim() }];
  return { groups: next, error: null };
}

export function removeMainTag(groups: TagGroup[], parent: string): TagGroup[] {
  return cloneGroups(groups.filter((group) => group.name !== parent));
}

export function removeChildTag(groups: TagGroup[], parent: string, child: string): TagGroup[] {
  return cloneGroups(groups.map((group) => (
    group.name === parent
      ? { ...group, children: (group.children ?? []).filter((entry) => entry.name !== child) }
      : group
  )));
}

/** 就地写入某个语言的描述；空串表示删掉该语言，不影响其他语言。 */
function withLocalizedEntry(text: LocalizedText | undefined, lang: Lang, raw: string): LocalizedText | undefined {
  const next: LocalizedText = { ...(text ?? {}) };
  const value = raw.trim();
  if (value) next[lang] = value;
  else delete next[lang];
  return Object.keys(next).length > 0 ? next : undefined;
}

export function setMainDescription(groups: TagGroup[], parent: string, raw: string, lang: Lang): TagGroup[] {
  return cloneGroups(groups.map((group) => (
    group.name === parent ? { ...group, description: withLocalizedEntry(group.description, lang, raw) } : group
  )));
}

export function setChildDescription(groups: TagGroup[], parent: string, child: string, raw: string, lang: Lang): TagGroup[] {
  return cloneGroups(groups.map((group) => (
    group.name === parent
      ? {
        ...group,
        children: (group.children ?? []).map((entry) => (
          entry.name === child ? { ...entry, description: withLocalizedEntry(entry.description, lang, raw) } : entry
        )),
      }
      : group
  )));
}

/** 就地写入某个语言的显示名；空串表示这一语言不显示译文，回落存储名。 */
function withLocalizedLabel(text: LocalizedText | undefined, lang: Lang, raw: string): LocalizedText | undefined {
  return withLocalizedEntry(text, lang, raw);
}

export function setMainDisplayName(groups: TagGroup[], parent: string, raw: string, lang: Lang): TagGroup[] {
  return cloneGroups(groups.map((group) => (
    group.name === parent ? { ...group, displayName: withLocalizedLabel(group.displayName, lang, raw) } : group
  )));
}

export function setChildDisplayName(groups: TagGroup[], parent: string, child: string, raw: string, lang: Lang): TagGroup[] {
  return cloneGroups(groups.map((group) => (
    group.name === parent
      ? {
        ...group,
        children: (group.children ?? []).map((entry) => (
          entry.name === child ? { ...entry, displayName: withLocalizedLabel(entry.displayName, lang, raw) } : entry
        )),
      }
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

/** 折叠状态：主标签名 → 是否展开。默认全部收起，与作者端、筛选抽屉一致。 */
export type CatalogCollapse = Readonly<Record<string, boolean>>;

interface Props {
  apiBase: string;
  groups: TagGroup[];
  revision: number;
  onSaved: (updated: SiteSettings) => void;
  onConflict: () => void;
  onToast: (type: 'success' | 'error', message: string) => void;
}

/** 卡片顶部的语言标签条：编辑哪一个语言的显示名与描述，中文/英文各自独立。 */
const LanguageTabs: React.FC<{ value: Lang; onChange: (next: Lang) => void }> = ({ value, onChange }) => (
  <div role="group" className="flex w-fit items-center rounded bg-neutral-100 p-0.5 text-[10px] font-medium">
    {SUPPORTED_LANGS.map((lang) => (
      <button
        key={lang}
        type="button"
        aria-pressed={value === lang}
        onClick={() => onChange(lang)}
        className={`${valueSegmentClass(value === lang, 'px-1.5 py-0.5 rounded')} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600`}
      >
        {LANG_SHORT_LABELS[lang]}
      </button>
    ))}
  </div>
);

/**
 * 标签目录编辑卡片。
 *
 * 层级与作者端、筛选抽屉保持一致：主标签一行（名称 + 显示名 + 描述），子标签
 * 默认折叠，没有子标签的主标签不出现折叠按钮。
 *
 * 存储名 `name` 仍然只有一个，是模组数据里的标识；显示名与描述是「语言 → 文本」，
 * 用卡片顶部的小语言标签条切换当前编辑语言——20 个主标签逐个铺两种语言会
 * 把卡片撑爆，所以只渲染当前语言那一组输入框，另一语言的文本留在 draft 里。
 */
export const TagCatalogSettings: React.FC<Props> = ({ apiBase, groups, revision, onSaved, onConflict, onToast }) => {
  const { t, lang, setLang } = useI18n();
  const [draft, setDraft] = useState<TagGroup[]>(() => cloneGroups(groups));
  const [mainInput, setMainInput] = useState('');
  const [childInputs, setChildInputs] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<CatalogCollapse>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** 编辑语言独立于界面语言：管理员可以在英文界面下改中文显示名。 */
  const [editingLang, setEditingLang] = useState<Lang>(lang);

  useEffect(() => {
    setDraft(cloneGroups(groups));
  }, [groups]);

  const dirty = useMemo(() => tagCatalogDirty(draft, groups), [draft, groups]);
  const childCount = draft.reduce((total, group) => total + (group.children?.length ?? 0), 0);

  const showIssue = (issue: TagRuleIssue | null) => {
    setError(tagIssueText(issue, t));
  };

  const applyMainTag = () => {
    const result = addMainTag(draft, mainInput);
    if (result.error) {
      showIssue(result.error);
      return;
    }
    setError(null);
    setDraft(result.groups);
    setMainInput('');
  };

  const applyChildTag = (parent: string) => {
    const result = addChildTag(draft, parent, childInputs[parent] ?? '');
    if (result.error) {
      showIssue(result.error);
      return;
    }
    setError(null);
    setDraft(result.groups);
    setChildInputs((current) => ({ ...current, [parent]: '' }));
    // 刚加完子标签就把它露出来，否则用户会以为没加上。
    setExpanded((current) => ({ ...current, [parent]: true }));
  };

  const save = async () => {
    if (saving || !dirty) return;
    // 每种语言的显示名与描述都要在保存前各过一遍：服务端会拒绝超长文本，
    // 这里先给出同一条提示，免得保存后才发现是英文那一条写超了。
    for (const group of draft) {
      const problem = tagDisplayNamesIssue(group.displayName)
        ?? tagDescriptionsIssue(group.description)
        ?? (group.children ?? []).map((child) => tagDisplayNamesIssue(child.displayName) ?? tagDescriptionsIssue(child.description)).find(Boolean);
      if (problem) {
        showIssue(problem ?? null);
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const session = await readSession(apiBase);
      const updated = await updateSettings({ tag_catalog: draft }, revision, session.csrf_token, apiBase);
      onSaved(updated);
      onToast('success', t('tagCatalog.saved'));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      if (message.includes('conflict') || message.includes('409')) {
        onConflict();
        onToast('error', t('tagCatalog.conflict'));
      } else {
        setError(message);
        onToast('error', t('tagCatalog.saveFailed', { error: message }));
      }
    } finally {
      setSaving(false);
    }
  };

  const textInput = (
    value: string,
    onChange: (next: string) => void,
    label: string,
    placeholder: string,
    maxLength: number,
  ) => (
    <input
      type="text"
      value={value}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={label}
      className="w-full text-[11px] px-2 py-0.5 rounded border border-neutral-200 text-neutral-600 placeholder:text-neutral-400 focus:outline-none focus:border-emerald-600"
    />
  );

  /** 一个标签的两种语言字段：名称（存储名）只读展示 + 当前语言的显示名/描述。 */
  const localizedFields = (
    target: { displayName?: LocalizedText; description?: LocalizedText },
    name: string,
    onDisplayName: (next: string) => void,
    onDescription: (next: string) => void,
    descriptionPlaceholder: string,
  ) => (
    <div className="space-y-1">
      {textInput(
        target.displayName?.[editingLang] ?? '',
        onDisplayName,
        t('tagCatalog.displayNameAria', { name }),
        t('tagCatalog.displayNamePlaceholder'),
        MAX_TAG_DISPLAY_NAME_LENGTH,
      )}
      {textInput(
        target.description?.[editingLang] ?? '',
        onDescription,
        t('tagCatalog.descriptionAria', { name }),
        descriptionPlaceholder,
        MAX_TAG_DESCRIPTION_LENGTH,
      )}
    </div>
  );

  return (
    <section className="bg-white border border-neutral-200/90 rounded-xl shadow-xs hover:shadow-sm transition-shadow p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">{t('tagCatalog.title')}</h2>
          <p className="text-[11px] text-neutral-500 mt-1">{t('tagCatalog.intro')}</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-[11px] tabular-nums text-neutral-500">
            {t('tagCatalog.counts', { groups: draft.length, max: MAX_TAG_GROUPS, children: childCount })}
          </span>
          <div className="flex items-center gap-1 text-[10px] text-neutral-500">
            <Languages className="w-3 h-3" aria-hidden="true" />
            <span>{t('localized.editLanguage')}</span>
            <LanguageTabs value={editingLang} onChange={setEditingLang} />
            {editingLang !== lang ? (
              <button type="button" onClick={() => setLang(editingLang)} className="text-[10px] text-emerald-700 hover:underline">
                {t('common.switchLanguage')}
              </button>
            ) : null}
          </div>
        </div>
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
          placeholder={t('tagCatalog.addPlaceholder')}
          aria-label={t('tagCatalog.addAria')}
          className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600"
        />
        <button
          type="button"
          onClick={applyMainTag}
          disabled={draft.length >= MAX_TAG_GROUPS}
          className="shrink-0 px-3 py-1.5 text-xs rounded border border-neutral-300 text-neutral-700 hover:border-emerald-600 disabled:opacity-40 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
        >
          {t('tagCatalog.add')}
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-[11px] text-rose-600">{error}</p>
      ) : null}

      <div className="space-y-2">
        {draft.length === 0 ? (
          <p className="text-[11px] text-neutral-500">{t('tagCatalog.empty')}</p>
        ) : draft.map((group, index) => {
          const children = group.children ?? [];
          const isOpen = expanded[group.name] === true;
          return (
            <div key={group.name} className="rounded border border-neutral-200 p-2 space-y-1.5" data-testid={`tag-group-${group.name}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-1">
                    {/* 没有子标签的主标签不出现折叠按钮：一个点了没反应的箭头比没有更糟。 */}
                    {children.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setExpanded((current) => ({ ...current, [group.name]: !isOpen }))}
                        aria-expanded={isOpen}
                        aria-label={isOpen
                          ? t('tagPicker.collapseChildren', { name: group.name, count: children.length })
                          : t('tagPicker.expandChildren', { name: group.name, count: children.length })}
                        data-testid={`tag-group-toggle-${group.name}`}
                        className="p-0.5 rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                      >
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                    ) : (
                      <span className="w-[1.125rem]" aria-hidden="true" />
                    )}
                    <span className="text-xs font-medium text-neutral-900">#{group.name}</span>
                    {children.length > 0 ? (
                      <span className="text-[10px] tabular-nums text-neutral-400">{children.length}</span>
                    ) : null}
                  </div>
                  {localizedFields(
                    group,
                    group.name,
                    (next) => setDraft(setMainDisplayName(draft, group.name, next, editingLang)),
                    (next) => setDraft(setMainDescription(draft, group.name, next, editingLang)),
                    t('tagCatalog.descriptionPlaceholder'),
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    aria-label={t('tagCatalog.moveUp', { name: group.name })}
                    disabled={index === 0}
                    onClick={() => setDraft(moveMainTag(draft, index, -1))}
                    className="p-1 rounded text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('tagCatalog.moveDown', { name: group.name })}
                    disabled={index === draft.length - 1}
                    onClick={() => setDraft(moveMainTag(draft, index, 1))}
                    className="p-1 rounded text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('tagCatalog.removeMain', { name: group.name })}
                    onClick={() => setDraft(removeMainTag(draft, group.name))}
                    className="p-1 rounded text-rose-600 hover:bg-rose-50 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {children.length > 0 && isOpen ? (
                <div className="pl-[1.375rem] space-y-1 border-l border-neutral-200 ml-1" data-testid={`tag-group-children-${group.name}`}>
                  {children.map((child: TagChild) => (
                    <div key={child.name} className="flex items-start gap-1.5">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-neutral-700">{child.name}</span>
                          <button
                            type="button"
                            aria-label={t('tagCatalog.removeChild', { name: child.name })}
                            onClick={() => setDraft(removeChildTag(draft, group.name, child.name))}
                            className="text-neutral-400 hover:text-rose-600 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        {localizedFields(
                          child,
                          child.name,
                          (next) => setDraft(setChildDisplayName(draft, group.name, child.name, next, editingLang)),
                          (next) => setDraft(setChildDescription(draft, group.name, child.name, next, editingLang)),
                          t('tagCatalog.childDescriptionPlaceholder'),
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-1.5">
                {children.length < MAX_TAG_CHILDREN ? (
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
                      placeholder={t('tagCatalog.childPlaceholder')}
                      aria-label={t('tagCatalog.childAria', { name: group.name })}
                      className="w-28 text-[11px] px-2 py-0.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600"
                    />
                    <button type="button" onClick={() => applyChildTag(group.name)} className="text-[11px] text-emerald-700 hover:underline active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">
                      {t('tagCatalog.childAdd')}
                    </button>
                  </span>
                ) : (
                  <span className="text-[11px] text-neutral-400">{t('tagCatalog.childCap')}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-neutral-500">{t('tagCatalog.footnote')}</p>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => { setDraft(cloneGroups(groups)); setError(null); }}
          disabled={!dirty || saving}
          className="px-3 py-1.5 text-xs rounded text-neutral-600 hover:text-neutral-900 disabled:opacity-40 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
        >
          {t('tagCatalog.restore')}
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="px-4 py-1.5 text-xs rounded bg-emerald-700 text-white font-medium hover:bg-emerald-800 disabled:opacity-40 inline-flex items-center gap-1.5 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
        >
          {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {saving ? t('tagCatalog.saving') : t('tagCatalog.save')}
        </button>
      </div>
    </section>
  );
};
