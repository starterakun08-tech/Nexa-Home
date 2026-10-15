import React, { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  House,
  Cpu,
  ChatsCircle,
  VideoCamera,
  Users,
  Gear,
  Bell,
  ShieldCheck,
  Sun,
  Moon,
  List,
  SignOut,
  X,
} from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { healthApi, type HealthResponse } from '../api/health';
import { familyApi, type FamilyInvitationItem } from '../api/family';
import { authApi } from '../api/auth';
import styles from './AppShell.module.css';

interface NavItemDef {
  path: string;
  label: string;
  icon: React.ComponentType<{ size?: number; weight?: 'regular' | 'bold' | 'fill' }>;
  roles?: ('pemilik' | 'anggota' | 'biasa' | 'admin' | 'member' | 'child')[];
}

const NAV_ITEMS: NavItemDef[] = [
  { path: '/beranda', label: 'Beranda', icon: House },
  { path: '/perangkat', label: 'Perangkat', icon: Cpu },
  { path: '/asisten', label: 'Asisten', icon: ChatsCircle },
  { path: '/kamera', label: 'Kamera', icon: VideoCamera },
  { path: '/keluarga', label: 'Keluarga', icon: Users },
  { path: '/pengaturan', label: 'Pengaturan', icon: Gear },
];

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Beranda',
  '/beranda': 'Beranda',
  '/perangkat': 'Perangkat',
  '/asisten': 'Asisten',
  '/kamera': 'Kamera',
  '/keluarga': 'Keluarga',
  '/pengaturan': 'Pengaturan',
};

