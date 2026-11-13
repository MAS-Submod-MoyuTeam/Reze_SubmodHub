import React, { useState } from 'react';
import {
  FolderCog,
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  FolderPlus,
  ShieldCheck,
  RefreshCw,
  FolderOpen,
  Smartphone,
  Monitor,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import { Installation } from '../types/client';
import { m } from './Motion';
import { overlayVariants } from '../../../../ui/motion-presets';
import { useI18n } from '../i18n';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface AndroidDiagnosticInfo {
  summary: string;
  detail: string;
  isPermissionIssue: boolean;
}

export function getAndroidDiagnosticInfo(diagnostic: string | undefined, detail: string | undefined, t: Translate): AndroidDiagnosticInfo {
  if (!diagnostic) {
    return {
      summary: t('instancesView.diagCheckFailed'),
      detail: t('instancesView.diagCheckFailedNoReason'),
      isPermissionIssue: false,
    };
  }

  switch (diagnostic) {
    case 'storage_provider_unavailable':
      return {
        summary: t('instancesView.diagStorageProviderUnavailable'),
        detail: t('instancesView.diagStorageProviderUnavailableDetail'),
        isPermissionIssue: true,
      };
    case 'storage_access_query_failed':
      return {
        summary: t('instancesView.diagStorageQueryFailed'),
        detail: detail
          ? t('instancesView.diagStorageQueryFailedDetail', { detail })
          : t('instancesView.diagStorageQueryFailedDetailPlain'),
        isPermissionIssue: true,
      };
    case 'storage_access_denied':
      return {
        summary: t('instancesView.diagStorageDenied'),
        detail: t('instancesView.diagStorageDeniedDetail'),
        isPermissionIssue: true,
      };
    case 'storage_access_unsupported':
      return {
        summary: t('instancesView.diagStorageUnsupported'),
        detail: t('instancesView.diagStorageUnsupportedDetail'),
        isPermissionIssue: true,
      };
    case 'storage_access_error':
      return {
        summary: t('instancesView.diagStorageError'),
        detail: detail
          ? t('instancesView.diagStorageErrorDetail', { detail })
          : t('instancesView.diagStorageErrorDetailPlain'),
        isPermissionIssue: true,
      };
    case 'mas_root_missing':
      return {
        summary: t('instancesView.diagRootMissing'),
        detail: t('instancesView.diagRootMissingDetail'),
        isPermissionIssue: false,
      };
    case 'mas_root_not_directory':
      return {
        summary: t('instancesView.diagRootNotDirectory'),
        detail: t('instancesView.diagRootNotDirectoryDetail'),
        isPermissionIssue: false,
      };
    case 'mas_root_unreadable':
      return {
        summary: t('instancesView.diagRootUnreadable'),
        detail: detail
          ? t('instancesView.diagRootUnreadableDetail', { detail })
          : t('instancesView.diagRootUnreadableDetailPlain'),
        isPermissionIssue: false,
      };
    case 'game_directory_missing':
      return {
        summary: t('instancesView.diagGameMissing'),
        detail: t('instancesView.diagGameMissingDetail'),
        isPermissionIssue: false,
      };
    case 'game_path_not_directory':
      return {
        summary: t('instancesView.diagGamePathNotDirectory'),
        detail: t('instancesView.diagGamePathNotDirectoryDetail'),
        isPermissionIssue: false,
      };
    case 'game_directory_unreadable':
      return {
        summary: t('instancesView.diagGameUnreadable'),
        detail: detail
          ? t('instancesView.diagGameUnreadableDetail', { detail })
          : t('instancesView.diagGameUnreadableDetailPlain'),
        isPermissionIssue: false,
      };
    case 'game_directory_verified':
      return {
        summary: t('instancesView.diagGameVerified'),
        detail: t('instancesView.diagGameVerifiedDetail'),
        isPermissionIssue: false,
      };
    default:
      return {
        summary: t('instancesView.diagUnknown', { code: diagnostic }),
        detail: detail
          ? t('instancesView.diagUnknownDetailWithCode', { code: diagnostic, detail })
          : t('instancesView.diagUnknownDetail', { code: diagnostic }),
        isPermissionIssue: false,
      };
  }
}

interface InstancesViewProps {
  installations: Installation[];
  activeInstallationId: string;
  onSelectActive: (id: string) => Promise<void>;
  onAddCustomInstance: (label: string, path: string) => Promise<void>;
  onRemoveInstance: (id: string) => Promise<void>;
  onRefreshInstances: () => Promise<void>;
  onBrowseDirectory: () => Promise<string>;
  isAndroid?: boolean;
  onOpenAppUpdate?: () => void;
  hasAppUpdate?: boolean;
}

export const InstancesView: React.FC<InstancesViewProps> = ({
  installations,
  activeInstallationId,
  onSelectActive,
  onAddCustomInstance,
  onRemoveInstance,
  onRefreshInstances,
  onBrowseDirectory,
  isAndroid = false,
  onOpenAppUpdate,
  hasAppUpdate = false,
}) => {
  const { t } = useI18n();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newPath, setNewPath] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const formatBytes = (bytes: number) => {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const handleCreate = async () => {
    if (!newPath.trim()) {
      setValidationError(t('instancesView.pathRequired'));
      return;
    }
    setIsAdding(true);
    try {
      await onAddCustomInstance(newLabel.trim(), newPath.trim());
      setShowAddModal(false);
      setNewLabel('');
      setNewPath('');
      setValidationError(null);
    } catch (error) {
      setValidationError(t('instancesView.directoryValidationFailed', { error: String(error) }));
    } finally { setIsAdding(false); }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-neutral-950">
      {/* Header */}
      <div className="p-3 sm:p-4 border-b border-neutral-800 bg-neutral-900/50 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <FolderCog className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-neutral-100">
              {t('instancesView.heading')}
            </h2>
          </div>
          <p className="text-xs text-neutral-400 mt-0.5">
            {isAndroid
              ? t('instancesView.subtitleAndroid')
              : t('instancesView.subtitleDesktop')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isAndroid && (
            <button
              onClick={() => setShowAddModal(true)}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>{t('instancesView.addDirectory')}</span>
            </button>
          )}
          <button onClick={() => void onRefreshInstances()} className="px-3 py-1.5 text-xs text-neutral-300 hover:text-white flex items-center gap-1 cursor-pointer" title={t('instancesView.recheckTitle')}><RefreshCw className="w-3.5 h-3.5" />{t('instancesView.recheck')}</button>
        </div>
      </div>

      {/* Main List */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
        {/* Instances Grid */}
        <div className="space-y-3">
          {installations.map((inst) => {
            const isActive = inst.id === activeInstallationId;
            const isAuthorized = inst.permission_state === 'authorized';
            const isAndroidInstance = inst.platform === 'android' || isAndroid;
            const diagInfo = isAndroidInstance ? getAndroidDiagnosticInfo(inst.diagnostic, inst.diagnostic_detail, t) : null;

            return (
              <div
                key={inst.id}
                className={`p-4 rounded-xl border transition-all ${
                  isActive
                    ? 'bg-neutral-900 border-emerald-500/80 shadow-xs'
                    : 'bg-neutral-900/70 border-neutral-800 hover:border-neutral-700'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-neutral-100 text-sm">{inst.label}</span>
                      {isActive && (
                        <span className="text-[10px] px-2 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono">
                          {t('instancesView.activeBadge')}
                        </span>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded ${inst.is_valid ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'}`}>{inst.is_valid ? t('instancesView.directoryValid') : t('instancesView.directoryInvalid')}</span>
                    </div>

                    <div className="font-mono text-xs text-neutral-300 bg-neutral-950/70 px-3 py-1.5 rounded-lg border border-neutral-800/80 break-all">
                      {inst.path_hint}
                    </div>

                    <div className="text-[11px] text-neutral-500">
                      {isAndroidInstance
                        ? (inst.is_valid ? t('instancesView.gameDirectoryVerified') : diagInfo?.summary)
                        : (inst.is_valid ? t('instancesView.gameDirectoryVerified') : t('instancesView.gameDirectoryMissing'))}
                    </div>
                    {isAndroidInstance && !inst.is_valid && diagInfo && (
                      <div className="mt-2 text-xs text-amber-300/90 bg-amber-950/40 border border-amber-800/40 rounded p-2">
                        {diagInfo.detail}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 self-end md:self-start">
                    {isActive ? (
                      <span className="text-xs text-emerald-400 font-mono flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{t('instancesView.inUse')}</span>
                      </span>
                    ) : (
                      <button disabled={!isAuthorized} onClick={() => void onSelectActive(inst.id)}
                        className="px-3 py-1.5 text-xs font-medium text-neutral-200 hover:text-white bg-neutral-800 hover:bg-neutral-700/80 rounded-lg transition-colors border border-neutral-700"
                      >
                        {t('instancesView.switchToActive')}
                      </button>
                    )}
                    {inst.id !== 'unverified' && !isAndroid && <button onClick={() => void onRemoveInstance(inst.id)} className="px-2 py-1.5 text-xs text-rose-300 hover:text-rose-200" title={t('instancesView.removeTitle')}>{t('instancesView.remove')}</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Mobile App Update Entry */}
        <div className="md:hidden p-4 rounded-xl border border-neutral-800 bg-neutral-900/60 space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-neutral-300">
            <span>{t('instancesView.appVersion')}</span>
            <span className="font-mono text-neutral-500">v{__APP_VERSION__}</span>
          </div>
          <p className="text-[11px] text-neutral-400">
            {t('instancesView.appUpdateHint')}
          </p>
          {onOpenAppUpdate && (
            <button
              type="button"
              onClick={onOpenAppUpdate}
              className={`w-full py-2 px-3 text-xs font-medium rounded-lg border transition-colors flex items-center justify-center gap-2 ${
                hasAppUpdate
                  ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300 hover:bg-emerald-600/30'
                  : 'bg-neutral-800 border-neutral-700 text-neutral-200 hover:bg-neutral-700'
              }`}
            >
              <span>{hasAppUpdate ? t('instancesView.newVersionAvailable') : t('instancesView.checkAppUpdate')}</span>
              {hasAppUpdate && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />}
            </button>
          )}
        </div>

      </div>

      {/* Add Custom Instance Modal */}
      {showAddModal && (
        <m.div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-xs select-none" variants={overlayVariants}>
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-lg max-h-[92dvh] sm:max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-3 sm:p-4 border-b border-neutral-800 flex items-center justify-between shrink-0">
              <h3 className="font-bold text-neutral-100 text-sm">{t('instancesView.addModalTitle')}</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-3 sm:p-4 space-y-3 text-xs overflow-y-auto grow">
              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  {t('instancesView.labelField')}
                </label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder={t('instancesView.labelPlaceholder')}
                  className="w-full px-3 py-2 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-200 focus:outline-hidden focus:border-neutral-500"
                />
              </div>

              <div>
                <label className="text-neutral-300 font-medium block mb-1">
                  {t('instancesView.pathField')}
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={newPath}
                    onChange={(e) => {
                      setNewPath(e.target.value);
                      setValidationError(null);
                    }}
                    placeholder={t('instancesView.pathPlaceholder')}
                    className="flex-1 px-3 py-2 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-200 font-mono focus:outline-hidden focus:border-neutral-500"
                  />
                  <button
                    onClick={() => void onBrowseDirectory().then((path) => { if (path) { setNewPath(path); setValidationError(null); } }).catch((error) => setValidationError(String(error)))}
                    className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg shrink-0 cursor-pointer text-center"
                  >
                    {t('instancesView.browse')}
                  </button>
                </div>
              </div>

              {validationError && (
                <div className="p-3 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-200 text-xs font-mono break-all">
                  {validationError}
                </div>
              )}

              <div className="text-neutral-400 text-[11px]">{t('instancesView.pathRequirement')}</div>
            </div>

            <div className="p-3 sm:p-4 border-t border-neutral-800 bg-neutral-950 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 text-xs shrink-0">
              <button
                onClick={() => setShowAddModal(false)}
                className="min-h-[38px] sm:min-h-0 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg cursor-pointer text-center"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => void handleCreate()}
                disabled={isAdding}
                className="min-h-[38px] sm:min-h-0 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg shadow-xs cursor-pointer text-center"
              >
                {t('instancesView.verifyAndAdd')}
              </button>
            </div>
          </div>
        </m.div>
      )}
    </div>
  );
};
