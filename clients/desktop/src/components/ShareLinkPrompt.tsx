import React from 'react';
import { Link2, X } from 'lucide-react';

interface ShareLinkPromptProps {
  /** 提示里显示的名称（通常是模组标题，查不到才是 mod id）。 */
  label: string;
  onOpen: () => void;
  onDismiss: () => void;
}

/**
 * 「剪贴板里有一条站内链接」的提示。
 *
 * 有意做成非模态条：它打断的是一个用户没主动发起的流程（复制发生在浏览器里，
 * 他只是切回了客户端），所以不该夺走焦点、不该拦住其它操作。放在底部，
 * 与 toast 同一水平区域，但左对齐以免和 toast 抢位置。
 */
export const ShareLinkPrompt: React.FC<ShareLinkPromptProps> = ({ label, onOpen, onDismiss }) => (
  <div
    role="status"
    className="absolute bottom-4 left-4 right-4 sm:right-auto sm:max-w-md z-50 px-4 py-3 rounded-lg bg-neutral-900 border border-sky-500/60 shadow-xl text-xs text-neutral-100 flex items-start gap-2.5 animate-in fade-in slide-in-from-bottom-2 duration-150"
  >
    <Link2 className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
    <div className="min-w-0 flex-1 space-y-2">
      <p className="leading-relaxed break-words">
        剪贴板里有一条站内链接：<span className="font-semibold text-white">{label}</span>
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="px-3 py-1.5 rounded bg-sky-500 hover:bg-sky-400 text-neutral-950 font-medium transition-colors"
        >
          打开
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="px-3 py-1.5 rounded border border-neutral-700 hover:border-neutral-500 text-neutral-300 transition-colors"
        >
          忽略
        </button>
      </div>
    </div>
    <button
      type="button"
      onClick={onDismiss}
      aria-label="忽略这条提示"
      className="text-neutral-500 hover:text-neutral-300 p-0.5 shrink-0"
    >
      <X className="w-3.5 h-3.5" />
    </button>
  </div>
);
