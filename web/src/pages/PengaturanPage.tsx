import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { VideoCamera, Play, X, Key, ShieldCheck } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/auth';
import { familyApi } from '../api/family';
import { camerasApi, type CameraItem } from '../api/cameras';
import { devicesApi, type ChannelItem } from '../api/devices';
import { auditApi, type AuditLogItem } from '../api/audit';
import { assistantApi } from '../api/assistant';
import { AppSwitch } from '../components/AppSwitch';
import { AppButton } from '../components/AppButton';
import { AppBadge } from '../components/AppBadge';
import { AppInput } from '../components/AppInput';
import { EmptyState } from '../components/EmptyState';
import styles from './PengaturanPage.module.css';

type SettingsTab = 'account' | 'privacy_data' | 'camera_privacy' | 'assistant_voice' | 'channels' | 'audit';

export const PengaturanPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { user, setUser } = useAuth();
  const isOwner = user?.role === 'pemilik' || user?.role === 'admin';
  const isAdmin = isOwner;

  const [activeTab, setActiveTab] = useState<SettingsTab>('account');

  // Google account linking states
  const [linkEmailPrompt, setLinkEmailPrompt] = useState(false);
  const [linkGoogleEmail, setLinkGoogleEmail] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkMsg, setLinkMsg] = useState('');
  const [linkError, setLinkError] = useState('');

  // Password management modal states
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  // Suara asisten state
  const [selectedVoice, setSelectedVoice] = useState('id-ID-ArdiNeural');
  const [testingVoice, setTestingVoice] = useState(false);

  // Filter audit log
  const [auditFilter, setAuditFilter] = useState('all');

  // Tab Privasi & Data states
  const [privacyMode, setPrivacyMode] = useState<boolean>(() => {
    return localStorage.getItem('nexa_privacy_mode') === 'true';
  });
  const [privacyToggles, setPrivacyToggles] = useState<{
    ai_read?: boolean;
    tracking: boolean;
    recognition: boolean;
    vision: boolean;
    keep_activity: boolean;
    keep_chat: boolean;
  }>({
    tracking: true,
    recognition: true,
    vision: true,
    keep_activity: true,
    keep_chat: true,
  });
  const [customRetentionDays, setCustomRetentionDays] = useState<number | null>(null);
  const [recentHistory, setRecentHistory] = useState<Array<{ where: string; what: string; at: string }>>([
    { where: 'Ruang tamu', what: 'Aktivitas terdeteksi', at: 'Hari ini, 21.14' },
    { where: 'Zona belajar', what: 'Duduk selama 42 menit', at: 'Hari ini, 19.30' },
    { where: 'Dapur', what: 'Aktivitas terdeteksi', at: 'Hari ini, 17.05' },
    { where: 'Ruang tamu', what: 'Tidak bergerak lebih dari 2 jam', at: 'Kemarin, 14.20' },
    { where: 'Kamar tidur', what: 'Aktivitas larut malam', at: 'Kemarin, 23.41' },
  ]);
  const [historyBackup, setHistoryBackup] = useState<Array<{ where: string; what: string; at: string }> | null>(null);
  const [privacyToastVisible, setPrivacyToastVisible] = useState(false);
  const [privacyToastMsg, setPrivacyToastMsg] = useState('');
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const location = useLocation();
  const handledLinkCodeRef = useRef<string | null>(null);

  // Handle callback otentikasi Google untuk tautkan akun jika ada ?code= di URL
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    if (code && handledLinkCodeRef.current !== code) {
      handledLinkCodeRef.current = code;
      setLinkLoading(true);
      window.history.replaceState({}, document.title, window.location.pathname);
      authApi
        .linkGoogle({ code, redirect_uri: window.location.origin + '/pengaturan' })
        .then((res) => {
          setLinkMsg(res.message || 'Akun Google berhasil ditautkan!');
          return authApi.getMe();
        })
        .then((updatedUser) => {
          setUser(updatedUser);
        })
        .catch((err: unknown) => {
          const errObj = err as { message?: string };
          setLinkError(errObj.message || 'Gagal menautkan akun Google.');
        })
        .finally(() => setLinkLoading(false));
    }
  }, [location.search, setUser]);

  const handleLinkGoogle = async () => {
    setLinkError('');
    setLinkMsg('');
    setLinkLoading(true);
    try {
      const res = await authApi.getGoogleAuthUrl(window.location.origin + '/pengaturan');
      if (res.url && !res.url.includes('client_id=&')) {
        window.location.href = res.url;
      } else {
        setLinkEmailPrompt(true);
      }
    } catch {
      setLinkEmailPrompt(true);
    } finally {
      setLinkLoading(false);
    }
  };

  const handleConfirmLinkGoogle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkGoogleEmail) return;
    setLinkLoading(true);
    setLinkError('');
    try {
      const res = await authApi.linkGoogle({ id_token: `mock_google_${linkGoogleEmail.trim().toLowerCase()}` });
      setLinkMsg(res.message);
      setLinkEmailPrompt(false);
      const updatedUser = await authApi.getMe();
      setUser(updatedUser);
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setLinkError(errObj.message || 'Gagal menautkan akun Google.');
    } finally {
      setLinkLoading(false);
    }
  };

  const handleUnlinkGoogle = async () => {
    if (!user?.has_password) {
      setLinkError('Akun Anda belum memiliki kata sandi manual! Silakan klik "Atur Kata Sandi" terlebih dahulu sebelum melepas tautan Google agar akun tidak terkunci.');
      return;
    }
    if (!window.confirm('Yakin ingin memutuskan penautan akun Google?')) return;
    setLinkLoading(true);
    setLinkError('');
    try {
      const res = await authApi.unlinkGoogle();
      setLinkMsg(res.message);
      const updatedUser = await authApi.getMe();
      setUser(updatedUser);
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setLinkError(errObj.message || 'Gagal memutuskan tautan.');
    } finally {
      setLinkLoading(false);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      setPasswordError('Kata sandi baru minimal 6 karakter.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Konfirmasi kata sandi baru tidak cocok.');
      return;
    }
    setPasswordLoading(true);
    setPasswordError('');
    setPasswordSuccess('');
    try {
      const res = await authApi.setPassword(newPassword, user?.has_password ? oldPassword : undefined);
      setPasswordSuccess(res.message || 'Kata sandi berhasil disimpan!');
      const updatedUser = await authApi.getMe();
      setUser(updatedUser);
      setTimeout(() => {
        setShowPasswordModal(false);
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordSuccess('');
      }, 1000);
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setPasswordError(errObj.message || 'Gagal menyimpan kata sandi.');
    } finally {
      setPasswordLoading(false);
    }
  };

  // Fetch family settings for Privasi & Data tab
  const { data: familySettingsData } = useQuery({
    queryKey: ['family-settings-privacy'],
    queryFn: familyApi.getSettings,
    enabled: activeTab === 'privacy_data',
  });

  const isAiReadChecked =
    privacyToggles.ai_read !== undefined
      ? privacyToggles.ai_read
      : (familySettingsData?.settings.allow_assistant_family_summary ?? true);

  const effectiveRetentionDays =
    customRetentionDays ?? familySettingsData?.settings.events_retention_days ?? 30;

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
      }
    };
  }, []);

  const handleTogglePrivacyMode = (val: boolean) => {
    setPrivacyMode(val);
    localStorage.setItem('nexa_privacy_mode', String(val));
  };

  const handleTogglePrivacySetting = async (key: keyof typeof privacyToggles, val: boolean) => {
    setPrivacyToggles((prev) => ({ ...prev, [key]: val }));
    if (key === 'ai_read') {
      try {
        await familyApi.updateSettings({ allow_assistant_family_summary: val });
        queryClient.invalidateQueries({ queryKey: ['family-settings-privacy'] });
      } catch (err) {
        console.error('Failed to update assistant family summary setting:', err);
      }
    }
  };

  const handleSelectRetention = async (days: number) => {
    setCustomRetentionDays(days);
    try {
      await familyApi.updateSettings({ events_retention_days: days, stats_retention_days: days });
      queryClient.invalidateQueries({ queryKey: ['family-settings-privacy'] });
    } catch (err) {
      console.error('Failed to update retention days:', err);
    }
  };

  const handleClearHistory = () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
    }
    setHistoryBackup([...recentHistory]);
    setRecentHistory([]);
    setPrivacyToastMsg('Histori kegiatan dihapus.');
    setPrivacyToastVisible(true);

    undoTimerRef.current = setTimeout(async () => {
      setPrivacyToastVisible(false);
      setHistoryBackup(null);
      try {
        await familyApi.clearAllData();
      } catch (err) {
        console.error('Failed to clear family data:', err);
      }
    }, 6000);
  };

  const handleUndoClearHistory = () => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    if (historyBackup) {
      setRecentHistory(historyBackup);
      setHistoryBackup(null);
    }
    setPrivacyToastVisible(false);
  };

  // 1. Fetch cameras for privacy toggle
  const { data: cameras = [] } = useQuery<CameraItem[]>({
    queryKey: ['cameras'],
    queryFn: camerasApi.getCameras,
    enabled: activeTab === 'camera_privacy',
  });

  // 2. Fetch channels for channel settings
  const { data: channels = [] } = useQuery<ChannelItem[]>({
    queryKey: ['channels-all'],
    queryFn: devicesApi.listAllChannels,
    enabled: activeTab === 'channels',
  });

  // 3. Fetch audit logs
  const { data: auditLogs = [] } = useQuery<AuditLogItem[]>({
    queryKey: ['audit-logs-settings'],
    queryFn: () => auditApi.getLogs(50),
    enabled: activeTab === 'audit' && isAdmin,
  });

  // Mutations
  const toggleAudioMutation = useMutation({
    mutationFn: async ({ id, nextVal }: { id: string; nextVal: boolean }) => {
      await camerasApi.toggleAudio(id, nextVal);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
    },
  });

  const updateChannelMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: { name?: string; alias?: string; is_sensitive?: boolean; allowed_for_child?: boolean };
    }) => {
      await devicesApi.updateChannel(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channels-all'] });
    },
  });

  const handleTestVoice = async (_voiceName: string) => {
    setTestingVoice(true);
    try {
      const blob = await assistantApi.synthesizeTts('Halo, ini adalah pengujian suara asisten Nexa Home lokal Anda.');
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        setTestingVoice(false);
        URL.revokeObjectURL(url);
      };
      await audio.play();
    } catch {
      setTestingVoice(false);
    }
  };

  const filteredLogs = auditLogs.filter((log) => {
    if (auditFilter === 'all') return true;
    return log.action.toLowerCase().includes(auditFilter.toLowerCase());
  });

  return (
    <div className={styles.container}>
      {/* Tab Navigation */}
      <div className={styles.tabRow}>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'account' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('account')}
        >
          Akun & 2FA
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'privacy_data' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('privacy_data')}
        >
          Privasi & Data
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'camera_privacy' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('camera_privacy')}
        >
          Kamera & Privasi
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'assistant_voice' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('assistant_voice')}
        >
          Suara Asisten
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'channels' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('channels')}
        >
          Kanal Perangkat
        </button>
        {isAdmin && (
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === 'audit' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            Log Audit
          </button>
        )}
      </div>

      {/* Tab 1: Akun & 2FA */}
      {activeTab === 'account' && (
        <div className={styles.card}>
          <div>
            <h3 className={styles.cardTitle}>Profil Akun & Autentikasi Pengguna</h3>
            <p className={styles.cardSubtitle}>
              Kredensial akses sesi pengguna di sistem Nexa Home (aujasena.my.id)
            </p>
          </div>

          <div className={styles.formGrid}>
            <div className={styles.fieldGroup}>
              <label className={styles.label}>Nama Pengguna</label>
              <AppInput value={user?.username || ''} disabled readOnly />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label}>Nama Lengkap</label>
              <AppInput value={user?.full_name || user?.display_name || user?.username || ''} disabled readOnly />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label}>Alamat Email</label>
              <AppInput value={user?.email || 'Belum diatur'} disabled readOnly />
            </div>

            <div className={styles.fieldGroup}>
              <label className={styles.label}>Peran Pengguna</label>
              <div style={{ display: 'flex', alignItems: 'center', height: 'var(--control-height)' }}>
                {(() => {
                  const role = user?.role || '';
                  if (role === 'admin' || role === 'pemilik') {
                    return <AppBadge variant="ok">Pemilik</AppBadge>;
                  }
                  if (role === 'member' || role === 'anggota') {
                    return <AppBadge variant="ok">Anggota</AppBadge>;
                  }
                  if (role === 'child') {
                    return <AppBadge variant="ok">Anak</AppBadge>;
                  }
                  return <AppBadge variant="neutral">Belum Bergabung</AppBadge>;
                })()}
              </div>
            </div>
          </div>

          {/* Penautan Akun Google */}
          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <span className={styles.settingTitle}>Penautan Akun Google (Google OAuth2)</span>
              <span className={styles.settingDesc}>
                {user?.is_google_linked
                  ? 'Akun Anda telah terhubung dengan Google. Anda dapat masuk menggunakan Username/Email maupun tombol Google.'
                  : 'Tautkan akun Anda dengan Google agar bisa masuk dengan satu klik ke aujasena.my.id.'}
              </span>
              {linkMsg && <span style={{ color: 'var(--color-accent)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)', display: 'block' }}>{linkMsg}</span>}
              {linkError && <span style={{ color: 'var(--color-status-danger)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-1)', display: 'block' }}>{linkError}</span>}
            </div>
            <div>
              {user?.is_google_linked ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <AppBadge variant="ok">Tertaut</AppBadge>
                  <AppButton variant="outline" onClick={handleUnlinkGoogle} disabled={linkLoading}>
                    Putuskan
                  </AppButton>
                </div>
              ) : (
                <AppButton variant="primary" onClick={handleLinkGoogle} disabled={linkLoading}>
                  Tautkan Akun Google
                </AppButton>
              )}

            </div>
          </div>

          {/* Kata Sandi Akun */}
          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <span className={styles.settingTitle}>Kata Sandi Akun</span>
              <span className={styles.settingDesc}>
                {user?.has_password
                  ? 'Kata sandi manual aktif untuk login via username atau email.'
                  : 'Belum diatur (hanya masuk lewat Google). Wajib diatur sebelum memutuskan Google.'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <AppBadge variant={user?.has_password ? 'ok' : 'warn'}>
                {user?.has_password ? 'Sudah Diatur' : 'Belum Diatur'}
              </AppBadge>
              <AppButton variant="outline" onClick={() => setShowPasswordModal(true)}>
                <Key size={16} />
                <span>{user?.has_password ? 'Ubah Sandi' : 'Atur Kata Sandi'}</span>
              </AppButton>
            </div>
          </div>

          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <span className={styles.settingTitle}>Autentikasi Dua Langkah (TOTP 6-Digit)</span>
              <span className={styles.settingDesc}>
                {isAdmin
                  ? 'Wajib aktif untuk akun Administrator demi keamanan konfigurasi Nexa Home.'
                  : 'Dikelola oleh akun administrator.'}
              </span>
            </div>
            <AppBadge variant="ok">Aktif</AppBadge>
          </div>

          <div className={styles.settingRow}>
            <div className={styles.settingInfo}>
              <span className={styles.settingTitle}>Penyimpanan Token Akses</span>
              <span className={styles.settingDesc}>
                Disimpan murni di memori RAM aplikasi (bebas risiko XSS localStorage). Refresh token diamankan melalui httpOnly cookie Lax.
              </span>
            </div>
            <AppBadge variant="ok">Memory + httpOnly</AppBadge>
          </div>
        </div>
      )}

      {/* Tab: Privasi & Data */}
      {activeTab === 'privacy_data' && (
        <div className={styles.privacyWrap}>
          <h2 className={styles.privacyMainTitle}>Privasi &amp; Data</h2>

          {/* Banner Mode Privasi Rumah Aktif */}
          {privacyMode && (
            <div className={styles.privacyBanner} role="status">
              <ShieldCheck size={20} className={styles.privacyBannerIcon} />
              <span>Mode Privasi Rumah aktif. Semua analitik dan pelacakan kamera sedang dijeda.</span>
            </div>
          )}

          {/* BAGIAN 1: Izin Pelacakan & AI */}
          <section className={styles.privacySection} aria-labelledby="s1">
            <header className={styles.privacySectionHeader}>
              <h3 id="s1" className={styles.privacySectionTitle}>Izin pelacakan &amp; AI</h3>
              <p className={styles.privacySectionSubtitle}>Atur apa saja yang boleh dibaca dan dilacak oleh sistem.</p>
            </header>
            <div className={styles.privacyCard}>
              <div className={`${styles.privacyRow} ${privacyMode ? styles.rowPaused : ''}`}>
                <div className={styles.privacyRowInfo}>
                  <div className={styles.privacyRowName}>Izin asisten AI membaca ringkasan keluarga</div>
                  <div className={styles.privacyRowDesc}>
                    AI hanya membaca ringkasan angka keluarga, tanpa nama per orang.
                  </div>
                </div>
                <label className={`${styles.switch} ${isAiReadChecked ? styles.switchChecked : ''} ${privacyMode ? styles.switchDisabled : ''}`}>
                  <input
                    type="checkbox"
                    checked={isAiReadChecked}
                    disabled={privacyMode}
                    onChange={(e) => handleTogglePrivacySetting('ai_read', e.target.checked)}
                    aria-label="Izin asisten AI membaca ringkasan keluarga"
                  />
                  <span className={styles.slider} />
                </label>
              </div>

              <div className={`${styles.privacyRow} ${privacyMode ? styles.rowPaused : ''}`}>
                <div className={styles.privacyRowInfo}>
                  <div className={styles.privacyRowName}>Pelacakan aktivitas dan kehadiran harian</div>
                  <div className={styles.privacyRowDesc}>
                    Matikan jika Anda tidak ingin kegiatan sehari-hari dilacak.
                  </div>
                </div>
                <label className={`${styles.switch} ${privacyToggles.tracking ? styles.switchChecked : ''} ${privacyMode ? styles.switchDisabled : ''}`}>
                  <input
                    type="checkbox"
                    checked={privacyToggles.tracking}
                    disabled={privacyMode}
                    onChange={(e) => handleTogglePrivacySetting('tracking', e.target.checked)}
                    aria-label="Pelacakan aktivitas dan kehadiran harian"
                  />
                  <span className={styles.slider} />
                </label>
              </div>

              <div className={`${styles.privacyRow} ${privacyMode ? styles.rowPaused : ''}`}>
                <div className={styles.privacyRowInfo}>
                  <div className={styles.privacyRowName}>Pengenalan anggota keluarga</div>
                  <div className={styles.privacyRowDesc}>
                    Deteksi wajah per orang. Jika mati, sistem hanya menghitung per ruangan.
                  </div>
                </div>
                <label className={`${styles.switch} ${privacyToggles.recognition ? styles.switchChecked : ''} ${privacyMode ? styles.switchDisabled : ''}`}>
                  <input
                    type="checkbox"
                    checked={privacyToggles.recognition}
                    disabled={privacyMode}
                    onChange={(e) => handleTogglePrivacySetting('recognition', e.target.checked)}
                    aria-label="Pengenalan anggota keluarga"
                  />
                  <span className={styles.slider} />
                </label>
              </div>

              <div className={`${styles.privacyRow} ${privacyMode ? styles.rowPaused : ''}`}>
                <div className={styles.privacyRowInfo}>
                  <div className={styles.privacyRowName}>Pencarian barang lewat Vision AI</div>
                  <div className={styles.privacyRowDesc}>
                    Izinkan AI mengenali barang dari kamera untuk membantu mencarinya.
                  </div>
                </div>
                <label className={`${styles.switch} ${privacyToggles.vision ? styles.switchChecked : ''} ${privacyMode ? styles.switchDisabled : ''}`}>
                  <input
                    type="checkbox"
                    checked={privacyToggles.vision}
                    disabled={privacyMode}
                    onChange={(e) => handleTogglePrivacySetting('vision', e.target.checked)}
                    aria-label="Pencarian barang lewat Vision AI"
                  />
                  <span className={styles.slider} />
                </label>
              </div>
            </div>
          </section>

          {/* BAGIAN 2: Histori Kegiatan & Retensi Data */}
          <section className={styles.privacySection} aria-labelledby="s2">
            <header className={styles.privacySectionHeader}>
              <h3 id="s2" className={styles.privacySectionTitle}>Histori kegiatan</h3>
              <p className={styles.privacySectionSubtitle}>Kontrol apa yang disimpan dan berapa lama.</p>
            </header>
            <div className={styles.privacyCard}>
              <div className={`${styles.privacyRow} ${privacyMode ? styles.rowPaused : ''}`}>
                <div className={styles.privacyRowInfo}>
                  <div className={styles.privacyRowName}>Simpan histori kegiatan dan deteksi rumah</div>
                  <div className={styles.privacyRowDesc}>
                    Catatan kegiatan yang terdeteksi di rumah.
                  </div>
                </div>
                <label className={`${styles.switch} ${privacyToggles.keep_activity ? styles.switchChecked : ''} ${privacyMode ? styles.switchDisabled : ''}`}>
                  <input
                    type="checkbox"
                    checked={privacyToggles.keep_activity}
                    disabled={privacyMode}
                    onChange={(e) => handleTogglePrivacySetting('keep_activity', e.target.checked)}
                    aria-label="Simpan histori kegiatan dan deteksi rumah"
                  />
                  <span className={styles.slider} />
                </label>
              </div>

              <div className={`${styles.privacyRow} ${privacyMode ? styles.rowPaused : ''}`}>
                <div className={styles.privacyRowInfo}>
                  <div className={styles.privacyRowName}>Simpan riwayat obrolan dan suara asisten AI</div>
                  <div className={styles.privacyRowDesc}>
                    Percakapan teks dan rekaman suara dengan asisten.
                  </div>
                </div>
                <label className={`${styles.switch} ${privacyToggles.keep_chat ? styles.switchChecked : ''} ${privacyMode ? styles.switchDisabled : ''}`}>
                  <input
                    type="checkbox"
                    checked={privacyToggles.keep_chat}
                    disabled={privacyMode}
                    onChange={(e) => handleTogglePrivacySetting('keep_chat', e.target.checked)}
                    aria-label="Simpan riwayat obrolan dan suara asisten AI"
                  />
                  <span className={styles.slider} />
                </label>
              </div>

              {/* Segmented Button: Retensi */}
              <div
                className={`${styles.privacyRow} ${
                  privacyMode || !privacyToggles.keep_activity ? styles.rowPaused : ''
                }`}
              >
                <div className={styles.privacyRowInfo}>
                  <div className={styles.privacyRowName} id="ret-label">Hapus otomatis setelah</div>
                  <div className={styles.privacyRowDesc}>Histori yang lebih lama dari ini dihapus secara berkala.</div>
                </div>
                <div className={styles.seg} role="radiogroup" aria-labelledby="ret-label">
                  {[7, 30, 90].map((days) => (
                    <button
                      key={days}
                      type="button"
                      role="radio"
                      aria-checked={effectiveRetentionDays === days}
                      className={`${styles.segBtn} ${effectiveRetentionDays === days ? styles.segBtnActive : ''}`}
                      disabled={privacyMode || !privacyToggles.keep_activity}
                      onClick={() => handleSelectRetention(days)}
                    >
                      {days} hari
                    </button>
                  ))}
                </div>
              </div>

              {/* Daftar Kegiatan Terakhir & Tombol Hapus */}
              <div className={styles.historyBlock}>
                <div className={styles.historyBlockHead}>
                  <div>
                    <div className={styles.historyBlockName}>Kegiatan terakhir</div>
                    <div className={styles.historyBlockSub}>
                      {recentHistory.length > 0 ? `${recentHistory.length} catatan terbaru` : 'Tidak ada catatan'}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.btnDangerOutline}
                    disabled={recentHistory.length === 0 || privacyMode}
                    onClick={handleClearHistory}
                  >
                    Hapus semua histori kegiatan
                  </button>
                </div>

                {recentHistory.length === 0 ? (
                  <div className={styles.historyEmpty}>Belum ada histori kegiatan.</div>
                ) : (
                  <ul className={styles.historyList}>
                    {recentHistory.map((item, idx) => (
                      <li key={idx} className={styles.historyItem}>
                        <span>
                          <span className={styles.historyWhere}>{item.where}</span>
                          <span className={styles.historyWhat}> · {item.what}</span>
                        </span>
                        <time className={styles.historyTime}>{item.at}</time>
                      </li>
                    ))}
                  </ul>
                )}
                <p className={styles.historyNote}>Data di atas hanya contoh tampilan.</p>
              </div>
            </div>
          </section>

          {/* BAGIAN 3: Mode Privasi Instan */}
          <section className={styles.privacySection} aria-labelledby="s3">
            <header className={styles.privacySectionHeader}>
              <h4 id="s3" className={styles.privacySectionTitle}>Mode privasi instan</h4>
            </header>
            <div className={`${styles.privacyCard} ${styles.instantCard}`}>
              <div className={styles.instantLead}>
                <div
                  className={`${styles.instantIcon} ${privacyMode ? styles.instantIconActive : ''}`}
                  aria-hidden="true"
                >
                  <ShieldCheck size={22} />
                </div>
                <div>
                  <div className={styles.instantName} id="pm-name">Mode Privasi Rumah</div>
                  <div className={styles.instantDesc}>
                    Jeda semua analitik dan pelacakan kamera sekaligus. Matikan kapan saja untuk melanjutkan.
                  </div>
                </div>
              </div>
              <label className={`${styles.switch} ${privacyMode ? styles.switchChecked : ''}`}>
                <input
                  type="checkbox"
                  checked={privacyMode}
                  onChange={(e) => handleTogglePrivacyMode(e.target.checked)}
                  aria-label="Mode Privasi Rumah"
                />
                <span className={styles.slider} />
              </label>
            </div>
          </section>

          {/* Toast Pembatalan Hapus Histori (Undo dalam 6 detik) */}
          {privacyToastVisible && (
            <div className={styles.privacyToast} role="status" aria-live="polite">
              <span>{privacyToastMsg}</span>
              <button type="button" className={styles.undoBtn} onClick={handleUndoClearHistory}>
                Urungkan
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Kamera & Privasi */}
      {activeTab === 'camera_privacy' && (
        <div className={styles.card}>
          <div>
            <h3 className={styles.cardTitle}>Kamera & Privasi Suara Penghuni</h3>
            <p className={styles.cardSubtitle}>
              Pengaturan saklar audio mikrofon kamera pengawas
            </p>
          </div>

          <div className={styles.warningBox}>
            <strong>Peringatan Kebijakan Privasi Nexa Home:</strong>
            <br />
            Audio kamera <strong>DIMATIKAN secara default</strong>. Mengaktifkan mikrofon akan menangkap dan menyiarkan suara percakapan penghuni di dalam ruangan ke pengguna yang diizinkan. Pastikan seluruh penghuni Nexa Home menyetujui pengaktifan audio ini.
          </div>

          <div className={styles.itemList}>
            {cameras.length === 0 ? (
              <EmptyState
                icon={VideoCamera}
                title="Belum ada kamera terdaftar"
                description="Daftarkan kamera pengawas untuk mengonfigurasi izin saklar audionya."
              />
            ) : (
              cameras.map((cam) => (
                <div key={cam.id} className={styles.settingRow}>
                  <div className={styles.settingInfo}>
                    <span className={styles.settingTitle}>
                      {cam.name} ({cam.room_id})
                    </span>
                    <span className={styles.settingDesc}>
                      Mikrofon Kamera: {cam.audio_enabled ? 'Aktif (Menyiarkan Suara)' : 'Mati (Hening)'}
                    </span>
                  </div>
                  <AppSwitch
                    checked={cam.audio_enabled}
                    disabled={!isAdmin}
                    onChange={() =>
                      toggleAudioMutation.mutate({ id: cam.id, nextVal: !cam.audio_enabled })
                    }
                    ariaLabel={`Audio saklar ${cam.name}`}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Suara Asisten */}
      {activeTab === 'assistant_voice' && (
        <div className={styles.card}>
          <div>
            <h3 className={styles.cardTitle}>Pilihan Suara Asisten (TTS)</h3>
            <p className={styles.cardSubtitle}>
              Model sintesis suara percakapan bahasa Indonesia
            </p>
          </div>

          <div className={styles.itemList}>
            {/* Ardi */}
            <div
              className={`${styles.radioCard} ${
                selectedVoice === 'id-ID-ArdiNeural' ? styles.radioCardActive : ''
              }`}
              onClick={() => setSelectedVoice('id-ID-ArdiNeural')}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Ardi (Pria)</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                  Model Edge-TTS · Suara ramah & tenang (Default)
                </div>
              </div>
              <AppButton
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTestVoice('id-ID-ArdiNeural');
                }}
                disabled={testingVoice}
              >
                <Play size={16} />
                <span>Uji Coba Suara</span>
              </AppButton>
            </div>

            {/* Gadis */}
            <div
              className={`${styles.radioCard} ${
                selectedVoice === 'id-ID-GadisNeural' ? styles.radioCardActive : ''
              }`}
              onClick={() => setSelectedVoice('id-ID-GadisNeural')}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Gadis (Wanita)</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                  Model Edge-TTS · Suara artikulatif & natural
                </div>
              </div>
              <AppButton
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTestVoice('id-ID-GadisNeural');
                }}
                disabled={testingVoice}
              >
                <Play size={16} />
                <span>Uji Coba Suara</span>
              </AppButton>
            </div>

            {/* Piper */}
            <div
              className={`${styles.radioCard} ${
                selectedVoice === 'id_ID-arman-medium' ? styles.radioCardActive : ''
              }`}
              onClick={() => setSelectedVoice('id_ID-arman-medium')}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>Arman (Piper Offline)</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                  Model Piper ONNX Lokal · 100% tanpa internet
                </div>
              </div>
              <AppButton
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTestVoice('id_ID-arman-medium');
                }}
                disabled={testingVoice}
              >
                <Play size={16} />
                <span>Uji Coba Suara</span>
              </AppButton>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Kanal Perangkat (Alias, Sensitif, Izin Anak) */}
      {activeTab === 'channels' && (
        <div className={styles.card}>
          <div>
            <h3 className={styles.cardTitle}>Pengaturan Kanal & Hak Akses</h3>
            <p className={styles.cardSubtitle}>
              Atur alias nama lokal, proteksi aksi sensitif, dan batas izin akun anak
            </p>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Kanal Firmware</th>
                  <th className={styles.th}>Alias Tampilan</th>
                  <th className={styles.th}>Tipe</th>
                  <th className={styles.th}>Aksi Sensitif</th>
                  <th className={styles.th}>Izin Anak (Child)</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((ch) => (
                  <tr key={ch.id}>
                    <td className={`${styles.td} ${styles.tdMono}`}>{ch.channel_key}</td>
                    <td className={styles.td}>
                      {isAdmin ? (
                        <input
                          type="text"
                          defaultValue={ch.alias || ch.name}
                          onBlur={(e) => {
                            const val = e.target.value.trim();
                            if (val !== ch.alias) {
                              updateChannelMutation.mutate({
                                id: ch.id,
                                data: { alias: val },
                              });
                            }
                          }}
                          style={{
                            height: 32,
                            padding: '0 8px',
                            borderRadius: 'var(--radius-input)',
                            border: 'var(--border-width) solid var(--color-border)',
                            backgroundColor: 'var(--color-surface)',
                            fontFamily: 'var(--font-body)',
                            fontSize: 'var(--text-xs)',
                            color: 'var(--color-text)',
                          }}
                        />
                      ) : (
                        ch.alias || ch.name
                      )}
                    </td>
                    <td className={styles.td}>{ch.channel_type}</td>
                    <td className={styles.td}>
                      <AppSwitch
                        checked={!!ch.is_sensitive}
                        disabled={!isAdmin}
                        onChange={() =>
                          updateChannelMutation.mutate({
                            id: ch.id,
                            data: { is_sensitive: !ch.is_sensitive },
                          })
                        }
                        ariaLabel={`Sensitif ${ch.name}`}
                      />
                    </td>
                    <td className={styles.td}>
                      <AppSwitch
                        checked={ch.allowed_for_child ?? true}
                        disabled={!isAdmin}
                        onChange={() =>
                          updateChannelMutation.mutate({
                            id: ch.id,
                            data: { allowed_for_child: !(ch.allowed_for_child ?? true) },
                          })
                        }
                        ariaLabel={`Izin anak ${ch.name}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 5: Log Audit */}
      {activeTab === 'audit' && isAdmin && (
        <div className={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 className={styles.cardTitle}>Log Audit Sistem</h3>
              <p className={styles.cardSubtitle}>
                Rekaman terperinci seluruh tindakan pengguna dan perubahan sistem
              </p>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {['all', 'device', 'camera', 'auth', 'channel'].map((flt) => (
                <button
                  key={flt}
                  type="button"
                  onClick={() => setAuditFilter(flt)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-chip)',
                    border: 'var(--border-width) solid var(--color-border)',
                    backgroundColor: auditFilter === flt ? 'var(--color-accent-light)' : 'transparent',
                    color: auditFilter === flt ? 'var(--color-accent)' : 'var(--color-text)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {flt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>Waktu</th>
                  <th className={styles.th}>Pengguna</th>
                  <th className={styles.th}>Aksi</th>
                  <th className={styles.th}>Target</th>
                  <th className={styles.th}>IP Asal</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => {
                  const dt = new Date(log.created_at).toLocaleString('id-ID', {
                    dateStyle: 'short',
                    timeStyle: 'medium',
                  });

                  return (
                    <tr key={log.id}>
                      <td className={`${styles.td} ${styles.tdMono}`}>{dt}</td>
                      <td className={styles.td}>
                        <strong>{log.username || 'System'}</strong>
                      </td>
                      <td className={styles.td}>{log.action}</td>
                      <td className={`${styles.td} ${styles.tdMono}`}>{log.target_id || '-'}</td>
                      <td className={`${styles.td} ${styles.tdMono}`}>{log.ip_address || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Tautkan Akun Google */}
      {linkEmailPrompt && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Tautkan Akun Google</h3>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setLinkEmailPrompt(false)}
              >
                <X size={20} />
              </button>
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
              Masukkan alamat email Google yang ingin ditautkan ke akun Anda:
            </p>
            <form onSubmit={handleConfirmLinkGoogle} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="linkGoogleEmail">
                  Email Akun Google
                </label>
                <AppInput
                  id="linkGoogleEmail"
                  type="email"
                  placeholder="nama.user@gmail.com"
                  value={linkGoogleEmail}
                  onChange={(e) => setLinkGoogleEmail(e.target.value)}
                  required
                />
              </div>
              <AppButton type="submit" variant="primary" disabled={linkLoading} style={{ width: '100%' }}>
                <span>Konfirmasi Tautkan Akun Google</span>
              </AppButton>
            </form>
          </div>
        </div>
      )}

      {/* Modal Atur / Ubah Kata Sandi */}
      {showPasswordModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                {user?.has_password ? 'Ubah Kata Sandi' : 'Atur Kata Sandi Baru'}
              </h3>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setShowPasswordModal(false)}
              >
                <X size={20} />
              </button>
            </div>

            {passwordError && (
              <div style={{ padding: 'var(--space-2) var(--space-3)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-status-danger)', fontSize: 'var(--text-xs)', borderRadius: 'var(--radius-button)', marginBottom: 'var(--space-3)' }}>
                {passwordError}
              </div>
            )}
            {passwordSuccess && (
              <div style={{ padding: 'var(--space-2) var(--space-3)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-accent)', fontSize: 'var(--text-xs)', borderRadius: 'var(--radius-button)', marginBottom: 'var(--space-3)' }}>
                {passwordSuccess}
              </div>
            )}

            <form onSubmit={handleSavePassword} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {user?.has_password && (
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="oldPassword">
                    Kata Sandi Lama
                  </label>
                  <AppInput
                    id="oldPassword"
                    type="password"
                    placeholder="Masukkan sandi saat ini..."
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    required
                  />
                </div>
              )}

              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="newPassword">
                  Kata Sandi Baru (Min. 6 Karakter)
                </label>
                <AppInput
                  id="newPassword"
                  type="password"
                  placeholder="Masukkan kata sandi baru..."
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>

              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="confirmPassword">
                  Ulangi Kata Sandi Baru
                </label>
                <AppInput
                  id="confirmPassword"
                  type="password"
                  placeholder="Ulangi kata sandi baru..."
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              <AppButton type="submit" variant="primary" disabled={passwordLoading} style={{ width: '100%', marginTop: 'var(--space-2)' }}>
                <Key size={18} />
                <span>Simpan Kata Sandi</span>
              </AppButton>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};


