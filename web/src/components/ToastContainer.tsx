import React from 'react';
import { useApp } from '../context/AppContext';
import { AlertCircle, CheckCircle2, Info, AlertTriangle, X } from 'lucide-react';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-md w-full pointer-events-none">
      {toasts.map((toast) => {
        const icons = {
          success: <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />,
          error: <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />,
          warning: <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />,
          info: <Info className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />,
        };

        const borders = {
          success: 'border-emerald-200 bg-white shadow-sm',
          error: 'border-rose-200 bg-white shadow-sm',
          warning: 'border-amber-200 bg-white shadow-sm',
          info: 'border-sky-200 bg-white shadow-sm',
        };

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start justify-between gap-3 p-3.5 rounded-lg border ${borders[toast.type]} transition-all animate-in fade-in slide-in-from-bottom-2`}
          >
            <div className="flex items-start gap-2.5">
              {icons[toast.type]}
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
              onClick={() => removeToast(toast.id)}
              className="text-neutral-400 hover:text-neutral-600 p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
