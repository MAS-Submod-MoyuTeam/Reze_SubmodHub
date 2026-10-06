import React, { useState } from 'react';
import { ShieldCheck, UserRoundCog } from 'lucide-react';
import { getFlarumUserRoles, readSession, setFlarumUserRoles } from '../../../ui/auth-api';
import { useApp } from '../context/AppContext';

export const AdminPanel: React.FC = () => {
  const { hasRole, showToast } = useApp();
  const [userID, setUserID] = useState('');
  const [author, setAuthor] = useState(false);
  const [reviewer, setReviewer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<{ id: string; roles: string[] } | null>(null);
  const [loadingRoles, setLoadingRoles] = useState(false);

  if (!hasRole('admin')) {
    return <div className="max-w-4xl mx-auto px-4 py-16 text-sm text-neutral-600">需要管理员权限。</div>;
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      const session = await readSession(base);
      if (!session.roles.includes('admin')) throw new Error('forbidden');
      const roles: Array<'author' | 'reviewer'> = [];
      if (author) roles.push('author');
      if (reviewer) roles.push('reviewer');
      const result = await setFlarumUserRoles(userID.trim(), roles, session.csrf_token, base);
      setLastSaved({ id: result.user_id, roles: result.roles });
      showToast('success', '角色设置已保存。');
    } catch (error) {
      showToast('error', `角色设置失败：${error instanceof Error ? error.message : 'unknown_error'}`);
    } finally {
      setSaving(false);
    }
  };

  const loadRoles = async () => {
    if (loadingRoles || !/^[1-9]\d*$/.test(userID.trim())) return;
    setLoadingRoles(true);
    try {
      const base = `${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
      const session = await readSession(base);
      if (!session.roles.includes('admin')) throw new Error('forbidden');
      const result = await getFlarumUserRoles(userID.trim(), base);
      setAuthor(result.roles.includes('author'));
      setReviewer(result.roles.includes('reviewer'));
      setLastSaved({ id: result.user_id, roles: result.roles });
    } catch (error) {
      showToast('error', `读取角色失败：${error instanceof Error ? error.message : 'unknown_error'}`);
    } finally {
      setLoadingRoles(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="border-b border-neutral-200 pb-4">
        <div className="flex items-center gap-2 text-emerald-700 text-xs font-semibold">
          <ShieldCheck className="w-4 h-4" /> 管理员
        </div>
        <h1 className="text-lg font-bold text-neutral-900 mt-1">用户角色</h1>
      </div>
      <form onSubmit={(event) => void submit(event)} className="max-w-xl bg-white border border-neutral-200 rounded-lg p-5 space-y-5">
        <div className="flex items-center gap-2 border-b border-neutral-100 pb-3">
          <UserRoundCog className="w-4 h-4 text-neutral-600" />
          <h2 className="text-sm font-semibold text-neutral-900">Flarum 用户授权</h2>
        </div>
        <label className="block space-y-1.5 text-xs font-medium text-neutral-700">
          <span>Flarum 数字用户 ID</span>
          <input
            value={userID}
            onChange={(event) => setUserID(event.target.value)}
            inputMode="numeric"
            pattern="[1-9][0-9]*"
            required
            className="w-full rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:border-emerald-600"
          />
          <button type="button" onClick={() => void loadRoles()} disabled={loadingRoles || !/^[1-9]\d*$/.test(userID.trim())} className="text-xs text-emerald-700 disabled:text-neutral-400">{loadingRoles ? '读取中' : '读取现有角色'}</button>
        </label>
        <div className="space-y-2 text-sm text-neutral-800">
          <label className="flex items-center gap-2"><input type="checkbox" checked={author} onChange={(event) => setAuthor(event.target.checked)} className="accent-emerald-700" />作者</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={reviewer} onChange={(event) => setReviewer(event.target.checked)} className="accent-emerald-700" />审核员</label>
        </div>
        <p className="text-xs text-neutral-500">不勾选任何角色并保存，将撤销该用户的作者和审核员授权。管理员权限仅由已配置的 Flarum 组决定。</p>
        <button disabled={saving} className="px-4 py-2 rounded bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-semibold">
          {saving ? '保存中' : '保存角色'}
        </button>
        {lastSaved && <p className="text-xs text-emerald-800" role="status">{lastSaved.id}：{lastSaved.roles.length ? lastSaved.roles.join('、') : '无附加角色'}</p>}
      </form>
    </div>
  );
};
