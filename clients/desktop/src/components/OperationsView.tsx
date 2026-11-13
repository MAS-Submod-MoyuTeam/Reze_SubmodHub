import React, { useState } from 'react';
import {
  History,
  RotateCcw,
  FolderArchive,
} from 'lucide-react';
import { Operation } from '../types/client';
import { StateBadge, TransactionDetailModal } from './TransactionDetailModal';
import { useI18n } from '../i18n';

interface OperationsViewProps {
  operations: Operation[];
  onRecoverOperation: (opId: string) => void;
}

export const OperationsView: React.FC<OperationsViewProps> = ({
  operations,
  onRecoverOperation,
}) => {
  const { t } = useI18n();
  const [logModalOp, setLogModalOp] = useState<Operation | null>(null);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-950">
      {/* Top Header */}
      <div className="p-4 border-b border-neutral-800 bg-neutral-900/50 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-neutral-100">
              {t('operationsView.heading')}
            </h2>
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            {t('operationsView.subtitle')}
          </p>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Operations History and Recovery List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-neutral-400">
            <span className="font-semibold text-neutral-300">
              {t('operationsView.logHeading', { count: operations.length })}
            </span>
            <span>{t('operationsView.authoritySource')}</span>
          </div>

          {/* Desktop Table View */}
          {/* Wide content (state badges stay nowrap) must scroll instead of being
              clipped: the previous `overflow-hidden` silently cut the trailing
              "恢复与管理" column, which made 详情 / 安全回滚 unreachable as soon
              as the window was narrower than the window's default 1280px. */}
          <div className="hidden md:block border border-neutral-800 rounded-xl overflow-x-auto bg-neutral-900">
            <table className="w-full text-left text-xs font-sans">
              <thead className="bg-neutral-950 text-neutral-400 text-[11px] border-b border-neutral-800 uppercase font-medium">
                <tr>
                  <th className="py-2.5 px-4">{t('operationsView.colOperation')}</th>
                  <th className="py-2.5 px-3">{t('operationsView.colKind')}</th>
                  <th className="py-2.5 px-3">{t('operationsView.colState')}</th>
                  <th className="py-2.5 px-3">{t('operationsView.colProgress')}</th>
                  <th className="py-2.5 px-3">{t('operationsView.colBackup')}</th>
                  <th className="py-2.5 px-3">{t('operationsView.colCreatedAt')}</th>
                  <th className="py-2.5 px-4 text-right sticky right-0 z-20 bg-neutral-950 border-l border-neutral-800/80 shadow-[-10px_0_12px_-12px_rgba(0,0,0,0.9)]">
                    {t('operationsView.colActions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60 font-mono">
                {operations.map((op) => (
                  <tr key={op.operation_id} className="group hover:bg-neutral-800/30 transition-colors">
                    {/* ID and Mod */}
                    <td className="py-3 px-4">
                      <div className="font-semibold text-neutral-200 font-sans">{op.mod_title}</div>
                      <div className="text-[11px] text-neutral-400 truncate max-w-[180px]">
                        {op.operation_id}
                      </div>
                    </td>

                    {/* Kind */}
                    <td className="py-3 px-3 uppercase text-neutral-300 text-[11px]">
                      {op.kind}
                    </td>

                    {/* State */}
                    <td className="py-3 px-3 whitespace-nowrap">
                      <StateBadge state={op.state} />
                    </td>

                    {/* Progress */}
                    <td className="py-3 px-3 text-[11px]">
                      <div className="text-neutral-300 font-sans truncate max-w-[200px]" title={op.progress?.stage || ''}>
                        {op.progress?.stage || t('operationsView.noProgress')}
                      </div>
                      <div className="text-neutral-400 mt-0.5">
                        {t('operationsView.progressFiles', { processed: op.progress?.processed_files ?? 0, total: op.progress?.total_files ?? 0, percent: op.progress?.percent ?? 0 })}
                      </div>
                      {op.progress?.current_file && (
                        <div className="text-[10px] text-neutral-500 font-mono truncate max-w-[200px] mt-0.5" title={op.progress.current_file}>
                          {op.progress.current_file}
                        </div>
                      )}
                    </td>

                    {/* Backup ID */}
                    <td className="py-3 px-3 text-[11px] text-neutral-400 truncate max-w-[140px]">
                      {op.backup_id ? (
                        <span className="text-neutral-300 font-mono flex items-center gap-1" title={op.backup_id}>
                          <FolderArchive className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                          <span className="truncate">{op.backup_id}</span>
                        </span>
                      ) : (
                        t('operationsView.noBackup')
                      )}
                    </td>

                    {/* Created at */}
                    <td className="py-3 px-3 text-[11px] text-neutral-400 whitespace-nowrap">
                      {new Date(op.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>

                    {/* Actions — pinned to the right edge so 详情 / 回滚 remain
                        visible while the wide columns scroll underneath. */}
                    <td className="py-3 px-4 text-right font-sans sticky right-0 z-10 bg-neutral-900 group-hover:bg-neutral-800/40 border-l border-neutral-800/80 shadow-[-10px_0_12px_-12px_rgba(0,0,0,0.9)]">
                      <div className="flex items-center justify-end gap-1.5">
                        {op.state === 'needs_manual_recovery' ? (
                          <>
                            {op.can_rollback ? (
                              <button
                                onClick={() => onRecoverOperation(op.operation_id)}
                                className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-500 hover:bg-amber-400 text-neutral-950 transition-colors shadow-xs flex items-center gap-1 cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                                title={t('operationsView.reverifyTitle')}
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>{t('operationsView.reverifyRollback')}</span>
                              </button>
                            ) : (
                              <span
                                className="px-2 py-1 text-xs text-rose-400 bg-rose-950/60 rounded border border-rose-800/80 font-mono"
                                title={op.error?.message || t('operationsView.recoveryCorruptTitle')}
                              >
                                {t('operationsView.recoveryCorrupt')}
                              </span>
                            )}
                          </>
                        ) : (
                          (op.can_rollback || op.state === 'recoverable') && (
                            <button
                              onClick={() => onRecoverOperation(op.operation_id)}
                              className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-500 hover:bg-amber-400 text-neutral-950 transition-colors shadow-xs flex items-center gap-1 cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                              title={t('operationsView.rollbackTitle')}
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>{t('operationsView.rollback')}</span>
                            </button>
                          )
                        )}

                        <button
                          onClick={() => setLogModalOp(op)}
                          className="px-2 py-1 text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                        >
                          {t('operationsView.details')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View */}
          <div className="md:hidden space-y-3">
            {operations.map((op) => (
              <div
                key={op.operation_id}
                className="p-3.5 rounded-xl border border-neutral-800 bg-neutral-900/60 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-neutral-100 text-sm">{op.mod_title}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-neutral-800 uppercase text-neutral-300 font-mono">
                        {op.kind}
                      </span>
                    </div>
                    <div className="text-[11px] text-neutral-400 font-mono break-all mt-0.5">
                      {op.operation_id}
                    </div>
                  </div>
                  <span className="text-[11px] text-neutral-400 font-mono shrink-0">
                    {new Date(op.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <StateBadge state={op.state} />
                  {op.backup_id && (
                    <span className="text-[11px] text-neutral-400 font-mono flex items-center gap-1 truncate max-w-[180px]" title={op.backup_id}>
                      <FolderArchive className="w-3 h-3 shrink-0" />
                      <span className="truncate">{op.backup_id}</span>
                    </span>
                  )}
                </div>

                <div className="p-2.5 bg-neutral-950/70 rounded-lg border border-neutral-800/80 text-[11px] space-y-1">
                  <div className="text-neutral-300 font-sans">{op.progress?.stage || t('operationsView.noProgress')}</div>
                  <div className="text-neutral-400 font-mono">
                    {t('operationsView.progressFiles', { processed: op.progress?.processed_files ?? 0, total: op.progress?.total_files ?? 0, percent: op.progress?.percent ?? 0 })}
                  </div>
                  {op.progress?.current_file && (
                    <div className="text-[10px] text-neutral-500 font-mono truncate" title={op.progress.current_file}>
                      {op.progress.current_file}
                    </div>
                  )}
                  {op.error?.message && (
                    <div className="text-rose-400 font-sans break-words pt-1">
                      {op.error.message}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 justify-end pt-0.5">
                  {op.state === 'needs_manual_recovery' ? (
                    <>
                      {op.can_rollback ? (
                        <button
                          onClick={() => onRecoverOperation(op.operation_id)}
                          className="px-3 py-1.5 text-xs font-semibold rounded bg-amber-500 hover:bg-amber-400 text-neutral-950 transition-colors shadow-xs flex items-center gap-1 cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                          title={t('operationsView.reverifyTitle')}
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>{t('operationsView.reverifyRollback')}</span>
                        </button>
                      ) : (
                        <span
                          className="px-2.5 py-1 text-xs text-rose-400 bg-rose-950/60 rounded border border-rose-800/80 font-mono"
                          title={op.error?.message || t('operationsView.recoveryCorruptTitle')}
                        >
                          {t('operationsView.recoveryCorrupt')}
                        </span>
                      )}
                    </>
                  ) : (
                    (op.can_rollback || op.state === 'recoverable') && (
                      <button
                        onClick={() => onRecoverOperation(op.operation_id)}
                        className="px-3 py-1.5 text-xs font-semibold rounded bg-amber-500 hover:bg-amber-400 text-neutral-950 transition-colors shadow-xs flex items-center gap-1 cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                        title={t('operationsView.rollbackTitle')}
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>{t('operationsView.rollback')}</span>
                      </button>
                    )
                  )}

                  <button
                    onClick={() => setLogModalOp(op)}
                    className="px-3 py-1.5 text-xs text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-lg transition-colors cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                  >
                    {t('operationsView.details')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {logModalOp && (
        <TransactionDetailModal
          op={logModalOp}
          onClose={() => setLogModalOp(null)}
          onRecoverOperation={onRecoverOperation}
        />
      )}
    </div>
  );
};
