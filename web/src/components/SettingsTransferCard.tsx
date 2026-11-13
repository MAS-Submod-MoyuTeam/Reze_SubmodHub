import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  Check,
  FileJson,
  FileUp,
  Info,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { readSession } from '../../../ui/auth-api';
import {
  exportSettings,
  importSettings,
  type SettingsTransferDocument,
  type SiteSettings,
} from '../../../ui/settings-api';
import {
  parseSettingsTransfer,
  summarizeSettingsTransfer,
  type SettingsTransferIssue,
  type SettingsTransferSummary,
} from '../../../ui/settings-transfer';
import { triggerArchiveSave } from './reviewArchive';
import { useI18n } from '../i18n';

interface Props {
  apiBase: string;
  /** 当前设置 revision；导入成功后服务端会 +1。 */
  revision: number;
  onImported: (updated: SiteSettings) => void;
  onConflict: () => void;
  onToast: (type: 'success' | 'error', message: string) => void;
}

/**
 * 「备份与迁移」卡片：把这一份配置整体导出成 JSON，或把一份 JSON 整体导回来。
 *
 * 这里刻意不做「部分导入」：服务端语义是整份替换，UI 若暗示可以只改一两项，
 * 管理员就会在不知情的情况下把自己的标签目录或节点列表覆盖掉。所以导入前
 * 一定先展示确认条，把「会替换什么」写成具体的数字与条目。
 *
 * 导出文件不含任何凭据（只有 `credential_configured`），因此可以直接拷走；
 * 也正因为它不含凭据，导入到另一台部署时节点密码需要另行补上。
 */
