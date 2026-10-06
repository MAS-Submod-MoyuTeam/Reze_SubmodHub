import { AlertTriangle } from 'lucide-react';

interface DeprecationNoticeProps {
  deprecated?: boolean;
  reason?: string;
}

export function DeprecationNotice({ deprecated, reason }: DeprecationNoticeProps) {
  if (!deprecated) return null;
  return (
    <aside aria-label="不推荐使用" className="border-l-2 border-amber-500 bg-amber-50/70 px-3 py-2 text-xs text-amber-950">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden="true" />
        <div className="min-w-0">
          <strong className="font-semibold">不推荐使用</strong>
          <p className="mt-0.5 whitespace-pre-wrap break-words">{reason?.trim() || '未提供原因'}</p>
        </div>
      </div>
    </aside>
  );
}