export const AppShell: React.FC = () => {
  const { user, logout, setUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationLoading, setNotificationLoading] = useState<number | null>(null);
  const queryClient = useQueryClient();

  // Health check query setiap 15 detik
  const { data: health, isError } = useQuery<HealthResponse>({
    queryKey: ['health'],
    queryFn: healthApi.check,
    refetchInterval: 15000,
  });

  const isServerConnected = !isError && health?.status === 'ok';

  const { data: invitationsData } = useQuery<{ status: string; invitations: FamilyInvitationItem[] }>({
    queryKey: ['family-invitations'],
    queryFn: familyApi.getInvitations,
    refetchInterval: 10000,
  });
  const pendingInvitations = invitationsData?.invitations || [];

  const handleInvitationResponse = async (invitationId: number, action: 'accept' | 'reject') => {
    setNotificationLoading(invitationId);
    try {
      await familyApi.respondInvitation(invitationId, action);
      queryClient.invalidateQueries({ queryKey: ['family-invitations'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      if (action === 'accept') {
        setUser(await authApi.getMe());
      }
    } finally {
      setNotificationLoading(null);
    }
  };

  const role = user?.role || 'biasa';
  const filteredNav = NAV_ITEMS.filter((item) => {
    if (!item.roles) return true;
    return item.roles.some((r) => {
      if (r === role) return true;
      if ((r === 'admin' || r === 'pemilik') && (role === 'admin' || role === 'pemilik')) return true;
      if ((r === 'member' || r === 'anggota') && (role === 'member' || role === 'anggota')) return true;
      return false;
    });
  });

  const pageTitle = ROUTE_TITLES[location.pathname] || 'Dashboard';
  const initial = (user?.display_name || user?.username || 'U').charAt(0).toUpperCase();
  const roleDisplay = (role === 'pemilik' || role === 'admin')
    ? 'Pemilik'
    : (role === 'anggota' || role === 'member')
      ? 'Anggota'
      : 'Akun Biasa';

  const handleLogout = async () => {
    setProfileOpen(false);
    await logout();
    navigate('/login');
  };

  return (
    <div className={styles.layout}>
      {/* Mobile Backdrop */}
      {drawerOpen && (
        <div
          className={styles.drawerBackdrop}
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar 240px */}
      <aside className={`${styles.sidebar} ${drawerOpen ? styles.sidebarOpen : ''}`}>
        <div className={styles.sidebarContent}>
          {/* Wordmark text only */}
          <div className={styles.brand}>
            <h1 className={styles.brandTitle}>Rumah</h1>
            <p className={styles.brandSubtitle}>Rumah Tangga</p>
          </div>

          {/* Nav items */}
          <nav aria-label="Navigasi Utama" className={styles.nav}>
            {filteredNav.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/beranda'}
                  className={({ isActive }) =>
                    `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
                  }
                  onClick={() => setDrawerOpen(false)}
                >
                  <Icon size={20} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className={styles.sidebarFooter}>
          <div className={styles.statusIndicator}>
            <span
              className={`${styles.dot} ${!isServerConnected ? styles.dotDisconnected : ''}`}
            />
            <span>{isServerConnected ? 'Server terhubung' : 'Server terputus'}</span>
          </div>
          <div className={styles.statusSub}>ESP32 · MQTT (Lokal)</div>
        </div>
      </aside>

      {/* Main Container */}
      <div className={styles.mainWrapper}>
        {/* Topbar */}
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button
              type="button"
              className={styles.menuToggle}
              onClick={() => setDrawerOpen(!drawerOpen)}
              aria-label="Buka menu navigasi"
            >
              {drawerOpen ? <X size={24} /> : <List size={24} />}
            </button>
            <h2 className={styles.pageTitle}>{pageTitle}</h2>
            <div
              className={styles.statusIndicator}
              style={{
                backgroundColor: 'var(--color-accent-light)',
                padding: 'var(--space-1) var(--space-3)',
                borderRadius: 'var(--radius-chip)',
              }}
            >
              <span
                className={`${styles.dot} ${!isServerConnected ? styles.dotDisconnected : ''}`}
              />
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                {isServerConnected ? 'Server terhubung' : 'Server terputus'}
              </span>
            </div>
          </div>

          <div className={styles.topbarRight}>
            {/* Lonceng & Perisai */}
            <button
              type="button"
              className={styles.iconBtn}
              title="Notifikasi"
              aria-label="Notifikasi"
              onClick={() => setNotificationsOpen((open) => !open)}
            >
              <Bell size={20} />
              {pendingInvitations.length > 0 && (
                <span className={styles.notificationDot} aria-label={`${pendingInvitations.length} notifikasi baru`} />
              )}
            </button>
            {notificationsOpen && (
              <div className={styles.notificationPopover} role="dialog" aria-label="Notifikasi">
                <div className={styles.notificationHeader}>
                  <strong>Notifikasi</strong>
                  {pendingInvitations.length > 0 && <span>{pendingInvitations.length} baru</span>}
                </div>
                {pendingInvitations.length === 0 ? (
                  <div className={styles.notificationEmpty}>Belum ada notifikasi baru.</div>
                ) : (
                  <div className={styles.notificationList}>
                    {pendingInvitations.map((invitation) => (
                      <div className={styles.notificationItem} key={invitation.id}>
                        <div>
                          <strong>Undangan rumah</strong>
                          <p>{invitation.inviter_name} mengundang Anda bergabung.</p>
                        </div>
                        <div className={styles.notificationActions}>
                          <button
                            type="button"
                            className={styles.notificationAccept}
                            disabled={notificationLoading === invitation.id}
                            onClick={() => handleInvitationResponse(invitation.id, 'accept')}
                          >Terima</button>
                          <button
                            type="button"
                            className={styles.notificationReject}
                            disabled={notificationLoading === invitation.id}
                            onClick={() => handleInvitationResponse(invitation.id, 'reject')}
                          >Tolak</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              className={styles.iconBtn}
              title="Keamanan"
              aria-label="Keamanan"
            >
              <ShieldCheck size={20} />
            </button>

            {/* Toggle Tema (Terang / Gelap) */}
            <button
              type="button"
              className={styles.iconBtn}
              onClick={toggleTheme}
              title={`Beralih ke mode ${theme === 'light' ? 'gelap' : 'terang'}`}
              aria-label="Beralih tema"
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>

            {/* User Profile Chip */}
            <div className={styles.profileContainer}>
              <div
                className={styles.profileChip}
                onClick={() => setProfileOpen(!profileOpen)}
                role="button"
                tabIndex={0}
                aria-label={`Profil ${user?.display_name || user?.username || 'Pengguna'}`}
              >
                <div className={styles.avatar}>{initial}</div>
                <div className={styles.profileName}>
                  {user?.display_name || user?.username || 'Tamu'}{' '}
                  <span className={styles.profileRole}>· {roleDisplay}</span>
                </div>
              </div>

              {profileOpen && (
                <div className={styles.dropdown}>
                  <button
                    type="button"
                    className={styles.dropdownItem}
                    onClick={handleLogout}
                  >
                    <SignOut size={16} />
                    <span>Keluar</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Content Area */}
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
};
