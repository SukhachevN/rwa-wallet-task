import React, { Suspense, useEffect, useRef, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useNavigate, Outlet } from 'react-router-dom';
import { Header } from './components/layout/Header';
import { Footer } from './components/layout/Footer';
import { DashboardLayout } from './components/layout/DashboardLayout';
import { Loader } from 'lucide-react';
import { Toaster } from 'sonner';
import { useAuthStore } from './store/authStore';
import { AuthModal } from './components/AuthModal';
import { useMockDataStore } from './store/mockDataStore';
import { useValidatorStore } from './store/validatorStore';

// Lazy load all pages
const HomePage = React.lazy(() => import('./pages/HomePage'));
const AssetExplorerPage = React.lazy(() => import('./pages/explorer/AssetExplorerPage'));
const TokenizePage = React.lazy(() => import('./pages/tokenize/TokenizePage'));
const DashboardPage = React.lazy(() => import('./pages/dashboard/DashboardPage'));
const ProfilePage = React.lazy(() => import('./pages/profile/ProfilePage'));
const ValidatorsPage = React.lazy(() => import('./pages/ValidatorsPage'));
const MarketplacePage = React.lazy(() => import('./pages/MarketplacePage'));
const CommunityPage = React.lazy(() => import('./pages/CommunityPage'));
const AssetDetailPage = React.lazy(() => import('./pages/AssetDetailPage'));
const MyAssetsPage = React.lazy(() => import('./pages/MyAssetsPage'));

// Loading component
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="flex flex-col items-center gap-4">
      <Loader className="w-8 h-8 text-primary-600 animate-spin" />
      <p className="text-gray-600">Loading...</p>
    </div>
  </div>
);

function RequireAuth() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const openAuthModal = useAuthStore((state) => state.openAuthModal);
  const [hydrated, setHydrated] = useState(() => useAuthStore.persist.hasHydrated());

  useEffect(() => {
    if (useAuthStore.persist.hasHydrated()) {
      setHydrated(true);
    }
    return useAuthStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      openAuthModal();
    }
  }, [hydrated, isAuthenticated, openAuthModal]);

  if (!hydrated) {
    return <PageLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

function GlobalAuthModal() {
  const authModalOpen = useAuthStore((state) => state.authModalOpen);
  const closeAuthModal = useAuthStore((state) => state.closeAuthModal);
  return <AuthModal isOpen={authModalOpen} onClose={closeAuthModal} />;
}

function RedirectAfterAuth() {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [hydrated, setHydrated] = useState(() => useAuthStore.persist.hasHydrated());
  const wasAuthenticated = useRef<boolean | null>(null);

  useEffect(() => {
    if (useAuthStore.persist.hasHydrated()) {
      setHydrated(true);
    }
    return useAuthStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    if (wasAuthenticated.current === null) {
      wasAuthenticated.current = isAuthenticated;
      return;
    }
    if (!wasAuthenticated.current && isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
    wasAuthenticated.current = isAuthenticated;
  }, [hydrated, isAuthenticated, navigate]);

  return null;
}

function BootstrapApiData() {
  const fetchAssets = useMockDataStore((state) => state.fetchAssets);
  const fetchValidators = useValidatorStore((state) => state.fetchValidators);

  useEffect(() => {
    (async () => {
      await fetchAssets();
      await fetchValidators();
    })();
  }, [fetchAssets, fetchValidators]);

  return null;
}

function App() {
  return (
    <Router>
      <BootstrapApiData />
      <RedirectAfterAuth />
      <GlobalAuthModal />
      <Toaster position="top-right" />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Public routes with standard layout */}
          <Route path="/" element={
            <div className="flex flex-col min-h-screen">
              <main className="flex-grow bg-neutral-50">
                <HomePage />
              </main>
              <Footer />
            </div>
          } />
          <Route path="/marketplace" element={
            <div className="flex flex-col min-h-screen">
              <Header />
              <main className="flex-grow bg-neutral-50">
                <MarketplacePage />
              </main>
              <Footer />
            </div>
          } />
          <Route path="/asset/:id" element={
            <div className="flex flex-col min-h-screen">
              <Header />
              <main className="flex-grow bg-neutral-50">
                <AssetDetailPage />
              </main>
              <Footer />
            </div>
          } />
          <Route path="/community" element={
            <div className="flex flex-col min-h-screen">
              <Header />
              <main className="flex-grow bg-neutral-50">
                <CommunityPage />
              </main>
              <Footer />
            </div>
          } />
          
          {/* Dashboard layout routes */}
          <Route element={<RequireAuth />}>
            <Route element={<DashboardLayout />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/explorer" element={<AssetExplorerPage />} />
              <Route path="/asset-creation" element={<TokenizePage />} />
              <Route path="/validators" element={<ValidatorsPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/my-assets" element={<MyAssetsPage />} />
            </Route>
          </Route>

          <Route path="/tokenize" element={<Navigate to="/asset-creation" replace />} />
          <Route path="/dashborad" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashbaord" element={<Navigate to="/dashboard" replace />} />
          <Route
            path="*"
            element={
              <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 px-6 text-center">
                <h1 className="text-3xl font-bold text-gray-900">Page not found</h1>
                <p className="mt-2 text-gray-600">The page you opened does not exist.</p>
                <Link
                  to="/dashboard"
                  className="mt-6 px-4 py-2 rounded-lg bg-blue-600 text-white"
                >
                  Dashboard
                </Link>
              </div>
            }
          />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;