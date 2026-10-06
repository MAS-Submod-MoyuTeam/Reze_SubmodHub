import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { LoginModal } from './components/LoginModal';
import { CatalogView } from './components/CatalogView';
import { ModDetailModal } from './components/ModDetailModal';
import { AuthorWorkbench } from './components/AuthorWorkbench';
import { ReviewerWorkbench } from './components/ReviewerWorkbench';
import { AdminPanel } from './components/AdminPanel';
import { ClientCompanion } from './components/ClientCompanion';
import { ToastContainer } from './components/ToastContainer';

const MainLayout: React.FC = () => {
  const {
    activeTab,
    detailModalModId,
    setDetailModalModId,
    showToast,
  } = useApp();

  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [downloadModalVersionId, setDownloadModalVersionId] = useState<string | null>(null);

  const handleSelectMod = (modId: string) => {
    setDetailModalModId(modId);
    setDownloadModalVersionId(null);
  };

  const handleOpenDownloadModal = (versionId: string) => {
    setDownloadModalVersionId(versionId);
    setDetailModalModId(null);
  };

  const handleTriggerClientPlan = (_modId: string, _versionId: string) => {
    showToast('warning', '客户端安装绑定尚未接入，未生成安装计划。');
  };

  return (
    <div className="min-h-screen bg-neutral-100/70 text-neutral-900 flex flex-col">
      {/* Strict 3-zone Header Contract */}
      <Header onOpenLoginModal={() => setIsLoginModalOpen(true)} />

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
        {activeTab === 'client' && <ClientCompanion />}
      </main>

      {/* Mod Detail & Download Descriptor Modal */}
      {(detailModalModId || downloadModalVersionId) && (
        <ModDetailModal
          modId={detailModalModId}
          downloadVersionId={downloadModalVersionId}
          onClose={() => {
            setDetailModalModId(null);
            setDownloadModalVersionId(null);
          }}
          onTriggerClientPlan={handleTriggerClientPlan}
        />
      )}

      {/* Auth & Identity Linking Modal */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
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
