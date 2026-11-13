import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { X, Lock, Shield, LogOut } from 'lucide-react';
import { AnimatePresence, m } from './Motion';
import { overlayVariants, panelVariants } from '../../../ui/motion-presets';
import { useI18n } from '../i18n';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose }) => {
  const { currentUser, loginFlarum, logout } = useApp();
  const { t } = useI18n();

  const [flarumUsername, setFlarumUsername] = useState('');
  const [flarumPassword, setFlarumPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handleFlarumLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flarumUsername.trim()) return;
    setIsSubmitting(true);
    const success = await loginFlarum(flarumUsername, flarumPassword);
    setIsSubmitting(false);
    if (success) onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <m.div
          variants={overlayVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
        >
          <m.div
            variants={panelVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            className="bg-white rounded-lg border border-neutral-200 shadow-xl max-w-md w-full overflow-hidden"
          >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-emerald-700" />
            <h3 className="text-sm font-semibold text-neutral-900">
              {currentUser ? t('login.session') : t('login.title')}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-600 p-1 rounded active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-5">
          {currentUser ? (
            /* Logged in session state (Section 1) */
            <div className="space-y-4">
              <div className="p-3.5 bg-neutral-50 rounded border border-neutral-200 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-900">{currentUser.display_name}</span>
                  <span className="text-[11px] font-mono text-neutral-500">ID: {currentUser.id}</span>
                </div>
                <div className="text-xs text-neutral-500 flex items-center gap-2">
                  <span>{t('login.roleLabel')}</span>
                  <span className="font-mono text-neutral-800">{currentUser.roles.join(', ')}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-neutral-100 flex items-center justify-between">
                <span className="text-[11px] text-neutral-400">{t('login.csrfNote')}</span>
                <button
                  onClick={() => {
                    logout();
                    onClose();
                  }}
                  className="px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 rounded border border-rose-200 flex items-center gap-1.5 active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  {t('login.logout')}
                </button>
              </div>
            </div>
          ) : (
            /* Not logged in: Flarum credentials only (Section 1) */
            <div className="space-y-4">
              <p className="text-xs text-neutral-600 leading-relaxed">
                {t('login.intro')}
              </p>

              {/* Flarum Proxy Form */}
              <form onSubmit={handleFlarumLogin} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    {t('login.username')}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={t('login.usernamePlaceholder')}
                    value={flarumUsername}
                    onChange={(e) => setFlarumUsername(e.target.value)}
                    className="w-full text-xs px-2.5 py-1.5 rounded border border-neutral-300 focus:outline-none focus:border-emerald-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    {t('login.password')}
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
                  className="w-full py-2 px-3 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium transition-colors active:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                >
                  {isSubmitting ? t('login.submitting') : t('login.submit')}
                </button>
              </form>

              <div className="p-2.5 bg-neutral-50 rounded border border-neutral-100 text-[11px] text-neutral-500 leading-relaxed flex items-start gap-1.5">
                <Shield className="w-3.5 h-3.5 text-neutral-400 shrink-0 mt-0.5" />
                <span>{t('login.roleNote')}</span>
              </div>
            </div>
          )}
        </div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
};
