import React from 'react';
import { Loader2 } from 'lucide-react';

export interface InstanceSwitchOverlayProps {
  /** 正在进行的实例操作，例如「正在切换到「MAS 副本」」。 */
  title: string;
  /** 说明冻结期间在做什么，或为什么不能操作。 */
  detail?: string;
}

/**
 * 实例切换是整屏级别的数据替换：切换没结束前，屏幕上的模组、精灵包与事务仍属于旧实例。
 * 这层全窗口覆盖同时承担两件事——挡住对背景界面的点击，并明确告诉用户正在读哪个实例。
 * 键盘可达性由调用方冻结背景子树（`inert`）负责，这里只提供一条可朗读的状态。
 */
export const InstanceSwitchOverlay: React.FC<InstanceSwitchOverlayProps> = ({ title, detail }) => (
  <div
    role="status"
    aria-live="polite"
    data-testid="instance-switch-overlay"
    className="wails-no-drag fixed inset-0 z-[100] flex cursor-wait select-none items-center justify-center bg-neutral-950/85 p-4 backdrop-blur-sm animate-in fade-in duration-150"
  >
    <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-xl border border-neutral-700/80 bg-neutral-900 px-6 py-5 text-center shadow-2xl">
      <Loader2 className="h-6 w-6 animate-spin text-emerald-400" aria-hidden="true" />
      <p className="break-words text-sm font-semibold text-neutral-100">{title}</p>
      {detail && <p className="break-words text-xs leading-relaxed text-neutral-400">{detail}</p>}
    </div>
  </div>
);
