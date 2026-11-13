import React from 'react';
import { ShieldAlert, ShieldCheck, RefreshCw, ExternalLink } from 'lucide-react';
import { useI18n } from '../i18n';

export interface StorageAccessBannerProps {
  isAndroid: boolean;
  storageState: 'granted' | 'denied' | 'unsupported' | 'error' | string;
  onRequestAccess: () => void;
  onRefreshStatus: () => void;
  isRefreshing?: boolean;
}

export const StorageAccessBanner: React.FC<StorageAccessBannerProps> = ({
  isAndroid,
  storageState,
  onRequestAccess,
  onRefreshStatus,
  isRefreshing = false,
}) => {
  const { t } = useI18n();
  if (!isAndroid || storageState === 'granted') {
    return null;
  }

  if (storageState === 'unsupported') {
    return (
      <div className="bg-amber-950/60 border border-amber-800/80 rounded-lg p-3 mx-3 sm:mx-4 my-2 text-amber-200 text-xs flex items-center gap-2.5">
        <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
        <div>
          <span className="font-semibold">{t('storage.banner.unsupportedTitle')}</span>
          <span>{t('storage.banner.unsupportedBody')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-red-950/70 border border-red-800/80 rounded-lg p-3 mx-3 sm:mx-4 my-2 text-red-100 shadow-md">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div className="text-xs space-y-0.5">
            <div className="font-medium text-red-200 flex items-center gap-1.5 flex-wrap">
              <span>{t('storage.banner.permissionTitle')}</span>
              <span className="px-1.5 py-0.2 bg-red-900/80 rounded text-[10px] text-red-300 font-mono">
                MANAGE_EXTERNAL_STORAGE
              </span>
            </div>
            <p className="text-red-300/90 leading-relaxed">
              {t('storage.banner.permissionBody')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 self-end sm:self-center w-full sm:w-auto justify-end">
          <button
            type="button"
            onClick={onRefreshStatus}
            disabled={isRefreshing}
            className="min-h-[38px] sm:min-h-0 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium flex items-center justify-center gap-1 transition-colors border border-zinc-700 disabled:opacity-50 cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
            title={t('storage.banner.recheckTitle')}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{t('storage.banner.refresh')}</span>
          </button>

          <button
            type="button"
            onClick={onRequestAccess}
            className="min-h-[38px] sm:min-h-0 px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium flex items-center justify-center gap-1 transition-colors shadow-sm cursor-pointer active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{t('storage.banner.grant')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
