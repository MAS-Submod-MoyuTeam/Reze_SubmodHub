import React, { useState, useEffect } from 'react';
import { Wifi, Battery, Smartphone, Monitor } from 'lucide-react';

interface AndroidFrameProps {
  children: React.ReactNode;
  activeTab: string;
}

export const AndroidFrame: React.FC<AndroidFrameProps> = ({ children, activeTab }) => {
  const [time, setTime] = useState('09:41');
  const [isPhoneFrame, setIsPhoneFrame] = useState(true);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(
        now.toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-3 px-2 sm:px-4 bg-slate-950 font-sans">
      {/* Device Mode Switcher floating pill */}
      <div className="mb-3 flex items-center gap-2 bg-slate-900/90 border border-slate-800 rounded-full px-3 py-1.5 shadow-md">
        <span className="text-xs text-slate-400 font-medium mr-1">视图模式:</span>
        <button
          onClick={() => setIsPhoneFrame(true)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
            isPhoneFrame
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Smartphone className="w-3.5 h-3.5" />
          Android 手机视口 (412×915)
        </button>
        <button
          onClick={() => setIsPhoneFrame(false)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
            !isPhoneFrame
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Monitor className="w-3.5 h-3.5" />
          全屏触控平板模式
        </button>
      </div>

      {/* Main Container */}
      <div
        className={`relative transition-all duration-300 overflow-hidden flex flex-col bg-slate-900 text-slate-100 ${
          isPhoneFrame
            ? 'w-full max-w-[420px] h-[890px] rounded-[44px] ring-12 ring-slate-800 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] border border-slate-700/50'
            : 'w-full max-w-4xl h-[880px] rounded-3xl border border-slate-800 shadow-2xl'
        }`}
      >
        {/* Android Status Bar */}
        <div className="shrink-0 h-10 px-6 flex items-center justify-between text-xs font-medium text-slate-300 bg-slate-950/80 backdrop-blur-md select-none z-30 border-b border-slate-800/40">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-200 tracking-tight tabular-nums">{time}</span>
            <span className="text-[10px] text-emerald-400 font-mono">MAS-SAF</span>
          </div>

          {/* Front Camera Punch-hole if in phone mode */}
          {isPhoneFrame && (
            <div className="absolute left-1/2 -translate-x-1/2 top-2.5 w-3.5 h-3.5 rounded-full bg-black ring-1 ring-slate-700/80 flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-slate-900" />
            </div>
          )}

          <div className="flex items-center gap-2 text-slate-300">
            <span className="text-[11px] font-mono tracking-tighter text-slate-400">5G</span>
            <Wifi className="w-3.5 h-3.5 text-slate-300" />
            <div className="flex items-center gap-1">
              <span className="text-[10px] tabular-nums text-slate-400">92%</span>
              <Battery className="w-4 h-4 text-emerald-400" />
            </div>
          </div>
        </div>

        {/* Screen Content Viewport */}
        <div className="flex-1 relative overflow-hidden flex flex-col bg-slate-900">
          {children}
        </div>

        {/* Android Gesture Bar */}
        <div className="shrink-0 h-4 bg-slate-950/80 backdrop-blur-md flex items-center justify-center pointer-events-none select-none">
          <div className="w-32 h-1 bg-slate-600 rounded-full opacity-60" />
        </div>
      </div>
    </div>
  );
};