export const SettingsTransferCard: React.FC<Props> = ({ apiBase, revision, onImported, onConflict, onToast }) => {
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pending, setPending] = useState<{ document: SettingsTransferDocument; summary: SettingsTransferSummary; filename: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const issueText = (issue: SettingsTransferIssue) => t(`settingsTransfer.issue.${issue}`);

  const download = async () => {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      const file = await exportSettings(apiBase);
      triggerArchiveSave(file.blob, file.filename);
      onToast('success', t('settingsTransfer.exported', { filename: file.filename }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      setError(t('settingsTransfer.exportFailed', { error: message }));
      onToast('error', t('settingsTransfer.exportFailed', { error: message }));
    } finally {
      setExporting(false);
    }
  };

  /**
   * 选中文件后先解析再问一遍。`point` 用来区分「刚选的文件」与「确认条里的文件」：
   * 同一个 input 重选同一个文件不会触发 change，所以选完就清空 value。
   */
  const choose = async (file: File | null) => {
    setPending(null);
    setError(null);
    if (!file) return;
    const parsed = parseSettingsTransfer(await file.text(), file.size);
    if (!parsed.ok) {
      setError(issueText(parsed.issue));
      return;
    }
    setPending({ document: parsed.document, summary: summarizeSettingsTransfer(parsed.document), filename: file.name });
  };

  const confirmImport = async () => {
    if (!pending || importing) return;
    setImporting(true);
    setError(null);
    try {
      const session = await readSession(apiBase);
      const updated = await importSettings(pending.document, session.csrf_token, apiBase);
      onImported(updated);
      onToast('success', t('settingsTransfer.imported', { filename: pending.filename }));
      setPending(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      if (message.includes('conflict') || message.includes('409') || message.includes('github_sync_max_age_env_override')) {
        onConflict();
        onToast('error', t('admin.settingsConflict'));
      } else {
        setError(t('settingsTransfer.importFailed', { error: message }));
        onToast('error', t('settingsTransfer.importFailed', { error: message }));
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="bg-white border border-neutral-200/90 rounded-xl shadow-xs hover:shadow-sm transition-shadow p-6 space-y-6">
      <div className="flex items-start justify-between border-b border-neutral-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-violet-50 text-violet-700 border border-violet-100/80">
            <ArrowLeftRight className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">{t('settingsTransfer.title')}</h2>
            <p className="text-xs text-neutral-500">{t('settingsTransfer.subtitle')}</p>
          </div>
        </div>
        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-neutral-100 text-neutral-600">
          rev {revision}
        </span>
      </div>

      <p className="text-xs text-neutral-600 leading-relaxed">{t('settingsTransfer.body')}</p>

      <div className="rounded-lg p-3 bg-neutral-50 border border-neutral-200/80 flex items-start gap-2 text-[11px] text-neutral-500 leading-relaxed">
        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        <span>{t('settingsTransfer.secretNote')}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => void download()}
          disabled={exporting}
          className="justify-center px-4 py-2.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-40 text-neutral-800 text-xs font-semibold flex items-center gap-2 transition-colors shadow-2xs cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
        >
          {exporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-neutral-500" /> : <FileJson className="w-3.5 h-3.5 text-neutral-500" />}
          {exporting ? t('settingsTransfer.exporting') : t('settingsTransfer.export')}
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={importing}
          className="justify-center px-4 py-2.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-40 text-neutral-800 text-xs font-semibold flex items-center gap-2 transition-colors shadow-2xs cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
        >
          <FileUp className="w-3.5 h-3.5 text-neutral-500" />
          {t('settingsTransfer.chooseFile')}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          // 真正可点的是上面那个按钮；`hidden` 的 input 不进无障碍树，否则读屏
          // 会看到两个同名的「选择 JSON 文件…」控件。它仍然可以被 `.click()` 唤起。
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            // 同一个文件连选两次不会再触发 change，所以每次都把选择清掉。
            event.target.value = '';
            void choose(file);
          }}
        />
      </div>

      {error && (
        <div role="alert" className="p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {pending && (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 space-y-3 text-xs text-amber-950">
          <div className="flex items-start gap-2.5">
            <TriangleAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1 min-w-0">
              <h3 className="font-bold text-sm text-amber-900">{t('settingsTransfer.confirmTitle')}</h3>
              <p className="text-neutral-600 leading-relaxed">{t('settingsTransfer.confirmBody')}</p>
              <p className="font-mono text-[11px] text-neutral-500 break-all">{pending.filename}</p>
            </div>
          </div>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 pl-7 text-[11px]">
            <div className="flex justify-between gap-2">
              <dt className="text-neutral-500">{t('settingsTransfer.summaryTags')}</dt>
              <dd className="font-medium text-neutral-900">
                {t('settingsTransfer.summaryTagsValue', { groups: pending.summary.tagGroupCount, children: pending.summary.tagChildCount })}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-neutral-500">{t('settingsTransfer.summaryNodes')}</dt>
              <dd className="font-medium text-neutral-900">
                {pending.summary.nodesUnchanged
                  ? t('settingsTransfer.summaryNodesUnchanged')
                  : t('settingsTransfer.summaryNodesValue', { count: pending.summary.nodeCount })}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-neutral-500">{t('settingsTransfer.summaryProxy')}</dt>
              <dd className="font-mono text-[11px] font-medium text-neutral-900 break-all text-right">
                {pending.summary.proxy || t('settingsTransfer.summaryProxyDirect')}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-neutral-500">{t('settingsTransfer.summaryWindow')}</dt>
              <dd className="font-mono text-[11px] font-medium text-neutral-900">
                {pending.summary.syncMaxAge || t('settingsTransfer.summaryWindowDefault')}
              </dd>
            </div>
          </dl>

          {pending.summary.includesToken && (
            <div className="flex items-start gap-1.5 pl-7 text-[11px] text-emerald-800">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{t('settingsTransfer.summaryToken')}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2.5 pt-1 pl-7">
            <button
              type="button"
              onClick={() => void confirmImport()}
              disabled={importing}
              className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 disabled:opacity-40 text-white font-semibold transition-colors shadow-2xs flex items-center gap-1.5 cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              {importing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {importing ? t('settingsTransfer.importing') : t('settingsTransfer.confirmImport')}
            </button>
            <button
              type="button"
              onClick={() => setPending(null)}
              disabled={importing}
              className="px-4 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-40 text-neutral-700 font-medium transition-colors cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
