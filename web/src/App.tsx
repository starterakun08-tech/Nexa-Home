import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppShell } from './components/AppShell';
import { LoginPage } from './pages/LoginPage';
import { ApprovalPendingScreen } from './components/ApprovalPendingScreen';

// Lazy loading halaman-halaman berat untuk optimasi bundle & fast initial load
const BerandaPage = React.lazy(() =>
  import('./pages/BerandaPage').then((m) => ({ default: m.BerandaPage }))
);
const PerangkatPage = React.lazy(() =>
  import('./pages/PerangkatPage').then((m) => ({ default: m.PerangkatPage }))
);
const AsistenPage = React.lazy(() =>
  import('./pages/AsistenPage').then((m) => ({ default: m.AsistenPage }))
);
const KameraPage = React.lazy(() =>
  import('./pages/KameraPage').then((m) => ({ default: m.KameraPage }))
);
const KeluargaPage = React.lazy(() =>
  import('./pages/KeluargaPage').then((m) => ({ default: m.KeluargaPage }))
);
const PengaturanPage = React.lazy(() =>
  import('./pages/PengaturanPage').then((m) => ({ default: m.PengaturanPage }))
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const PageLoadingFallback: React.FC = () => (
  <div
    style={{
      minHeight: '60vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
      color: 'var(--color-text-secondary)',
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--text-sm)',
    }}
  >
    <span>Memuat halaman...</span>
  </div>
);

// Guard rute terproteksi: arahkan ke /login jika belum login, atau tahan di ApprovalPendingScreen bila belum disetujui
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--color-bg)',
          color: 'var(--color-text)',
          fontFamily: 'var(--font-body)',
        }}
      >
        <span>Memeriksa sesi login...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={`/login${location.search}`} state={{ from: location }} replace />;
  }

  if (user && user.is_approved === false) {
    return <ApprovalPendingScreen />;
  }

  return <>{children}</>;
};

// Guard rute berdasarkan peran pengguna
const RoleRoute: React.FC<{
  roles: ('pemilik' | 'anggota' | 'biasa' | 'admin' | 'member' | 'child')[];
  children: React.ReactNode;
}> = ({ roles, children }) => {
  const { user } = useAuth();
  const userRole = user?.role || 'biasa';

  const hasAccess = roles.some((r) => {
    if (r === userRole) return true;
    if ((r === 'admin' || r === 'pemilik') && (userRole === 'admin' || userRole === 'pemilik')) return true;
    if ((r === 'member' || r === 'anggota') && (userRole === 'member' || userRole === 'anggota')) return true;
    return false;
  });

  if (!hasAccess) {
    return <Navigate to="/beranda" replace />;
  }

  return <>{children}</>;
};

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              {/* Rute Otentikasi Langsung */}
              <Route path="/login" element={<LoginPage />} />

              {/* Rute Aplikasi Utama di dalam AppShell dengan Suspense Code-Splitting */}
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <AppShell />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="/beranda" replace />} />
                <Route
                  path="beranda"
                  element={
                    <Suspense fallback={<PageLoadingFallback />}>
                      <BerandaPage />
                    </Suspense>
                  }
                />
                <Route
                  path="perangkat"
                  element={
                    <Suspense fallback={<PageLoadingFallback />}>
                      <PerangkatPage />
                    </Suspense>
                  }
                />
                <Route
                  path="asisten"
                  element={
                    <Suspense fallback={<PageLoadingFallback />}>
                      <AsistenPage />
                    </Suspense>
                  }
                />
                <Route
                  path="kamera"
                  element={
                    <RoleRoute roles={['admin', 'member']}>
                      <Suspense fallback={<PageLoadingFallback />}>
                        <KameraPage />
                      </Suspense>
                    </RoleRoute>
                  }
                />
                <Route
                  path="keluarga"
                  element={
                    <RoleRoute roles={['admin']}>
                      <Suspense fallback={<PageLoadingFallback />}>
                        <KeluargaPage />
                      </Suspense>
                    </RoleRoute>
                  }
                />
                <Route
                  path="pengaturan"
                  element={
                    <Suspense fallback={<PageLoadingFallback />}>
                      <PengaturanPage />
                    </Suspense>
                  }
                />
              </Route>

              {/* Fallback ke /beranda */}
              <Route path="*" element={<Navigate to="/beranda" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
