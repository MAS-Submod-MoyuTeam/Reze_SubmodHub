import React from 'react';
import { useApp, NavTab } from '../context/AppContext';
import { User as UserIcon, Shield, Download } from 'lucide-react';

interface HeaderProps {
  onOpenLoginModal: () => void;
  onOpenClientDownload: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenLoginModal, onOpenClientDownload }) => {
  const {
    activeTab,
    setActiveTab,
    currentUser,
    logout,
  } = useApp();

  // 发布入口对所有已登录用户开放；审核和管理入口仅对管理员开放。
  // 这里不要再依赖旧的 author/reviewer 角色，否则普通登录用户无法提交模组。
  const navLinks: { id: NavTab; label: string }[] = [
    { id: 'catalog', label: '模组目录' },
    ...(currentUser ? [{ id: 'author' as NavTab, label: '发布' }] : []),
    ...(currentUser?.roles.includes('admin')
      ? [
          { id: 'reviewer' as NavTab, label: '审核' },
          { id: 'admin' as NavTab, label: '设置' },
        ]
      : []),
  ];

  const currentPersonaLabel = !currentUser
    ? '访客 (未登录)'
    : currentUser.roles.includes('admin')
    ? '管理员 (Admin)'
    : currentUser.roles.includes('reviewer')
    ? '审核员 (Reviewer)'
    : currentUser.roles.includes('author')
    ? '作者 (Author)'
    : '普通用户';

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-neutral-200 pt-[env(safe-area-inset-top,0px)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Zone 1: Single text element wordmark */}
        <div className="flex items-baseline gap-2 shrink-0">
          <button
            onClick={() => setActiveTab('catalog')}
            className="text-lg font-semibold tracking-tight text-neutral-950 hover:text-emerald-700 active:text-emerald-800 transition-colors shrink-0 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            RezeHub
          </button>
          <span
            className="hidden sm:inline text-[10px] font-mono text-neutral-400"
            title={`当前版本 v${__APP_VERSION__}`}
          >
            v{__APP_VERSION__}
          </span>
        </div>

        {/* Zone 2: 4-6 clean text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-neutral-600">
          {navLinks.map((link) => {
            const isActive = activeTab === link.id;
            return (
              <button
                key={link.id}
                onClick={() => setActiveTab(link.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative py-1 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
                  isActive
                    ? 'text-neutral-900 font-semibold'
                    : 'text-neutral-600 hover:text-neutral-900 active:text-neutral-950'
                }`}
              >
                {link.label}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1-2 primary actions */}
        <div className="flex items-center gap-2.5">
          <span className="hidden sm:flex items-center gap-1.5 text-xs text-neutral-600">
            <Shield className="w-3.5 h-3.5" />{currentPersonaLabel}
          </span>

          {/* Client download: secondary action, always available to visitors */}
          <button
            onClick={onOpenClientDownload}
            aria-label="下载客户端"
            title="下载 Windows / Android 客户端"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-neutral-800 bg-white border border-neutral-200 hover:bg-neutral-50 hover:border-neutral-300 active:bg-neutral-100 rounded transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            <Download className="w-3.5 h-3.5 text-neutral-500" />
            {/* 窄屏用短标签，避免只剩一个无人认识的图标 */}
            <span className="sm:hidden">下载</span>
            <span className="hidden sm:inline">下载客户端</span>
          </button>

          {/* Account Button */}
          {currentUser ? (
            <button
              onClick={onOpenLoginModal}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-800 bg-neutral-50 border border-neutral-200 hover:bg-neutral-100 hover:border-neutral-300 active:bg-neutral-200 rounded transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              <UserIcon className="w-3.5 h-3.5 text-neutral-500" />
              <span className="truncate max-w-[90px]">{currentUser.username}</span>
            </button>
          ) : (
            <button
              onClick={onOpenLoginModal}
              className="px-3 py-1.5 text-xs font-medium text-white bg-neutral-900 hover:bg-neutral-800 active:bg-neutral-950 rounded transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              登录
            </button>
          )}
        </div>
      </div>

      {/* Mobile nav bar fallback */}
      <div className="md:hidden flex items-center gap-1 overflow-x-auto px-4 py-1.5 border-t border-neutral-100 text-xs">
        {navLinks.map((link) => (
          <button
            key={link.id}
            onClick={() => setActiveTab(link.id)}
            aria-current={activeTab === link.id ? 'page' : undefined}
            className={`px-2.5 py-1 rounded whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${
              activeTab === link.id
                ? 'bg-neutral-900 text-white font-medium'
                : 'text-neutral-600 hover:bg-neutral-100 active:bg-neutral-200'
            }`}
          >
            {link.label}
          </button>
        ))}
      </div>
    </header>
  );
};
