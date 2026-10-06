import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { X, Lock, Github, CheckCircle2, Shield, Link2, LogOut } from 'lucide-react';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, loginFlarum, loginGithub, logout, linkAccount } = useApp();

  const [flarumUsername, setFlarumUsername] = useState('');
  const [flarumPassword, setFlarumPassword] = useState('');
  const [linkInput, setLinkInput] = useState('');
  const [linkingProvider, setLinkingProvider] = useState<'flarum' | 'github' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleFlarumLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flarumUsername.trim()) return;
    setIsSubmitting(true);
    const success = await loginFlarum(flarumUsername, flarumPassword);
    setIsSubmitting(false);
    if (success) onClose();
  };

  const handleGithubOAuth = async () => {
    setIsSubmitting(true);
    const success = await loginGithub();
    setIsSubmitting(false);
    if (success) onClose();
  };

  const handleStartLinking = (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkingProvider || !linkInput.trim()) return;
    linkAccount(linkingProvider, linkInput.trim());
    setLinkingProvider(null);
    setLinkInput('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
      <div className="bg-white rounded-lg border border-neutral-200 shadow-xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-emerald-700" />
            <h3 className="text-sm font-semibold text-neutral-900">
              {currentUser ? '当前会话与账号关联' : '登录 SubmodHub'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 p-1 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-5">
          {currentUser ? (
            /* Logged in state & Account Linking (Section 1) */
            <div className="space-y-4">
              <div className="p-3.5 bg-neutral-50 rounded border border-neutral-200 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-900">{currentUser.display_name}</span>
                  <span className="text-[11px] font-mono text-neutral-500">ID: {currentUser.id}</span>
                </div>
                <div className="text-xs text-neutral-500 flex items-center gap-2">
                  <span>角色权限:</span>
                  <span className="font-mono text-neutral-800">{currentUser.roles.join(', ')}</span>
                </div>
              </div>

              {/* Linked Accounts Info */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-neutral-700 flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5 text-neutral-500" />
                  第三方账号绑定状态
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between p-2.5 rounded border border-neutral-100 bg-neutral-50/50">
                    <span className="text-neutral-600">Flarum 社区论坛</span>
                    {currentUser.linked_accounts.flarum ? (
                      <span className="text-emerald-700 font-medium flex items-center gap-1 font-mono">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {currentUser.linked_accounts.flarum}
                      </span>
                    ) : (
                      <button
                        onClick={() => setLinkingProvider('flarum')}
                        className="text-xs text-emerald-700 hover:underline font-medium"
                      >
                        + 绑定 Flarum
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between p-2.5 rounded border border-neutral-100 bg-neutral-50/50">
                    <span className="text-neutral-600">GitHub 账号</span>
                    {currentUser.linked_accounts.github ? (
                      <span className="text-emerald-700 font-medium flex items-center gap-1 font-mono">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {currentUser.linked_accounts.github}
                      </span>
                    ) : (
                      <button
                        onClick={() => setLinkingProvider('github')}
                        className="text-xs text-emerald-700 hover:underline font-medium"
                      >
                        + 绑定 GitHub
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Linking Form if opened */}
              {linkingProvider && (
                <form
                  onSubmit={handleStartLinking}
                  className="p-3 bg-neutral-50 border border-neutral-200 rounded space-y-2.5"
                >
                  <div className="text-xs font-medium text-neutral-800">
                    绑定 {linkingProvider === 'github' ? 'GitHub' : 'Flarum'} 账号
                  </div>
                  <input
                    type="text"
                    required
                    placeholder={linkingProvider === 'github' ? '输入 GitHub 用户名' : '输入 Flarum 论坛用户名'}
                    value={linkInput}
                    onChange={(e) => setLinkInput(e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600 bg-white"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setLinkingProvider(null)}
                      className="px-2.5 py-1 text-xs text-neutral-600 hover:text-neutral-900"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded"
                    >
                      确认关联
                    </button>
                  </div>
                </form>
              )}

              <div className="pt-2 border-t border-neutral-100 flex items-center justify-between">
                <span className="text-[11px] text-neutral-400">CSRF 保护已启用 · Cookie 会话</span>
                <button
                  onClick={() => {
                    logout();
                    onClose();
                  }}
                  className="px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 rounded border border-rose-200 flex items-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  退出当前会话
                </button>
              </div>
            </div>
          ) : (
            /* Not logged in: Choice of Flarum or GitHub (Section 1) */
            <div className="space-y-4">
              <p className="text-xs text-neutral-600 leading-relaxed">
                访客无需登录即可自由浏览目录与下载模组。作者、审核员和管理员请通过下方途径登录。
              </p>

              {/* GitHub OAuth Button */}
              <button
                type="button"
                onClick={handleGithubOAuth}
                disabled={isSubmitting}
                className="w-full py-2.5 px-3 rounded border border-neutral-300 hover:border-neutral-400 bg-neutral-900 text-white text-xs font-medium flex items-center justify-center gap-2 transition-colors"
              >
                <Github className="w-4 h-4" />
                使用 GitHub OAuth 登录 (PKCE 流程)
              </button>

              <div className="relative my-3 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-neutral-200" />
                </div>
                <span className="relative bg-white px-2 text-[11px] text-neutral-400">
                  或者使用 Flarum 论坛凭据
                </span>
              </div>

              {/* Flarum Proxy Form */}
              <form onSubmit={handleFlarumLogin} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Flarum 用户名 / 邮箱
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="例如: MonikaFan"
                    value={flarumUsername}
                    onChange={(e) => setFlarumUsername(e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    密码 (密码仅由服务端代验，不回显)
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={flarumPassword}
                    onChange={(e) => setFlarumPassword(e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2 px-3 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium transition-colors"
                >
                  {isSubmitting ? '正在验证凭据...' : 'Flarum 服务端安全登录'}
                </button>
              </form>

              <div className="p-2.5 bg-neutral-50 rounded border border-neutral-100 text-[11px] text-neutral-500 leading-relaxed flex items-start gap-1.5">
                <Shield className="w-3.5 h-3.5 text-neutral-400 shrink-0 mt-0.5" />
                <span>
                  账号关联仅可在登录后主动发起。不同角色在界面中即时刷新展示，服务端仍独立做权限校验。
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
