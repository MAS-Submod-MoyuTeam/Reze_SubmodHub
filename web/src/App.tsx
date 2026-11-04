import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { LoginModal } from './components/LoginModal';
import { CatalogView } from './components/CatalogView';
import { ModDetailModal } from './components/ModDetailModal';
import { AuthorWorkbench } from './components/AuthorWorkbench';
import { ReviewerWorkbench } from './components/ReviewerWorkbench';
import { AdminPanel } from './components/AdminPanel';
import { ClientDownloadModal } from './components/ClientDownloadModal';
import { ToastContainer } from './components/ToastContainer';
import { historyActionFor, modIDFromLocation } from './modRoute';

const MainLayout: React.FC = () => {
  const {
    activeTab,
    detailModalModId,
    setDetailModalModId,
    showToast,
  } = useApp();

  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isClientDownloadOpen, setIsClientDownloadOpen] = useState(false);
  const [downloadModalVersionId, setDownloadModalVersionId] = useState<string | null>(null);

  const handleSelectMod = (modId: string) => {
    setDetailModalModId(modId);
    setDownloadModalVersionId(null);
  };

  const handleOpenDownloadModal = (versionId: string) => {
    setDownloadModalVersionId(versionId);
    setDetailModalModId(null);
  };

  /**
   * 地址是「详情是否打开」的第二个表示：`/mod/<id>` 就是打开着。
   *
   * 挂载时先按地址决定首屏（分享链接直接落到详情），之后每次弹窗状态变化把地址
   * 同步过去，「后退」也就自然等于关闭详情。动历史的三种方式（push / back /
   * replace）由 modRoute 决定，这里只负责执行。
   */
  const initialModIDRef = useRef<string | null>(modIDFromLocation(window.location));
  const appliedInitialRef = useRef(false);

  // 首屏：地址里有 mod 就直接打开它。只做一次，之后由用户操作驱动。
  useEffect(() => {
    if (appliedInitialRef.current) return;
    appliedInitialRef.current = true;
    const initial = initialModIDRef.current;
    if (initial) setDetailModalModId(initial);
  }, [setDetailModalModId]);

  // 记录我们是否已经在等一次自己发起的 back()：popstate 会跟着到达，
  // 那时不该再把详情「按地址」重新打开一遍。
  const closingViaBackRef = useRef(false);

  useEffect(() => {
    // 历史状态在 `history.state` 上，不在 `location` 上：只有前者能告诉我们
    // 「当前这条历史是不是我们自己压出来的」。
    const action = historyActionFor(detailModalModId, {
      pathname: window.location.pathname,
      state: window.history.state,
    });
    if (action.kind === 'push') {
      window.history.pushState(action.state, '', action.path);
      return;
    }
    if (action.kind === 'back') {
      closingViaBackRef.current = true;
      window.history.back();
      return;
    }
    if (action.kind === 'replace') {
      window.history.replaceState(null, '', action.path);
    }
  }, [detailModalModId]);

  // 浏览器前进/后退反过来驱动弹窗：地址是唯一真相，弹窗跟着它走。
  useEffect(() => {
    const onPopState = () => {
      // 我们自己 back() 出来的那一次已经由上面的状态更新处理过了。
      if (closingViaBackRef.current) {
        closingViaBackRef.current = false;
        return;
      }
      setDetailModalModId(modIDFromLocation(window.location));
      setDownloadModalVersionId(null);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [setDetailModalModId]);

  const handleDetailClosed = useCallback(() => {
    setDetailModalModId(null);
    setDownloadModalVersionId(null);
  }, [setDetailModalModId]);

  return (
    <div className="min-h-screen bg-neutral-100/70 text-neutral-900 flex flex-col">
      {/* Strict 3-zone Header Contract */}
      <Header
        onOpenLoginModal={() => setIsLoginModalOpen(true)}
        onOpenClientDownload={() => setIsClientDownloadOpen(true)}
      />

      {/* Main Viewport */}
      <main className="flex-1 pb-12">
        {activeTab === 'catalog' && (
          <CatalogView
            onSelectMod={handleSelectMod}
            onOpenDownloadModal={handleOpenDownloadModal}
          />
        )}
        {activeTab === 'author' && <AuthorWorkbench />}
        {activeTab === 'reviewer' && <ReviewerWorkbench />}
        {activeTab === 'admin' && <AdminPanel />}
      </main>

      {/* Mod Detail & Download Descriptor Modal */}
      {(detailModalModId || downloadModalVersionId) && (
        <ModDetailModal
          modId={detailModalModId}
          downloadVersionId={downloadModalVersionId}
          onClose={handleDetailClosed}
          onOpenClientDownload={() => setIsClientDownloadOpen(true)}
          onNotify={(message) => showToast('info', message)}
        />
      )}

      {/* Auth & Identity Linking Modal */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
      />

      {/* Client download (site node first, GitHub Releases as fallback) */}
      <ClientDownloadModal
        isOpen={isClientDownloadOpen}
        onClose={() => setIsClientDownloadOpen(false)}
      />

      {/* Global Toast Container */}
      <ToastContainer />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}
