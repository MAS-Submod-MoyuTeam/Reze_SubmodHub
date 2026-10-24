import React, { useState } from 'react';
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

const MainLayout: React.FC = () => {
  const {
    activeTab,
    detailModalModId,
    setDetailModalModId,
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
          onClose={() => {
            setDetailModalModId(null);
            setDownloadModalVersionId(null);
          }}
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
