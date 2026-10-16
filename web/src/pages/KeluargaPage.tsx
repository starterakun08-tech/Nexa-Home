import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  X,
  Warning,
  SignOut,
  Eye,
  Trash,
  Info,
  CheckCircle,
} from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { AppButton } from '../components/AppButton';
import { AppBadge } from '../components/AppBadge';
import { AppInput } from '../components/AppInput';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SegmentedList, ListRow, InfoRow } from '../components/SegmentedList';
import {
  familyApi,
  type FamilyMemberItem,
  type TransparencyData,
  type FamilySettingsData,
  type CameraZoneData,
  type FamilyEventItem,
} from '../api/family';
import { isOwnerRole } from '../utils/roleLabels';
import styles from './KeluargaPage.module.css';

interface ReadoutTimerInputProps {
  enabled: boolean;
  value: number | null | undefined;
  min?: number;
  max?: number;
  disabled?: boolean;
  unit: string;
  paramLabel: string;
  ariaLabel: string;
  onChange: (val: number | null) => void;
}

const ReadoutTimerInput: React.FC<ReadoutTimerInputProps> = ({
  enabled,
  value,
  min,
  max,
  disabled,
  unit,
  paramLabel,
  ariaLabel,
  onChange,
}) => {
  const [localText, setLocalText] = useState<string | null>(null);

  // If switch is OFF or value is null/empty/0, display '--'
  const isOffOrNull = !enabled || value === null || value === undefined || isNaN(value) || value <= 0;
  const formattedPropValue = isOffOrNull ? '--' : String(value);

  const text = localText !== null ? localText : formattedPropValue;

  const handleFocus = () => {
    if (!enabled || disabled) return;
    if (text === '--') {
      setLocalText('');
    } else {
      setLocalText(text);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (/^\d{0,4}$/.test(raw)) {
      setLocalText(raw);
    }
  };

  const handleBlur = () => {
    const trimmed = (localText ?? '').trim();
    setLocalText(null);

    if (!trimmed || trimmed === '--') {
      if (value !== null && value !== undefined) {
        onChange(null);
      }
    } else {
      let num = parseInt(trimmed, 10);
      if (isNaN(num) || num <= 0) {
        if (value !== null && value !== undefined) {
          onChange(null);
        }
      } else {
        if (min !== undefined && num < min) num = min;
        if (max !== undefined && num > max) num = max;
        if (num !== value) {
          onChange(num);
        }
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  const isBlank = text === '--' || isOffOrNull;
  const isInputDisabled = disabled || !enabled;

  return (
    <div className={styles.readout}>
      <div className={styles.readoutNumRow}>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          className={styles.readoutInput}
          data-empty={isBlank ? 'true' : 'false'}
          disabled={isInputDisabled}
          value={text}
          onFocus={handleFocus}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          aria-label={ariaLabel}
        />
        <span className={`${styles.readoutUnit} ${!enabled ? styles.readoutUnitDimmed : ''}`}>
          {unit}
        </span>
      </div>
      <span className={styles.readoutParamLabel}>{paramLabel}</span>
    </div>
  );
};

export const KeluargaPage: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const isOwner = isOwnerRole(user?.role);
  const isMember = user?.role === 'anggota' || user?.role === 'member';
  const canManageFamily = isOwner || isMember;

  // Modals state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [showTransparencyModal, setShowTransparencyModal] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showZoneModal, setShowZoneModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);

  // Invite input state
  const [inviteInput, setInviteInput] = useState('');
  const [inviteModalError, setInviteModalError] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [feedbackErr, setFeedbackErr] = useState('');

  // Cancel invite target
  const [cancelTarget, setCancelTarget] = useState<{ id: number; email: string } | null>(null);

  // Zone form state
  const [newZoneName, setNewZoneName] = useState('');
  const [newZoneType, setNewZoneType] = useState<'belajar' | 'umum' | 'berbahaya'>('belajar');
  const [newZoneCameraId, setNewZoneCameraId] = useState('');
  const [newZonePolyStr, setNewZonePolyStr] = useState('0.1,0.1; 0.5,0.1; 0.5,0.5; 0.1,0.5');

  // 1. Transparency query
  const { data: transparency } = useQuery<TransparencyData>({
    queryKey: ['family-transparency'],
    queryFn: familyApi.getTransparency,
    staleTime: 30000,
  });

  // 2. Members query
  const {
    data: membersData,
    isLoading: membersLoading,
    isError: membersError,
    refetch: refetchMembers,
  } = useQuery<{ status: string; family_id: number; members: FamilyMemberItem[] }>({
    queryKey: ['family-members'],
    queryFn: familyApi.getMembers,
  });

  // 3. Sent invitations query (only loaded for owner)
  const { data: sentInvitesData } = useQuery<{ status: string; invitations: any[] }>({
    queryKey: ['family-sent-invites'],
    queryFn: familyApi.getSentInvitations,
    enabled: canManageFamily,
    refetchInterval: 10000,
  });

  // 4. Settings query
  const { data: settingsData } = useQuery<{ status: string; settings: FamilySettingsData }>({
    queryKey: ['family-settings'],
    queryFn: familyApi.getSettings,
    enabled: isOwner || isMember,
  });

  const [settingsOverride, setSettingsOverride] = useState<FamilySettingsData | null>(null);
  const settings = settingsOverride ?? settingsData?.settings ?? null;

  // 5. Daily Summary query
  const { data: summaryTodayRes } = useQuery({
    queryKey: ['family-summary-today'],
    queryFn: () => familyApi.getSummary('today'),
    enabled: canManageFamily,
  });
  const summaryToday = summaryTodayRes?.data || null;

  // 6. Weekly Summary query
  const { data: summaryWeekRes } = useQuery({
    queryKey: ['family-summary-week'],
    queryFn: () => familyApi.getSummary('week'),
    enabled: canManageFamily,
  });
  const summaryWeek: any[] = summaryWeekRes?.history || [];

  // 7. Zones query
  const { data: zonesRes } = useQuery<{ status: string; zones: CameraZoneData[] }>({
    queryKey: ['family-zones'],
    queryFn: () => familyApi.getZones(),
    enabled: canManageFamily,
  });
  const zones = zonesRes?.zones || [];

  // 8. Events query
  const { data: eventsRes } = useQuery<{ status: string; events: FamilyEventItem[] }>({
    queryKey: ['family-events'],
    queryFn: () => familyApi.getEvents(20),
    enabled: canManageFamily,
  });
  const [reviewedEventIds, setReviewedEventIds] = useState<string[]>([]);
  const events = (eventsRes?.events || []).map((e) =>
    reviewedEventIds.includes(e.id) ? { ...e, is_reviewed: true } : e
  );

  // Mutations
  const inviteMutation = useMutation({
    mutationFn: (target: string) => familyApi.inviteMember(target),
    onSuccess: (res) => {
      setFeedbackMsg(res.message || 'Undangan berhasil dikirim.');
      setFeedbackErr('');
      setInviteInput('');
      setInviteModalError('');
      setShowInviteModal(false);
      queryClient.invalidateQueries({ queryKey: ['family-members'] });
      queryClient.invalidateQueries({ queryKey: ['family-sent-invites'] });
    },
    onError: (err: any) => {
      setInviteModalError(err?.message || 'Gagal mengirim undangan.');
    },
  });

  const cancelInviteMutation = useMutation({
    mutationFn: (id: number) => familyApi.cancelInvitation(id),
    onSuccess: (res) => {
      setFeedbackMsg(res.message || 'Undangan dibatalkan.');
      setFeedbackErr('');
      setCancelTarget(null);
      queryClient.invalidateQueries({ queryKey: ['family-sent-invites'] });
    },
    onError: (err: any) => {
      setFeedbackErr(err?.message || 'Gagal membatalkan undangan.');
      setCancelTarget(null);
    },
  });

  const leaveMutation = useMutation({
    mutationFn: () => familyApi.leaveFamily(),
    onSuccess: async (res) => {
      setShowLeaveModal(false);
      setFeedbackMsg(res.message || 'Anda berhasil keluar dari keluarga.');
      setFeedbackErr('');
      await refreshUser();
      queryClient.invalidateQueries({ queryKey: ['family-members'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      await queryClient.refetchQueries({ queryKey: ['family-members'] });
    },
    onError: (err: any) => {
      setFeedbackErr(err?.message || 'Gagal keluar dari keluarga.');
      setShowLeaveModal(false);
    },
  });

  const handleToggleSetting = async (key: keyof FamilySettingsData, value: any) => {
    if (!settings || !canManageFamily) return;
    const previous = settings;
    const updated = { ...settings, [key]: value };
    setSettingsOverride(updated);
    try {
      await familyApi.updateSettings({ [key]: value });
      queryClient.invalidateQueries({ queryKey: ['family-settings'] });
      queryClient.invalidateQueries({ queryKey: ['family-transparency'] });
    } catch (err: any) {
      setFeedbackErr(err?.message || 'Gagal memperbarui pengaturan analitik.');
      setSettingsOverride(previous);
    }
  };

  const handleReviewEvent = async (id: string) => {
    try {
      await familyApi.reviewEvent(id);
      setReviewedEventIds((prev) => [...prev, id]);
      queryClient.invalidateQueries({ queryKey: ['family-events'] });
    } catch (err: any) {
      setFeedbackErr(err?.message || 'Gagal menandai kejadian.');
    }
  };

  const handleClearAllData = async () => {
    try {
      await familyApi.clearAllData();
      setShowClearConfirm(false);
      setFeedbackMsg('Semua data analitik dan riwayat kejadian berhasil dihapus.');
      queryClient.invalidateQueries({ queryKey: ['family-summary-today'] });
      queryClient.invalidateQueries({ queryKey: ['family-summary-week'] });
      queryClient.invalidateQueries({ queryKey: ['family-events'] });
    } catch (err: any) {
      setFeedbackErr(err?.message || 'Gagal menghapus data analitik.');
      setShowClearConfirm(false);
    }
  };

  const handleCreateZone = async (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveCamId = newZoneCameraId || transparency?.monitored_cameras?.[0]?.id || '';
    if (!newZoneName || !effectiveCamId) return;

    const polyPoints: number[][] = [];
    const rawPairs = newZonePolyStr.split(';');
    for (const pair of rawPairs) {
      const parts = pair.trim().split(',');
      if (parts.length === 2) {
        const x = parseFloat(parts[0]);
        const y = parseFloat(parts[1]);
        if (!isNaN(x) && !isNaN(y)) {
          polyPoints.push([x, y]);
        }
      }
    }

    if (polyPoints.length < 3) {
      setFeedbackErr('Poligon membutuhkan minimal 3 titik koordinat!');
      return;
    }

    try {
      await familyApi.createZone({
        camera_id: effectiveCamId,
        name: newZoneName,
        zone_type: newZoneType,
        polygon: polyPoints,
      });
      setShowZoneModal(false);
      setNewZoneName('');
      setFeedbackMsg(`Zona '${newZoneName}' berhasil dibuat.`);
      queryClient.invalidateQueries({ queryKey: ['family-zones'] });
      queryClient.invalidateQueries({ queryKey: ['family-transparency'] });
    } catch (err: any) {
      setFeedbackErr(err?.message || 'Gagal membuat zona.');
    }
  };

  const handleDeleteZone = async (zoneId: string) => {
    if (!confirm('Hapus zona kamera ini?')) return;
    try {
      await familyApi.deleteZone(zoneId);
      setFeedbackMsg('Zona berhasil dihapus.');
      queryClient.invalidateQueries({ queryKey: ['family-zones'] });
      queryClient.invalidateQueries({ queryKey: ['family-transparency'] });
    } catch (err: any) {
      setFeedbackErr(err?.message || 'Gagal menghapus zona.');
    }
  };

  const handleSendInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const target = inviteInput.trim();
    if (!target) {
      setInviteModalError('Masukkan username atau email terlebih dahulu.');
      return;
    }
    setInviteModalError('');
    inviteMutation.mutate(target);
  };

  const handleCancelInviteConfirm = () => {
    if (!cancelTarget) return;
    cancelInviteMutation.mutate(cancelTarget.id);
  };

  const members = membersData?.members || [];
  const sentInvites = sentInvitesData?.invitations || [];
  const pendingInvites = sentInvites.filter(
    (inv) => inv.status === 'pending' || inv.status === 'menunggu'
  );

  // Sort: 1. Pemilik, 2. Anggota, 3. Anak, 4. Lainnya
  const sortedMembers = [...members].sort((a, b) => {
    const getRank = (m: FamilyMemberItem) => {
      if (m.is_owner || isOwnerRole(m.role)) return 1;
      if (m.role === 'anggota' || m.role === 'member') return 2;
      if (m.role === 'anak') return 3;
      return 4;
    };
    return getRank(a) - getRank(b);
  });

  const isWorkerOffline = transparency?.ai_worker_status === 'offline';

  return (
    <div className={styles.container}>
      {/* 1. Detection Status Banner (Vision Worker offline) */}
      {isWorkerOffline && (
        <div className={styles.workerOfflineBanner} role="status">
          <Warning size={22} weight="fill" />
          <span className={styles.workerOfflineText}>
            Deteksi aktivitas tidak aktif. Layanan penglihatan tidak merespons, jadi deteksi postur, zona, dan jatuh tidak berjalan.
          </span>
        </div>
      )}

      {/* 2. Intro Block */}
      <div className={styles.introBlock}>
        <div className={styles.introLeft}>
          <h1 className={styles.introTitle}>Anggota keluarga</h1>
          <p className={styles.introSubtitle}>
            Anggota keluarga bisa mengontrol perangkat yang diizinkan. Pengelola akun keluarga dapat melihat dan mengatur akses.{' '}
            <button
              type="button"
              className={styles.introLink}
              onClick={() => setShowPrivacyModal(true)}
            >
              Pelajari peran dan privasi
            </button>
          </p>
        </div>

        {canManageFamily && (
          <div className={styles.introRight}>
            <AppButton
              variant="primary"
              onClick={() => {
                setInviteModalError('');
                setShowInviteModal(true);
              }}
            >
              <Plus size={16} weight="bold" />
              <span>Undang anggota</span>
            </AppButton>
          </div>
        )}
      </div>

      {feedbackMsg && <div className={`${styles.msgBanner} ${styles.msgOk}`}>{feedbackMsg}</div>}
      {feedbackErr && <div className={`${styles.msgBanner} ${styles.msgErr}`}>{feedbackErr}</div>}

      {/* 3. Member List */}
      {membersLoading && members.length === 0 ? (
        <div className={styles.skeletonList} aria-busy="true" aria-label="Memuat daftar anggota">
          <div className={styles.skeletonRow}>
            <div className={styles.skeletonAvatar} />
            <div className={styles.skeletonLines}>
              <div className={styles.skeletonLine} />
              <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
            </div>
          </div>
          <div className={styles.skeletonRow}>
            <div className={styles.skeletonAvatar} />
            <div className={styles.skeletonLines}>
              <div className={styles.skeletonLine} />
              <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
            </div>
          </div>
          <div className={styles.skeletonRow}>
            <div className={styles.skeletonAvatar} />
            <div className={styles.skeletonLines}>
              <div className={styles.skeletonLine} />
              <div className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
            </div>
          </div>
        </div>
      ) : membersError && members.length === 0 ? (
        <div className={styles.errorCard}>
          <p className={styles.errorText}>Gagal memuat data anggota keluarga.</p>
          <AppButton variant="outline" onClick={() => refetchMembers()}>
            Coba lagi
          </AppButton>
        </div>
      ) : sortedMembers.length === 0 && pendingInvites.length === 0 ? (
        <div className={styles.errorCard}>
          <p className={styles.introSubtitle}>Belum ada anggota keluarga lain.</p>
        </div>
      ) : (
        <>
          <SegmentedList ariaLabel="Daftar anggota keluarga">
            {sortedMembers.map((m) => {
              const displayName = m.full_name || m.username;
              const isSelf = user?.id === m.id || user?.username === m.username;
              const isOwnerItem = m.is_owner || isOwnerRole(m.role);
              const roleSubtext = isOwnerItem
                ? 'Pengelola akun keluarga'
                : m.role === 'anak'
                ? 'Anak'
                : 'Anggota';

              return (
                <ListRow
                  key={`member-${m.id}`}
                  title={displayName}
                  isSelf={isSelf}
                  subtitle={roleSubtext}
                  avatarName={displayName}
                  to={canManageFamily ? `/keluarga/${m.id}` : undefined}
                  showChevron={canManageFamily}
                />
              );
            })}

            {/* Pending Invitations at Bottom */}
            {canManageFamily &&
              pendingInvites.map((inv) => {
                const targetName = inv.invitee_email || inv.invitee_username || 'Undangan';
                return (
                  <ListRow
                    key={`invite-${inv.id}`}
                    title={targetName}
                    avatarName={targetName}
                    subtitle={
                      <div className={styles.pendingBadge}>
                        <span className={styles.pendingDot} />
                        <span>Menunggu diterima</span>
                      </div>
                    }
                    rightAction={
                      <button
                        type="button"
                        className={styles.closeBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCancelTarget({ id: inv.id, email: targetName });
                        }}
                        title={`Batalkan undangan untuk ${targetName}`}
                        aria-label={`Batalkan undangan untuk ${targetName}`}
                      >
                        <X size={16} />
                      </button>
                    }
                    showChevron={false}
                  />
                );
              })}
          </SegmentedList>

          <InfoRow text="Pengaturan ini berlaku untuk semua perangkat di Nexa Home." />

          {/* Tombol Keluar dari Keluarga untuk Anggota */}
          {isMember && !isOwner && (
            <div style={{ marginTop: 'var(--space-6)', display: 'flex', justifyContent: 'center' }}>
              <AppButton
                variant="outline"
                onClick={() => setShowLeaveModal(true)}
                style={{
                  color: 'var(--color-status-danger)',
                  borderColor: 'var(--color-status-danger)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                }}
              >
                <SignOut size={16} weight="bold" />
                <span>Keluar dari Keluarga</span>
              </AppButton>
            </div>
          )}
        </>
      )}

      {/* =====================================================================
          4. SEKSI WAWASAN & ANALITIK KELUARGA (FITUR ANALITIK)
          ===================================================================== */}
      {canManageFamily && (
        <section className={styles.analyticsSection} aria-label="Wawasan dan Analitik Keluarga">
          {/* Header Wawasan */}
          <div className={styles.headerRow}>
            <div className={styles.titleArea}>
              <div className={styles.titleWithBadge}>
                <h2 className={styles.pageHeaderTitle}>Wawasan & Aktivitas Ruang Umum</h2>
                <AppBadge variant={isWorkerOffline ? 'danger' : 'ok'}>
                  {isWorkerOffline ? 'AI Tidak Aktif' : 'AI Aktif'}
                </AppBadge>
              </div>
              <p className={styles.pageHeaderSubtitle}>
                Statistik per zona dan rumah dari kamera ruang umum tanpa pengenalan wajah.
              </p>
            </div>

            <div className={styles.headerActions}>
              <AppButton variant="outline" onClick={() => setShowTransparencyModal(true)}>
                <Eye size={16} style={{ marginRight: 'var(--space-1)' }} />
                <span>Apa yang Dipantau</span>
              </AppButton>
              {canManageFamily && (
                <AppButton variant="outline" onClick={() => setShowClearConfirm(true)}>
                  <Trash size={16} style={{ marginRight: 'var(--space-1)' }} />
                  <span>Hapus Semua Data</span>
                </AppButton>
              )}
            </div>
          </div>

          {/* Non-Medical Disclaimer Banner */}
          <div className={styles.disclaimerBanner}>
            <div className={styles.disclaimerIcon}>
              <Info size={22} weight="bold" />
            </div>
            <div className={styles.disclaimerContent}>
              <p className={styles.disclaimerTitle}>
                Bukan alat medis. Hanya angka dan kejadian dari kamera ruang umum, tanpa menyimpan video.
              </p>
              <p className={styles.disclaimerSub}>
                Sensor visual memproses fitur anonim (postur tubuh dan durasi) secara lokal tanpa menyimpan klip rekaman atau pengenalan identitas wajah.
              </p>
            </div>
          </div>

          {/* Daily Metrics Grid */}
          {canManageFamily && (
            <div className={styles.metricsGrid}>
              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Aktivitas di Zona Belajar</span>
                <span className={styles.metricValue}>
                  {summaryToday?.study_minutes ?? 0}
                  <span className={styles.metricUnit}> menit</span>
                </span>
                <span className={styles.metricSub}>Total duduk di zona belajar hari ini</span>
              </div>

              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Aktivitas Larut Malam</span>
                <span className={styles.metricValue}>{summaryToday?.late_night_count ?? 0}</span>
                <span className={styles.metricSub}>23:00 - 04:30 WIB</span>
              </div>

              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Kemungkinan Jatuh</span>
                <span
                  className={styles.metricValue}
                  style={{
                    color: (summaryToday?.fall_incident_count || 0) > 0 ? 'var(--color-status-danger)' : undefined,
                  }}
                >
                  {summaryToday?.fall_incident_count ?? 0}
                </span>
                <span className={styles.metricSub}>Postur berbaring & tidak bergerak</span>
              </div>

              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Tidak Bergerak Lama</span>
                <span className={styles.metricValue}>{summaryToday?.inactivity_count ?? 0}</span>
                <span className={styles.metricSub}>Diam posisi sama</span>
              </div>

              <div className={styles.metricCard}>
                <span className={styles.metricLabel}>Kejadian Zona Berbahaya</span>
                <span className={styles.metricValue}>{summaryToday?.hazard_alert_count ?? 0}</span>
                <span className={styles.metricSub}>Peringatan keamanan ruang</span>
              </div>
            </div>
          )}

          {/* Weekly Trend Bar Chart */}
          {canManageFamily && (
            <div className={styles.chartCard}>
              <div className={styles.chartHeader}>
                <h3 className={styles.chartTitle}>Tren Aktivitas Zona Belajar 7 Hari Terakhir (Menit)</h3>
              </div>
              <div className={styles.barChartContainer}>
                {summaryWeek.length === 0 ? (
                  <div style={{ textAlign: 'center', width: '100%', color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)', padding: 'var(--space-6) 0' }}>
                    Belum ada data riwayat mingguan yang tercatat.
                  </div>
                ) : (
                  summaryWeek.map((day, idx) => {
                    const maxVal = Math.max(...summaryWeek.map((d: any) => d.study_minutes || 0), 60);
                    const heightPct = Math.min(100, ((day.study_minutes || 0) / maxVal) * 100);
                    const dayLabel = day.date ? day.date.slice(5) : `H-${idx}`;
                    return (
                      <div key={day.date || idx} className={styles.barColumn}>
                        <span className={styles.barValue}>{day.study_minutes || 0}m</span>
                        <div
                          className={styles.bar}
                          style={{
                            height: `${Math.max(4, heightPct)}%`,
                          }}
                        />
                        <span className={styles.barLabel}>{dayLabel}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* Fitur Analitik: Master Switch & 5 Interactive Cards (Exact design) */}
          {settings && (
            <div className={styles.analyticsWrap} data-master={settings.enabled ? 'on' : 'off'}>
              <header className={styles.analyticsHead}>
                <div>
                  <h2 className={styles.analyticsTitle}>Fitur analitik</h2>
                  <p className={styles.analyticsSubtitle}>Pilih fitur yang aktif dan atur batas waktunya.</p>
                </div>
                <div className={styles.masterControl}>
                  <span className={styles.masterState} aria-live="polite">
                    {settings.enabled ? 'Aktif' : 'Nonaktif'}
                  </span>
                  <label className={styles.customSwitch}>
                    <input
                      type="checkbox"
                      role="switch"
                      id="master"
                      aria-label="Aktifkan semua fitur analitik"
                      checked={settings.enabled}
                      disabled={!canManageFamily}
                      onChange={(e) => handleToggleSetting('enabled', e.target.checked)}
                    />
                    <span className={styles.switchTrack} />
                    <span className={styles.switchThumb} />
                  </label>
                </div>
              </header>

              <section
                className={`${styles.analyticsGrid} ${!settings.enabled ? styles.analyticsGridDimmed : ''}`}
              >
                {/* 1. zona_belajar: "Aktivitas di zona belajar" | calm | param: Toleransi jeda */}
                <div
                  className={`${styles.analyticsCard} ${styles.calm} ${
                    settings.study_zone_enabled && settings.enabled ? styles.cardOn : ''
                  }`}
                >
                  <div className={styles.cardTop}>
                    <span className={styles.cardName}>Aktivitas di zona belajar</span>
                    <label className={styles.customSwitch}>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={settings.study_zone_enabled}
                        disabled={!settings.enabled || !canManageFamily}
                        onChange={(e) => handleToggleSetting('study_zone_enabled', e.target.checked)}
                        aria-label="Aktivitas di zona belajar"
                      />
                      <span className={styles.switchTrack} />
                      <span className={styles.switchThumb} />
                    </label>
                  </div>
                  <ReadoutTimerInput
                    enabled={settings.study_zone_enabled}
                    value={settings.study_gap_tolerance_minutes}
                    min={1}
                    max={60}
                    disabled={!settings.enabled || !canManageFamily}
                    unit="menit"
                    paramLabel="Toleransi jeda"
                    ariaLabel="Toleransi jeda menit"
                    onChange={(val) => handleToggleSetting('study_gap_tolerance_minutes', val)}
                  />
                  <p className={styles.cardDesc}>
                    Hitung berapa lama seseorang duduk di zona belajar.
                  </p>
                </div>

                {/* 2. larut_malam: "Aktivitas larut malam" | calm | param: Batas durasi */}
                <div
                  className={`${styles.analyticsCard} ${styles.calm} ${
                    settings.late_night_enabled && settings.enabled ? styles.cardOn : ''
                  }`}
                >
                  <div className={styles.cardTop}>
                    <span className={styles.cardName}>Aktivitas larut malam</span>
                    <label className={styles.customSwitch}>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={settings.late_night_enabled}
                        disabled={!settings.enabled || !canManageFamily}
                        onChange={(e) => handleToggleSetting('late_night_enabled', e.target.checked)}
                        aria-label="Aktivitas larut malam"
                      />
                      <span className={styles.switchTrack} />
                      <span className={styles.switchThumb} />
                    </label>
                  </div>
                  <ReadoutTimerInput
                    enabled={settings.late_night_enabled}
                    value={settings.late_night_min_minutes}
                    min={1}
                    max={120}
                    disabled={!settings.enabled || !canManageFamily}
                    unit="menit"
                    paramLabel="Batas durasi"
                    ariaLabel="Batas durasi menit"
                    onChange={(val) => handleToggleSetting('late_night_min_minutes', val)}
                  />
                  <p className={styles.cardDesc}>
                    Peringatan jika ada aktivitas di ruang umum pukul 23.00-04.30.
                  </p>
                </div>

                {/* 3. jatuh: "Kemungkinan jatuh" | urgent | param: Batas diam */}
                <div
                  className={`${styles.analyticsCard} ${styles.urgent} ${
                    settings.fall_detection_enabled && settings.enabled ? styles.cardOn : ''
                  }`}
                >
                  <div className={styles.cardTop}>
                    <span className={styles.cardName}>Kemungkinan jatuh</span>
                    <label className={styles.customSwitch}>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={settings.fall_detection_enabled}
                        disabled={!settings.enabled || !canManageFamily}
                        onChange={(e) => handleToggleSetting('fall_detection_enabled', e.target.checked)}
                        aria-label="Kemungkinan jatuh"
                      />
                      <span className={styles.switchTrack} />
                      <span className={styles.switchThumb} />
                    </label>
                  </div>
                  <ReadoutTimerInput
                    enabled={settings.fall_detection_enabled}
                    value={settings.fall_stationary_seconds}
                    min={5}
                    max={300}
                    disabled={!settings.enabled || !canManageFamily}
                    unit="detik"
                    paramLabel="Batas diam"
                    ariaLabel="Batas diam detik"
                    onChange={(val) => handleToggleSetting('fall_stationary_seconds', val)}
                  />
                  <p className={styles.cardDesc}>
                    Peringatan prioritas tinggi jika postur berubah ke berbaring dan tidak bergerak.
                  </p>
                </div>

                {/* 4. diam_lama: "Tidak bergerak lama" | calm | param: Batas diam */}
                <div
                  className={`${styles.analyticsCard} ${styles.calm} ${
                    settings.inactivity_enabled && settings.enabled ? styles.cardOn : ''
                  }`}
                >
                  <div className={styles.cardTop}>
                    <span className={styles.cardName}>Tidak bergerak lama</span>
                    <label className={styles.customSwitch}>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={settings.inactivity_enabled}
                        disabled={!settings.enabled || !canManageFamily}
                        onChange={(e) => handleToggleSetting('inactivity_enabled', e.target.checked)}
                        aria-label="Tidak bergerak lama"
                      />
                      <span className={styles.switchTrack} />
                      <span className={styles.switchThumb} />
                    </label>
                  </div>
                  <ReadoutTimerInput
                    enabled={settings.inactivity_enabled}
                    value={settings.inactivity_min_minutes}
                    min={10}
                    max={720}
                    disabled={!settings.enabled || !canManageFamily}
                    unit="menit"
                    paramLabel="Batas diam"
                    ariaLabel="Batas diam menit"
                    onChange={(val) => handleToggleSetting('inactivity_min_minutes', val)}
                  />
                  <p className={styles.cardDesc}>
                    Peringatan jika posisi dan postur hampir tidak berubah dalam waktu lama.
                  </p>
                </div>

                {/* 5. zona_bahaya: "Orang di zona berbahaya" | urgent | param: Batas waktu */}
                <div
                  className={`${styles.analyticsCard} ${styles.urgent} ${
                    settings.hazard_zone_enabled && settings.enabled ? styles.cardOn : ''
                  }`}
                >
                  <div className={styles.cardTop}>
                    <span className={styles.cardName}>Orang di zona berbahaya</span>
                    <label className={styles.customSwitch}>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={settings.hazard_zone_enabled}
                        disabled={!settings.enabled || !canManageFamily}
                        onChange={(e) => handleToggleSetting('hazard_zone_enabled', e.target.checked)}
                        aria-label="Orang di zona berbahaya"
                      />
                      <span className={styles.switchTrack} />
                      <span className={styles.switchThumb} />
                    </label>
                  </div>
                  <ReadoutTimerInput
                    enabled={settings.hazard_zone_enabled}
                    value={settings.hazard_stay_duration_seconds}
                    min={1}
                    max={3600}
                    disabled={!settings.enabled || !canManageFamily}
                    unit="detik"
                    paramLabel="Batas waktu"
                    ariaLabel="Batas waktu detik"
                    onChange={(val) => handleToggleSetting('hazard_stay_duration_seconds', val)}
                  />
                  <p className={styles.cardDesc}>
                    Peringatan jika ada orang di area berbahaya saat alarm gas aktif.
                  </p>
                </div>
              </section>
            </div>
          )}

          {/* Zona Kamera Terdaftar */}
          {canManageFamily && (
            <div className={styles.zoneEditorCard}>
              <div className={styles.chartHeader}>
                <h3 className={styles.chartTitle}>Zona Kamera Terdaftar</h3>
                <AppButton variant="primary" onClick={() => setShowZoneModal(true)}>
                  <Plus size={16} weight="bold" />
                  <span>Tambah Zona Baru</span>
                </AppButton>
              </div>

              {zones.length === 0 ? (
                <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                  Belum ada zona yang dikonfigurasi. Buat zona untuk mengaktifkan pemantauan zona belajar atau zona berbahaya.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {zones.map((z) => (
                    <div key={z.id} className={styles.zoneItem}>
                      <div className={styles.zoneDetails}>
                        <strong>{z.name}</strong> ({z.zone_type}) · Kamera: {z.camera_id}
                      </div>
                      <AppButton variant="outline" onClick={() => handleDeleteZone(z.id)}>
                        <Trash size={14} style={{ marginRight: 'var(--space-1)' }} />
                        <span>Hapus</span>
                      </AppButton>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Riwayat Kejadian Terakhir */}
          {canManageFamily && (
            <div className={styles.eventsCard}>
              <div className={styles.chartHeader}>
                <h3 className={styles.chartTitle}>Riwayat Kejadian Terakhir</h3>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                  {events.length} Catatan Kejadian
                </span>
              </div>

              {events.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)', padding: 'var(--space-6) 0' }}>
                  Belum ada kejadian atau anomali terdeteksi dari kamera ruang umum.
                </div>
              ) : (
                <div className={styles.eventsList}>
                  {events.map((ev) => (
                    <div key={ev.id} className={styles.eventItem}>
                      <div className={styles.eventInfo}>
                        <div className={styles.eventHeader}>
                          <AppBadge
                            variant={
                              ev.severity === 'critical'
                                ? 'danger'
                                : ev.severity === 'warning'
                                ? 'warn'
                                : 'neutral'
                            }
                          >
                            {ev.severity.toUpperCase()}
                          </AppBadge>
                          <h4 className={styles.eventTitle}>{ev.title}</h4>
                          <span className={styles.eventTime}>
                            {ev.created_at
                              ? new Date(ev.created_at).toLocaleTimeString('id-ID', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '-'}
                          </span>
                        </div>
                        <p className={styles.eventDesc}>{ev.description}</p>
                      </div>

                      {!ev.is_reviewed && (
                        <AppButton variant="outline" onClick={() => handleReviewEvent(ev.id)}>
                          <CheckCircle size={16} style={{ marginRight: 'var(--space-1)' }} />
                          <span>Tandai Ditinjau</span>
                        </AppButton>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* =====================================================================
          MODAL DIALOGS
          ===================================================================== */}

      {/* Modal: Undang Anggota */}
      {showInviteModal && (
        <div className={styles.modalOverlay} onClick={() => setShowInviteModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Undang Anggota Keluarga</h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setShowInviteModal(false)}
                aria-label="Tutup modal"
              >
                <X size={18} />
              </button>
            </div>
            <p className={styles.introSubtitle}>
              Masukkan username atau email akun yang ingin Anda undang ke Nexa Home.
            </p>

            {inviteModalError && (
              <div className={`${styles.msgBanner} ${styles.msgErr}`}>{inviteModalError}</div>
            )}

            <form onSubmit={handleSendInviteSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <AppInput
                autoFocus
                placeholder="Username atau email"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
                disabled={inviteMutation.isPending}
              />
              <div className={styles.modalActions}>
                <AppButton
                  type="button"
                  variant="outline"
                  onClick={() => setShowInviteModal(false)}
                  disabled={inviteMutation.isPending}
                >
                  Batal
                </AppButton>
                <AppButton
                  type="submit"
                  variant="primary"
                  disabled={inviteMutation.isPending || !inviteInput.trim()}
                >
                  {inviteMutation.isPending ? 'Mengirim...' : 'Kirim Undangan'}
                </AppButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Pelajari Peran dan Privasi */}
      {showPrivacyModal && (
        <div className={styles.modalOverlay} onClick={() => setShowPrivacyModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Peran Anggota & Privasi Nexa Home</h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setShowPrivacyModal(false)}
                aria-label="Tutup modal"
              >
                <X size={18} />
              </button>
            </div>

            <div className={styles.roleInfoList}>
              <div className={styles.roleInfoItem}>
                <span className={styles.roleInfoTitle}>Pemilik</span>
                <span className={styles.roleInfoDesc}>
                  Pengelola utama Nexa Home. Mengatur perangkat, anggota keluarga, zona kamera, dan pengaturan privasi.
                </span>
              </div>
              <div className={styles.roleInfoItem}>
                <span className={styles.roleInfoTitle}>Anggota</span>
                <span className={styles.roleInfoDesc}>
                  Mengontrol saklar dan perangkat yang diizinkan. Tidak dapat menambah anggota atau mengubah pengaturan privasi.
                </span>
              </div>
              <div className={styles.roleInfoItem}>
                <span className={styles.roleInfoTitle}>Anak</span>
                <span className={styles.roleInfoDesc}>
                  Akses terbatas hanya pada perangkat tertentu sesuai izin yang diberikan oleh pemilik.
                </span>
              </div>
              <div className={styles.roleInfoItem}>
                <span className={styles.roleInfoTitle}>Jaminan Privasi Lokal</span>
                <span className={styles.roleInfoDesc}>
                  Kamera ruang umum tidak pernah menyimpan rekaman video dan tidak menggunakan pengenalan wajah. Seluruh inferensi berjalan lokal di server Nexa Home.
                </span>
              </div>
            </div>

            <div className={styles.modalActions}>
              <AppButton variant="primary" onClick={() => setShowPrivacyModal(false)}>
                Tutup
              </AppButton>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Apa yang Dipantau (Transparency) */}
      {showTransparencyModal && (
        <div className={styles.modalOverlay} onClick={() => setShowTransparencyModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Apa yang Dipantau di Nexa Home</h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setShowTransparencyModal(false)}
                aria-label="Tutup modal"
              >
                <X size={18} />
              </button>
            </div>

            <p className={styles.introSubtitle}>
              {transparency?.disclaimer || 'Transparansi pemantauan ruang umum tanpa pengenalan wajah.'}
            </p>

            <div className={styles.transparencyList}>
              <div className={styles.transparencyItem}>
                <span>Status AI Vision Worker:</span>
                <strong>{transparency?.ai_worker_status === 'online' ? 'Beroperasi' : 'Tidak Aktif'}</strong>
              </div>
              <div className={styles.transparencyItem}>
                <span>Pemantauan Zona Belajar:</span>
                <span>{transparency?.active_features?.study_zone_monitoring ? 'Aktif' : 'Nonaktif'}</span>
              </div>
              <div className={styles.transparencyItem}>
                <span>Aktivitas Larut Malam:</span>
                <span>{transparency?.active_features?.late_night_activity_monitoring ? 'Aktif' : 'Nonaktif'}</span>
              </div>
              <div className={styles.transparencyItem}>
                <span>Deteksi Jatuh:</span>
                <span>{transparency?.active_features?.fall_detection_monitoring ? 'Aktif' : 'Nonaktif'}</span>
              </div>
              <div className={styles.transparencyItem}>
                <span>Deteksi Zona Berbahaya:</span>
                <span>{transparency?.active_features?.hazard_zone_monitoring ? 'Aktif' : 'Nonaktif'}</span>
              </div>
            </div>

            <div className={styles.modalActions}>
              <AppButton variant="primary" onClick={() => setShowTransparencyModal(false)}>
                Saya Mengerti
              </AppButton>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Tambah Zona Kamera */}
      {showZoneModal && (
        <div className={styles.modalOverlay} onClick={() => setShowZoneModal(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Tambah Zona Baru</h2>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setShowZoneModal(false)}
                aria-label="Tutup modal"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateZone} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, display: 'block', marginBottom: 'var(--space-1)' }}>
                  Nama Zona
                </label>
                <AppInput
                  placeholder="Misal: Meja Belajar Anak"
                  value={newZoneName}
                  onChange={(e) => setNewZoneName(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, display: 'block', marginBottom: 'var(--space-1)' }}>
                  ID Kamera
                </label>
                <AppInput
                  placeholder="ID Kamera (misal: cam_living_01)"
                  value={newZoneCameraId || transparency?.monitored_cameras?.[0]?.id || ''}
                  onChange={(e) => setNewZoneCameraId(e.target.value)}
                />
              </div>

              <div>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, display: 'block', marginBottom: 'var(--space-1)' }}>
                  Tipe Zona
                </label>
                <select
                  className={styles.selectInput}
                  value={newZoneType}
                  onChange={(e) => setNewZoneType(e.target.value as any)}
                >
                  <option value="belajar">Zona Belajar (Memonitor durasi duduk)</option>
                  <option value="umum">Zona Umum (Aktivitas biasa)</option>
                  <option value="berbahaya">Zona Berbahaya (Dapur/Tangga saat alarm)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, display: 'block', marginBottom: 'var(--space-1)' }}>
                  Titik Koordinat Poligon (Format: x,y; x,y; ...)
                </label>
                <AppInput
                  placeholder="0.1,0.1; 0.5,0.1; 0.5,0.5; 0.1,0.5"
                  value={newZonePolyStr}
                  onChange={(e) => setNewZonePolyStr(e.target.value)}
                />
              </div>

              <div className={styles.modalActions}>
                <AppButton type="button" variant="outline" onClick={() => setShowZoneModal(false)}>
                  Batal
                </AppButton>
                <AppButton type="submit" variant="primary">
                  Simpan Zona
                </AppButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Dialog: Hapus Semua Data */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        title="Hapus Semua Data Keluarga?"
        message="Tindakan ini akan menghapus seluruh data ringkasan harian dan riwayat kejadian visual secara permanen dari basis data lokal."
        confirmLabel="Hapus Permanen"
        cancelLabel="Batal"
        isDanger={true}
        onConfirm={handleClearAllData}
        onCancel={() => setShowClearConfirm(false)}
      />

      {/* Confirm Dialog: Batalkan Undangan */}
      <ConfirmDialog
        isOpen={Boolean(cancelTarget)}
        title="Batalkan Undangan"
        message={`Apakah Anda yakin ingin membatalkan undangan untuk ${cancelTarget?.email}?`}
        confirmLabel={cancelInviteMutation.isPending ? 'Membatalkan...' : 'Batalkan Undangan'}
        cancelLabel="Kembali"
        isDanger={true}
        onConfirm={handleCancelInviteConfirm}
        onCancel={() => setCancelTarget(null)}
      />

      {/* Confirm Dialog: Keluar dari Keluarga */}
      <ConfirmDialog
        isOpen={showLeaveModal}
        title="Keluar dari Keluarga?"
        message="Apakah Anda yakin ingin keluar dari keluarga ini? Anda akan kehilangan akses kendali saklar, sensor, dan kamera rumah."
        confirmLabel="Ya, Keluar dari Keluarga"
        cancelLabel="Batal"
        isDanger={true}
        isLoading={leaveMutation.isPending}
        onConfirm={() => leaveMutation.mutate()}
        onCancel={() => {
          if (!leaveMutation.isPending) setShowLeaveModal(false);
        }}
      />
    </div>
  );
};
