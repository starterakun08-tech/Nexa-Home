import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KeluargaPage } from './KeluargaPage';
import { familyApi } from '../api/family';
import * as AuthContext from '../context/AuthContext';

vi.mock('../api/family', () => ({
  familyApi: {
    getTransparency: vi.fn(),
    getMembers: vi.fn(),
    getSentInvitations: vi.fn(),
    inviteMember: vi.fn(),
    cancelInvitation: vi.fn(),
    leaveFamily: vi.fn(),
  },
}));

describe('KeluargaPage - Fitur Anggota Keluar dari Keluarga', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.clearAllMocks();
    vi.mocked(familyApi.getTransparency).mockResolvedValue({
      status: 'ok',
      ai_worker_status: 'online',
      disclaimer: '',
      active_features: {} as any,
      monitored_cameras: [],
      monitored_zones: [],
    });
    vi.mocked(familyApi.getMembers).mockResolvedValue({
      status: 'ok',
      family_id: 1,
      members: [
        { id: 1, username: 'pemilik1', full_name: 'Pemilik Rumah', role: 'pemilik', is_owner: true },
        { id: 2, username: 'anggota1', full_name: 'Anggota Keluarga', role: 'member', is_owner: false },
      ],
    });
    vi.mocked(familyApi.getSentInvitations).mockResolvedValue({
      status: 'ok',
      invitations: [],
    });
  });

  it('menampilkan tombol "Keluar dari Keluarga" jika akun login adalah Anggota', async () => {
    vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
      user: { id: 2, username: 'anggota1', role: 'member', family_id: 1 } as any,
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      googleLogin: vi.fn(),
      verify2fa: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
      refreshUser: vi.fn().mockResolvedValue(null),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <KeluargaPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Keluar dari Keluarga')).toBeDefined();
    });

    // Klik tombol Keluar dari Keluarga
    fireEvent.click(screen.getByText('Keluar dari Keluarga'));

    // Muncul modal dialog konfirmasi
    expect(screen.getByText('Keluar dari Keluarga?')).toBeDefined();
    expect(screen.getByText('Ya, Keluar dari Keluarga')).toBeDefined();

    // Konfirmasi keluar
    vi.mocked(familyApi.leaveFamily).mockResolvedValue({ status: 'ok', message: 'Anda telah berhasil keluar dari keluarga.' });
    fireEvent.click(screen.getByText('Ya, Keluar dari Keluarga'));

    await waitFor(() => {
      expect(familyApi.leaveFamily).toHaveBeenCalledTimes(1);
    });
  });

  it('TIDAK menampilkan tombol "Keluar dari Keluarga" jika akun login adalah Pemilik', async () => {
    vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
      user: { id: 1, username: 'pemilik1', role: 'pemilik', family_id: 1 } as any,
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      register: vi.fn(),
      googleLogin: vi.fn(),
      verify2fa: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
      refreshUser: vi.fn().mockResolvedValue(null),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <KeluargaPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Undang anggota')).toBeDefined();
    });

    expect(screen.queryByText('Keluar dari Keluarga')).toBeNull();
  });
});
