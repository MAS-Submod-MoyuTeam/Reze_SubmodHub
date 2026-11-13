import React from 'react';
import { useApp } from '../context/AppContext';
import { AlertCircle, CheckCircle2, Info, AlertTriangle, X } from 'lucide-react';
import { AnimatePresence, m } from './Motion';
import { toastVariants } from '../../../ui/motion-presets';
import { useI18n } from '../i18n';

type ToastTone = 'success' | 'error' | 'warning' | 'info';

/** 只用到提示条自身需要的字段，避免为了一个类型把 context 的内部结构导出。 */
interface VisibleToast {
  id: string;
  type: ToastTone;
  message: string;
  code?: string;
}

const ICONS: Record<ToastTone, React.ReactNode> = {
  success: <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />,
  error: <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />,
  warning: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />,
  info: <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />,
};

const BORDERS: Record<ToastTone, string> = {
  success: 'border-emerald-200 bg-white shadow-sm',
  error: 'border-rose-200 bg-white shadow-sm',
  warning: 'border-amber-200 bg-white shadow-sm',
  info: 'border-sky-200 bg-white shadow-sm',
};

/**
 * 右下角提示条。
 *
 * 提示从 context 的 `toasts` 里消失得比退出动画快：`removeToast` 一执行条目就没了。
 * `AnimatePresence` 会自己把「已经不在列表里」的子节点留到退场动画结束，
 * 所以这里不再维护 `leaving` 副本，也不再需要计时器。
 *
 * 窄屏（360px 的 Android 竖屏）上容器用左右各 4 的内边距而不是 `right-5 + w-full`：
 * 后者会让整条提示向左溢出视口。
 */
export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useApp();
  const { t } = useI18n();

  return (
    <div
      className="pointer-events-none fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))] left-4 right-4 z-50 flex flex-col gap-2 sm:left-auto sm:right-5 sm:w-full sm:max-w-md"
      role="region"
      aria-label={t('toast.regionLabel')}
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <m.div
            key={toast.id}
            variants={toastVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className={`pointer-events-auto flex items-start justify-between gap-3 p-3.5 rounded-lg border ${BORDERS[toast.type]}`}
          >
            <div className="flex items-start gap-2.5">
              {ICONS[toast.type]}
              <div>
                {toast.code && (
                  <span className="block text-[11px] font-mono font-medium text-neutral-500 uppercase tracking-wider mb-0.5">
                    {toast.code}
                  </span>
                )}
                <p className="text-xs text-neutral-800 leading-relaxed">{toast.message}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              aria-label={t('toast.dismiss')}
              className="text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200 p-1 -m-0.5 rounded transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
