/**
 * 令牌卡片里的一行用量统计。
 *
 * 两个数字口径不同，所以各自单独标注，不互相换算：
 * - 「近 1 小时请求」= 本进程滚动 60 分钟的计数（含不收费的 304）；
 * - 「官方配额已用」= GitHub 在最近一次响应里回报的窗口用量（也含共用同一把令牌的
 *   其他服务）。
 *
 * 没有新到配额时显示「等待下一次回源」而不是 0：0 会让人以为这一小时真的没花配额。
 */
import React from 'react';
import { Activity, Gauge } from 'lucide-react';
import type { GitHubTokenUsage } from '../../../ui/settings-api';
import { useI18n } from '../i18n';

/** 观测时间距现在多少分钟。时钟偏差导致的未来时间按 0 处理，免得显示成负数。 */
const minutesSince = (iso: string): number | null => {
  const observed = Date.parse(iso);
  if (Number.isNaN(observed)) return null;
  return Math.max(0, Math.round((Date.now() - observed) / 60000));
};

export const GitHubTokenUsageRow: React.FC<{ usage: GitHubTokenUsage }> = ({ usage }) => {
  const { t } = useI18n();
  const observedMinutes = usage.rate_limit ? minutesSince(usage.rate_limit.observed_at) : null;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-200/70 pt-2 text-[11px] text-neutral-500">
      <span className="inline-flex items-center gap-1">
        <Activity className="w-3.5 h-3.5 shrink-0 text-neutral-400" />
        {t('admin.tokenUsageRequests', { count: String(usage.requests_last_hour) })}
      </span>
      {usage.rate_limit ? (
        <>
          <span className="inline-flex items-center gap-1">
            <Gauge className="w-3.5 h-3.5 shrink-0 text-neutral-400" />
            {t('admin.tokenUsageQuota', {
              used: String(usage.rate_limit.used),
              limit: String(usage.rate_limit.limit),
            })}
          </span>
          {observedMinutes !== null && (
            <span className="text-neutral-400">
              {t('admin.tokenUsageObserved', { minutes: String(observedMinutes) })}
            </span>
          )}
        </>
      ) : (
        <span className="text-neutral-400">{t('admin.tokenUsageNoQuota')}</span>
      )}
    </div>
  );
};
