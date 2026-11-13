import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useI18n } from '../i18n';

interface DeprecationNoticeProps {
  deprecated?: boolean;
  reason?: string;
}

export function DeprecationNotice({ deprecated, reason }: DeprecationNoticeProps) {
  // 这段提示出现在版本列表里，切英文后仍是中文；字典里早有 deprecation.* 键。
  const { t } = useI18n();
  if (!deprecated) return null;
  return (
    <aside aria-label={t('deprecation.ariaLabel')} className="border-l-2 border-amber-500 bg-amber-50/70 px-3 py-2 text-xs text-amber-950">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden="true" />
        <div className="min-w-0">
          <strong className="font-semibold">{t('deprecation.label')}</strong>
          <p className="mt-0.5 whitespace-pre-wrap break-words">{reason?.trim() || t('deprecation.reasonMissing')}</p>
        </div>
      </div>
    </aside>
  );
}
