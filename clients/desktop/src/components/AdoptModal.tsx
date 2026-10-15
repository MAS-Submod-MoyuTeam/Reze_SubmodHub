import React, { useState } from 'react';
import {
  X,
  FileCheck2,
  ShieldCheck,
  CheckCircle2,
  FolderGit2,
  Layers,
  ArrowRight,
  Store,
  Sparkles,
  HelpCircle,
  AlertTriangle,
} from 'lucide-react';
import { InstalledItem, StoreMatchCandidate } from '../types/client';

export function normalizePath(p: string): string {
  return p.replace(/^[/\\]+/, '').replace(/^game\//i, '').replace(/\\/g, '/').toLowerCase();
}

export function matchRegistrationToCandidate(
  reg: { name: string; author?: string; version?: string; source: string; unknown: boolean },
  candidate: StoreMatchCandidate
): boolean {
  if (reg.unknown || !reg.name) return false;
  if (!candidate.registrations || candidate.registrations.length === 0) {
    return false;
  }
  const regNameTrimmed = reg.name.trim();
  return candidate.registrations.some(r => r.trim() === regNameTrimmed);
}

export function getRegistrationSourcesForCandidate(
  candidate: StoreMatchCandidate,
  registrations: Array<{ name: string; author?: string; version?: string; source: string; unknown: boolean }> | undefined,
  allPaths: string[]
): string[] {
  const matchingRegs = (registrations || []).filter(r => matchRegistrationToCandidate(r, candidate) && r.source);
  const regSources = new Set(matchingRegs.map(r => r.source.replace(/\\/g, '/').toLowerCase()));
  const normalizedRegSources = new Set(matchingRegs.map(r => normalizePath(r.source)));

  const isRegSource = (path: string) => {
    const p = path.replace(/\\/g, '/').toLowerCase();
    return regSources.has(p) || normalizedRegSources.has(normalizePath(p));
  };

  const cleanPaths = allPaths.filter(p => !p.toLowerCase().endsWith('.rpyc'));
  return cleanPaths.filter(isRegSource);
}

export const getCandidateRegistrationPaths = getRegistrationSourcesForCandidate;

interface AdoptModalProps {
  item: InstalledItem | null;
  onClose: () => void;
  onConfirmAdopt: (adoptedItem: InstalledItem, chosenFiles?: string[]) => void;
}

export const AdoptModal: React.FC<AdoptModalProps> = ({
  item,
  onClose,
  onConfirmAdopt,
}) => {
  const isAmbiguous = item?.match_status === 'ambiguous';
  const hasMultipleRegistrations = (item?.registrations || []).length > 1;
  const hasUnknownRegs = (item?.registrations || []).some(r => r.unknown);
  const isIncomplete = Boolean(item?.incomplete);

  // If match status is matched (unambiguous single match), allow topCandidate default
  const topCandidate = (!isAmbiguous && item?.match_status === 'matched') ? item?.match_candidates?.[0] : undefined;

  const [modTitle, setModTitle] = useState(
    topCandidate ? topCandidate.title : (isAmbiguous ? '' : (item?.title || ''))
  );
  const [modId, setModId] = useState(
    topCandidate
      ? topCandidate.mod_id
      : (isAmbiguous
          ? ''
          : (item?.submod_dir_name ? item.submod_dir_name : (item?.mod_id || '').replace(/^local:/, '')))
  );
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    topCandidate ? topCandidate.mod_id : null
  );

  const [versionStr, setVersionStr] = useState(
    item?.installed_version && item.installed_version !== '未声明'
      ? item.installed_version
      : '1.0.0-adopted'
  );
  const [authorName, setAuthorName] = useState(
    item?.author_name === '未知作者 (本地检测)' ? '本地自制/导入' : (item?.author_name || '')
  );
  const [priority, setPriority] = useState(item?.priority || 50);

  // Active store candidate if user applied one or if topCandidate is active or modId matches
  const activeCandidate = (item?.match_candidates || []).find(
    (c) => c.mod_id === selectedCandidateId || (modId.trim() && c.mod_id === modId.trim())
  );

  // Default to all files in the detected unmanaged item; candidate validation still blocks identity conflicts.
  const allPaths = item?.unmanaged_paths || [];
  const defaultSelectedPaths = allPaths;

  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    new Set(defaultSelectedPaths)
  );
  const [showAllFiles, setShowAllFiles] = useState(false);

  if (!item) return null;

  const togglePath = (p: string) => {
    const next = new Set(selectedPaths);
    if (next.has(p)) {
      next.delete(p);
    } else {
      next.add(p);
    }
    setSelectedPaths(next);
  };

  const handleApplyCandidate = (c: StoreMatchCandidate) => {
    setSelectedCandidateId(c.mod_id);
    setModId(c.mod_id);
    setModTitle(c.title);
  };

  const candidateValidationError = (() => {
    // Collect registrations whose source file is checked in selectedPaths
    const selectedRegistrations = (item?.registrations || []).filter((r) => {
      if (!r.source) return false;
      const normSource = normalizePath(r.source);
      const rawSource = r.source.replace(/\\/g, '/').toLowerCase();
      for (const p of selectedPaths) {
        if (p.replace(/\\/g, '/').toLowerCase() === rawSource || normalizePath(p) === normSource) {
          return true;
        }
      }
      return false;
    });

    if (activeCandidate) {
      if (modId.trim() && modId.trim() !== activeCandidate.mod_id) {
        return `候选模组唯一标识符 (${activeCandidate.mod_id}) 与填写的模组 ID (${modId.trim()}) 不一致。`;
      }

      if (selectedRegistrations.length === 0) {
        return '所选文件中未包含候选模组的有效注册来源文件，归属不明确，禁止提交。';
      }

      if (selectedRegistrations.some((r) => r.unknown)) {
        return '所选文件包含未知或非规范注册头，归属不明确，禁止作为单个商店模组提交。';
      }

      // Check if any selected registration does NOT belong to activeCandidate
      const foreignRegs = selectedRegistrations.filter((r) => !matchRegistrationToCandidate(r, activeCandidate));
      if (foreignRegs.length > 0) {
        const foreignNames = Array.from(new Set(foreignRegs.map((r) => r.name || '未知')));
        return `所选文件包含其他模组的注册来源 (${foreignNames.join(', ')})，禁止作为单个商店模组提交。`;
      }

      // Check if multiple distinct registration names are present
      const distinctNames = Array.from(new Set(selectedRegistrations.map((r) => r.name.trim())));
      if (distinctNames.length > 1) {
        const candRegs = new Set((activeCandidate.registrations || []).map((r) => r.trim()));
        const allCovered = distinctNames.every((n) => candRegs.has(n));
        if (!allCovered) {
          return `检测到多个不同的子模组注册标识 (${distinctNames.join(', ')})，禁止作为单个商店模组提交。`;
        }
      }
    } else {
      // Local adoption validation: forbid multiple distinct registration names
      const distinctNames = Array.from(
        new Set(selectedRegistrations.filter((r) => !r.unknown && r.name).map((r) => r.name.trim()))
      );
      if (distinctNames.length > 1) {
        return `检测到多个不同的子模组注册标识 (${distinctNames.join(', ')})，禁止合并为单个模组收养。请单独收养对应模组。`;
      }
    }

    return null;
  })();

  const handleAdopt = () => {
    if (candidateValidationError) return;
    // When adopting, integrity status must remain 'unknown' until inspected against manifest/signatures.
    // The VersionID must remain empty if adopting as local unverified version.
    const chosen = Array.from(selectedPaths);
    const updated: InstalledItem = {
      ...item,
      title: modTitle.trim() || item.title,
      mod_id: activeCandidate ? activeCandidate.mod_id : (modId.trim() || item.mod_id),
      selected_candidate_id: activeCandidate ? activeCandidate.mod_id : undefined,
      selected_candidate_registrations: activeCandidate ? activeCandidate.registrations : undefined,
      installed_version: versionStr.trim() || '1.0.0',
      installed_version_id: selectedCandidateId && selectedCandidateId === (activeCandidate ? activeCandidate.mod_id : modId.trim()) ? item.installed_version_id : '',
      author_name: authorName.trim() || '本地导入',
      priority,
      is_managed: true,
      integrity_status: 'unknown',
    };
    onConfirmAdopt(updated, chosen);
  };

  const previewPaths = showAllFiles ? allPaths : allPaths.slice(0, 5);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs select-none">
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-neutral-800 flex items-center justify-between bg-neutral-900/90 shrink-0">
          <div className="flex items-center gap-2">
            <FolderGit2 className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-neutral-100 text-sm">
              显式收养为托管模组向导 (Adopt Unmanaged Mod)
            </h3>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 text-xs overflow-y-auto grow">
          <div className="p-3 rounded-lg bg-neutral-950 border border-neutral-800 text-neutral-300 leading-relaxed">
            将当前散落于 MAS 目录内的未托管脚本/素材纳入 SubmodHub 的持久化 Ledger。收养后该模组将受版本控制、支持冲突计算与模组优先级调节。卸载收养模组时将安全保留原始文件。
          </div>

          {/* Warning banner for multi-registrations, unknowns, or incomplete scan */}
          {(hasMultipleRegistrations || hasUnknownRegs || isIncomplete) && (
            <div className="p-3 bg-amber-950/40 border border-amber-800/80 rounded-lg space-y-1 text-amber-300">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                <span>
                  {isIncomplete
                    ? '扫描受限或未完成'
                    : hasMultipleRegistrations
                    ? '检测到多个子模组注册头'
                    : '检测到未知/未规范注册头'}
                </span>
              </div>
              <p className="text-[11px] text-amber-200/90 leading-relaxed">
                当前目录可能包含多个模组或未知脚本。文件默认全部勾选，请核对文件与模组归属；身份冲突时无法作为单个商店模组收养。
              </p>
            </div>
          )}

          {/* Ambiguous Store Candidate Warning */}
          {isAmbiguous && (
            <div className="p-3 bg-purple-950/40 border border-purple-800/80 rounded-lg space-y-1 text-purple-300">
              <div className="flex items-center gap-2 font-semibold">
                <HelpCircle className="w-4 h-4 shrink-0 text-purple-400" />
                <span>存在歧义候选模组</span>
              </div>
              <p className="text-[11px] text-purple-200/90 leading-relaxed">
                未能唯一确定对应的商店模组。请在下方候选列表中点击“使用此 ID”进行明确选择，或手动指定模组标识符。
              </p>
            </div>
          )}

          {/* Store Candidate Recommendation */}
          {item.match_candidates && item.match_candidates.length > 0 && (
            <div className="p-3 bg-emerald-950/40 border border-emerald-800/80 rounded-lg space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                <Store className="w-4 h-4 shrink-0" />
                <span>商店已匹配候选模组</span>
              </div>
              <div className="space-y-1.5">
                {item.match_candidates.map((c) => (
                  <div
                    key={c.mod_id}
                    className="flex items-center justify-between p-2 rounded bg-neutral-900/80 border border-neutral-800 text-[11px]"
                  >
                    <div>
                      <div className="font-medium text-neutral-200">
                        {c.title} <span className="text-neutral-500 font-mono">({c.mod_id})</span>
                      </div>
                      <div className="text-neutral-400 text-[10px]">
                        {c.priority === 'single_registration' ? '⭐ 唯一注册头优先匹配' : '多注册头候选'} · 依据: {c.evidence?.join(', ') || '云端签名'}
                      </div>
                    </div>
                    {modId !== c.mod_id ? (
                      <button
                        type="button"
                        onClick={() => handleApplyCandidate(c)}
                        className="px-2 py-1 bg-emerald-600/80 hover:bg-emerald-500 text-white rounded text-[10px] font-semibold transition-colors cursor-pointer"
                      >
                        使用此 ID
                      </button>
                    ) : (
                      <span className="px-2 py-1 bg-emerald-900/50 text-emerald-300 border border-emerald-700/60 rounded text-[10px] font-mono">
                        已选定
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Validation Error Banner for candidate / multi-registration mismatch */}
          {candidateValidationError && (
            <div className="p-3 bg-rose-950/40 border border-rose-800/80 rounded-lg space-y-1 text-rose-300">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>模组身份与文件归属冲突</span>
              </div>
              <p className="text-[11px] text-rose-200/90 leading-relaxed">
                {candidateValidationError}
              </p>
            </div>
          )}

          {/* Form fields */}
          <div className="space-y-3">
            <div>
              <label className="text-neutral-300 font-medium block mb-1">
                模组识别名称 (Title)
              </label>
              <input
                type="text"
                value={modTitle}
                onChange={(e) => setModTitle(e.target.value)}
                className="w-full px-3 py-1.5 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-200 focus:outline-hidden focus:border-neutral-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  唯一标识符 ID (mod_id)
                </label>
                <input
                  type="text"
                  value={modId}
                  onChange={(e) => setModId(e.target.value)}
                  className="w-full px-3 py-1.5 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-200 font-mono focus:outline-hidden focus:border-neutral-500"
                />
              </div>

              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  登记基线版本号
                </label>
                <input
                  type="text"
                  value={versionStr}
                  onChange={(e) => setVersionStr(e.target.value)}
                  className="w-full px-3 py-1.5 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-200 font-mono focus:outline-hidden focus:border-neutral-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  作者/归属声明
                </label>
                <input
                  type="text"
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-200 focus:outline-hidden focus:border-neutral-500"
                />
              </div>

              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  初始优先级
                </label>
                <input
                  type="number"
                  value={priority}
                  onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-1.5 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-200 font-mono focus:outline-hidden focus:border-neutral-500"
                />
              </div>
            </div>
          </div>

          {/* Scanned files summary with checklist */}
          <div className="p-3 bg-neutral-950 rounded-lg border border-neutral-800 space-y-2 font-mono text-[11px]">
            <div className="flex items-center justify-between text-neutral-400">
              <span>纳入收养范围的文件清单 ({selectedPaths.size} / {allPaths.length}):</span>
              {allPaths.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAllFiles(!showAllFiles)}
                  className="text-emerald-400 hover:text-emerald-300 cursor-pointer font-sans text-[11px]"
                >
                  {showAllFiles ? '收起' : `展开全部 (${allPaths.length})`}
                </button>
              )}
            </div>

            <div className="space-y-1 max-h-40 overflow-y-auto">
              {previewPaths.map((p) => {
                const checked = selectedPaths.has(p);
                return (
                  <label
                    key={p}
                    className="flex items-center gap-2 text-neutral-300 hover:bg-neutral-900/60 p-1 rounded cursor-pointer truncate"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePath(p)}
                      className="rounded border-neutral-700 text-emerald-500 focus:ring-0 cursor-pointer"
                    />
                    <span className="truncate">{p}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-neutral-800 bg-neutral-950/80 flex justify-end gap-2 text-xs shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg cursor-pointer"
          >
            取消
          </button>
          <button
            disabled={selectedPaths.size === 0 || !modId.trim() || Boolean(candidateValidationError) || (isAmbiguous && !activeCandidate)}
            onClick={handleAdopt}
            className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>确认收养并写入 Ledger ({selectedPaths.size} 个文件)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
