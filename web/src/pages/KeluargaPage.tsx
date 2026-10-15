import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Info,
  Trash,
  Eye,
  Warning,
  CheckCircle,
  Plus,
  X,
  PaperPlaneTilt,
  CaretRight,
  UserMinus,
} from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { AppButton } from '../components/AppButton';
import { AppBadge } from '../components/AppBadge';
import { AppInput } from '../components/AppInput';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { familyApi } from '../api/family';
import type {
  FamilySettingsData,
  TransparencyData,
  CameraZoneData,
  FamilyEventItem,
} from '../api/family';
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
  const { user } = useAuth();
  const navigate = useNavigate();
  const isOwner = user?.role === 'pemilik' || user?.role === 'admin';
  const isAnggota = user?.role === 'anggota' || user?.role === 'member';
  const isAdmin = isOwner;

  // State Data
  const [settings, setSettings] = useState<FamilySettingsData>({
    enabled: false,
    study_zone_enabled: false,
    study_gap_tolerance_minutes: null,
    late_night_enabled: false,
    late_night_start: '23:00',
    late_night_end: '04:30',
    late_night_min_minutes: null,
    fall_detection_enabled: false,
    fall_stationary_seconds: null,
    inactivity_enabled: false,
    inactivity_min_minutes: null,
    hazard_zone_enabled: false,
    hazard_stay_duration_seconds: null,
    allow_assistant_family_summary: true,
    stats_retention_days: 30,
    events_retention_days: 90,
  });
  const [transparency, setTransparency] = useState<TransparencyData | null>(null);
  const [summaryToday, setSummaryToday] = useState<any>(null);
  const [summaryWeek, setSummaryWeek] = useState<any[]>([]);
  const [events, setEvents] = useState<FamilyEventItem[]>([]);
  const [zones, setZones] = useState<CameraZoneData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Modals
  const [showTransparencyModal, setShowTransparencyModal] = useState<boolean>(false);
  const [showInviteModal, setShowInviteModal] = useState<boolean>(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState<boolean>(false);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const [showZoneModal, setShowZoneModal] = useState<boolean>(false);

  // New Zone State
  const [newZoneName, setNewZoneName] = useState('');
  const [newZoneType, setNewZoneType] = useState<'belajar' | 'umum' | 'berbahaya'>('belajar');
  const [newZoneCameraId, setNewZoneCameraId] = useState('');
  const [newZonePolyStr, setNewZonePolyStr] = useState('0.1,0.1; 0.5,0.1; 0.5,0.5; 0.1,0.5');

  // Direct Family Invite State
  const [inviteEmail, setInviteEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [inviteMsg, setInviteMsg] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [sentInvites, setSentInvites] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  // Kick & Cancel Invites Modal State
  const [kickTarget, setKickTarget] = useState<{ id: number; name: string } | null>(null);
  const [kickLoading, setKickLoading] = useState(false);
  const [cancelInviteTarget, setCancelInviteTarget] = useState<{ id: number; email: string } | null>(null);
  const [cancelInviteLoading, setCancelInviteLoading] = useState(false);

  const handleKickConfirm = async () => {
    if (!kickTarget) return;
    setKickLoading(true);
    setInviteMsg('');
    setInviteError('');
    try {
      const res = await familyApi.removeMember(kickTarget.id);
      setInviteMsg(res.message);
      await fetchMembersList();
    } catch (err: any) {
      setInviteError(err?.message || 'Gagal mengeluarkan anggota keluarga.');
    } finally {
      setKickLoading(false);
      setKickTarget(null);
    }
  };

  const handleCancelInviteConfirm = async () => {
    if (!cancelInviteTarget) return;
    setCancelInviteLoading(true);
    setInviteMsg('');
    setInviteError('');
    try {
      const res = await familyApi.cancelInvitation(cancelInviteTarget.id);
      setInviteMsg(res.message);
      await fetchMembersList();
    } catch (err: any) {
      setInviteError(err?.message || 'Gagal membatalkan undangan.');
    } finally {
      setCancelInviteLoading(false);
      setCancelInviteTarget(null);
    }
  };

  const fetchMembersList = async () => {
    try {
      setMembersLoading(true);
      const resMem = await familyApi.getMembers().catch((e) => {
        console.warn('Could not load family members:', e);
        return { status: 'error', family_id: 0, members: [] };
      });
      setMembers(resMem.members || []);

      if (isAdmin) {
        try {
          const resInv = await familyApi.getSentInvitations();
          setSentInvites(resInv.invitations || []);
        } catch {
          setSentInvites([]);
        }
      }
    } catch {
      // ignore
    } finally {
      setMembersLoading(false);
    }
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const target = inviteEmail.trim();
    if (!target) return;
    setSendingInvite(true);
    setInviteMsg('');
    setInviteError('');
    try {
      const res = await familyApi.inviteMember(target);
      setInviteMsg(res.message || `Undangan berhasil dikirim ke ${target}.`);
      setInviteEmail('');
      setShowInviteModal(false);
      fetchMembersList();
    } catch (err: any) {
      setInviteError(err?.message || 'Gagal mengirim undangan keluarga.');
    } finally {
      setSendingInvite(false);
    }
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      // Transparency endpoint can be loaded by anyone
      try {
        const transRes = await familyApi.getTransparency();
        setTransparency(transRes);
        if (transRes?.monitored_cameras?.length && !newZoneCameraId) {
          setNewZoneCameraId(transRes.monitored_cameras[0].id);
        }
      } catch (e) {
        console.warn('Could not load transparency data:', e);
      }

      // Selalu muat seluruh anggota keluarga untuk semua role (admin maupun member)
      await fetchMembersList();

      // Muat konfigurasi fitur analitik untuk peran Admin dan Anggota
      if (isAdmin || user?.role === 'member') {
        try {
          const settRes = await familyApi.getSettings();
          if (settRes?.settings) {
            setSettings(settRes.settings);
          }
        } catch (e) {
          console.warn('Could not load family settings:', e);
        }
      }

      if (isOwner) {
        const results = await Promise.allSettled([
          familyApi.getSummary('today'),
          familyApi.getSummary('week'),
          familyApi.getEvents(20),
          familyApi.getZones(),
        ]);
        const [sumTodayRes, sumWeekRes, evRes, zoneRes] = results;
        if (sumTodayRes.status === 'fulfilled') {
          setSummaryToday(sumTodayRes.value?.data || null);
        }
        if (sumWeekRes.status === 'fulfilled') {
          setSummaryWeek(sumWeekRes.value?.history || []);
        }
        if (evRes.status === 'fulfilled') {
          setEvents(evRes.value?.events || []);
        }
        if (zoneRes.status === 'fulfilled') {
          setZones(zoneRes.value?.zones || []);
        }
      }
    } catch (err) {
      console.error('Failed to load family analytics data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user?.role, user?.family_id, user?.id, isOwner, isAnggota]);

  const handleToggleSetting = async (key: keyof FamilySettingsData, value: any) => {
    if (!settings) return;
    const previous = settings;
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    try {
      await familyApi.updateSettings({ [key]: value });
    } catch (err) {
      console.error('Failed to update setting:', err);
      setSettings(previous);
    }
  };

  const handleReviewEvent = async (id: string) => {
    try {
      await familyApi.reviewEvent(id);
      setEvents((prev) =>
        prev.map((e) => (e.id === id ? { ...e, is_reviewed: true } : e))
      );
    } catch (err) {
      console.error('Failed to review event:', err);
    }
  };

  const handleClearAllData = async () => {
    try {
      await familyApi.clearAllData();
      setShowClearConfirm(false);
      fetchData();
    } catch (err) {
      console.error('Failed to clear family data:', err);
    }
  };

  const handleCreateZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newZoneName || !newZoneCameraId) return;

    // Parse coordinates string "0.1,0.1; 0.5,0.1; 0.5,0.5" into [[0.1, 0.1], ...]
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
      alert('Poligon membutuhkan minimal 3 titik koordinat!');
      return;
    }

    try {
      await familyApi.createZone({
        camera_id: newZoneCameraId,
        name: newZoneName,
        zone_type: newZoneType,
        polygon: polyPoints,
      });
      setShowZoneModal(false);
      setNewZoneName('');
      fetchData();
    } catch (err) {
      console.error('Failed to create zone:', err);
    }
  };

  const handleDeleteZone = async (zoneId: string) => {
    if (!confirm('Hapus zona ini?')) return;
    try {
      await familyApi.deleteZone(zoneId);
      fetchData();
    } catch (err) {
      console.error('Failed to delete zone:', err);
    }
  };

  const isWorkerOffline = transparency?.ai_worker_status === 'offline';

  if (loading && !transparency) {
    return (
      <div className={styles.container}>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Memuat data wawasan...</p>
      </div>
    );
  }

  // Urutkan anggota: Admin/Pemilik di atas, diikuti Anggota
  const owners = members.filter((m) => m.role === 'admin' || m.role === 'pemilik' || m.is_owner);
  const activeMembers = members.filter((m) => m.role !== 'admin' && m.role !== 'pemilik' && !m.is_owner);
  const pendingInvites = sentInvites.filter((inv) => inv.status === 'pending' || inv.status === 'menunggu');
  return (
    <div className={styles.container}>
      {/* 1. Banner Status Deteksi (Kondisional: hanya bila Vision Worker tidak aktif) */}
      {isWorkerOffline && (
        <div className={styles.detectionAlert}>
          <Warning size={20} className={styles.detectionAlertIcon} />
          <span>
            Deteksi aktivitas tidak aktif. Layanan penglihatan tidak merespons, jadi deteksi postur, zona, dan jatuh tidak berjalan.
          </span>
        </div>
      )}

      {/* 2. Blok Pembuka (Header Anggota Nexa Home) */}
      <div className={styles.familyHeaderRow}>
        <div className={styles.familyHeaderLeft}>
          <h2 className={styles.familyTitle}>Anggota Nexa Home</h2>
          <p className={styles.familySubtitle}>
            Anggota Nexa Home bisa mengontrol perangkat sesuai perannya. Hanya admin yang bisa melihat ringkasan aktivitas keluarga.{' '}
            <button
              type="button"
              className={styles.textLink}
              onClick={() => setShowPrivacyModal(true)}
            >
              Pelajari peran dan privasi
            </button>
            {' · '}
            <button
              type="button"
              className={styles.textLink}
              onClick={() => setShowTransparencyModal(true)}
            >
              Fitur yang dipantau
            </button>
          </p>
        </div>

        {isOwner && (
          <div className={styles.familyHeaderRight}>
            <AppButton variant="primary" onClick={() => setShowInviteModal(true)}>
              <Plus size={16} />
              <span>Undang anggota</span>
            </AppButton>
          </div>
        )}
      </div>

      {inviteMsg && (
        <div style={{ padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-accent-light)', color: 'var(--color-accent)', fontSize: 'var(--text-xs)' }}>
          {inviteMsg}
        </div>
      )}
      {inviteError && (
        <div style={{ padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-status-danger)', fontSize: 'var(--text-xs)' }}>
          {inviteError}
        </div>
      )}

      {/* 3. Daftar Anggota (Segmented List ala Google Family) */}
      <div className={styles.segmentedCard}>
        {membersLoading && members.length === 0 ? (
          <div className={styles.emptyRow}>Memuat data anggota Nexa Home...</div>
        ) : members.length === 0 && pendingInvites.length === 0 ? (
          <div className={styles.emptyRow}>Belum ada anggota terdaftar.</div>
        ) : (
          <>
            {/* 1. Admin (Pemilik utama) */}
            {owners.map((m) => {
              const isCurrentUser = (user?.id && m.id === user.id) || (user?.username && m.username === user.username);
              const displayName = m.full_name || m.username;
              const initial = displayName.charAt(0).toUpperCase();
              return (
                <div
                  key={`owner-${m.id}`}
                  className={`${styles.segmentedRow} ${!isAdmin ? styles.rowReadOnly : ''}`}
                  onClick={() => {
                    if (isAdmin) {
                      navigate(`/keluarga/${m.id}`);
                    }
                  }}
                  role={isAdmin ? 'button' : undefined}
                  tabIndex={isAdmin ? 0 : undefined}
                >
                  <div className={styles.rowLeft}>
                    <div className={styles.avatar}>{initial}</div>
                    <div className={styles.rowInfo}>
                      <div className={styles.nameLine}>
                        <span className={styles.memberName}>{displayName}</span>
                        {isCurrentUser && <span className={styles.youBadge}>(Anda)</span>}
                      </div>
                      <span className={styles.roleSubtext}>Pengelola akun keluarga</span>
                    </div>
                  </div>
                  <div className={styles.rowRight}>
                    {isAdmin && <CaretRight size={18} className={styles.chevronIcon} />}
                  </div>
                </div>
              );
            })}

            {/* 2. Anggota aktif */}
            {activeMembers.map((m) => {
              const isCurrentUser = (user?.id && m.id === user.id) || (user?.username && m.username === user.username);
              const displayName = m.full_name || m.username;
              const initial = displayName.charAt(0).toUpperCase();
              return (
                <div
                  key={`member-${m.id}`}
                  className={`${styles.segmentedRow} ${!isAdmin ? styles.rowReadOnly : ''}`}
                  onClick={() => {
                    if (isAdmin) {
                      navigate(`/keluarga/${m.id}`);
                    }
                  }}
                  role={isAdmin ? 'button' : undefined}
                  tabIndex={isAdmin ? 0 : undefined}
                >
                  <div className={styles.rowLeft}>
                    <div className={styles.avatar}>{initial}</div>
                    <div className={styles.rowInfo}>
                      <div className={styles.nameLine}>
                        <span className={styles.memberName}>{displayName}</span>
                        {isCurrentUser && <span className={styles.youBadge}>(Anda)</span>}
                        {isAdmin && !isCurrentUser && (
                          <button
                            type="button"
                            className={styles.kickBtnInline}
                            onClick={(e) => {
                              e.stopPropagation();
                              setKickTarget({ id: m.id, name: displayName });
                            }}
                            title={`Keluarkan ${displayName} dari Nexa Home`}
                            aria-label={`Keluarkan ${displayName} dari Nexa Home`}
                          >
                            <UserMinus size={13} />
                            <span>Keluarkan</span>
                          </button>
                        )}
                      </div>
                      <span className={styles.roleSubtext}>Anggota</span>
                    </div>
                  </div>
                  <div className={styles.rowRight}>
                    {isAdmin && <CaretRight size={18} className={styles.chevronIcon} />}
                  </div>
                </div>
              );
            })}

            {/* 3. Undangan tertunda (Hanya Pemilik/Admin) */}
            {isAdmin && pendingInvites.map((inv) => {
              const initial = (inv.invitee_email || 'U').charAt(0).toUpperCase();
              return (
                <div
                  key={`invite-${inv.id}`}
                  className={`${styles.segmentedRow} ${styles.rowPending}`}
                >
                  <div className={styles.rowLeft}>
                    <div className={`${styles.avatar} ${styles.avatarPending}`}>{initial}</div>
                    <div className={styles.rowInfo}>
                      <span className={styles.memberName}>{inv.invitee_email}</span>
                      <div className={styles.pendingStatusLine}>
                        <span className={styles.warningDot} />
                        <span className={styles.pendingText}>Menunggu diterima</span>
                      </div>
                    </div>
                  </div>
                  <div className={styles.rowRight}>
                    {isAdmin && (
                      <button
                        type="button"
                        className={styles.cancelInviteBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCancelInviteTarget({ id: inv.id, email: inv.invitee_email });
                        }}
                        title={`Batalkan undangan untuk ${inv.invitee_email}`}
                      >
                        <X size={14} />
                        <span>Batalkan</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* 4. Section Wawasan & Aktivitas Ruang Umum (Khusus Admin) */}
      {isAdmin && (
        <>
          <div className={styles.headerRow} style={{ marginTop: 'var(--space-6)' }}>
            <div className={styles.titleArea}>
              <div className={styles.titleWithBadge}>
                <h2 className={styles.pageHeaderTitle}>
                  Wawasan & Aktivitas Ruang Umum
                </h2>
                <AppBadge variant={isWorkerOffline ? 'danger' : 'ok'}>
                  {isWorkerOffline ? 'AI Tidak Aktif' : 'AI Aktif'}
                </AppBadge>
              </div>
              <p className={styles.pageHeaderSubtitle}>
                Statistik per zona dan rumah dari kamera ruang umum tanpa pengenalan wajah.
              </p>
            </div>

            <div className={styles.headerActions}>
              <AppButton
                variant="outline"
                onClick={() => setShowTransparencyModal(true)}
              >
                <Eye size={16} style={{ marginRight: 6 }} />
                Apa yang Dipantau
              </AppButton>
              <AppButton
                variant="outline"
                onClick={() => setShowClearConfirm(true)}
              >
                <Trash size={16} style={{ marginRight: 6 }} />
                Hapus Semua Data
              </AppButton>
            </div>
          </div>

          {/* Non-Medical Disclaimer Banner */}
          <div className={styles.disclaimerBanner}>
            <div className={styles.disclaimerIcon}>
              <Info size={22} />
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
              <span className={styles.metricValue} style={{ color: (summaryToday?.fall_incident_count || 0) > 0 ? 'var(--color-status-danger)' : undefined }}>
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

          {/* Weekly Trend Bar Chart */}
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
                          backgroundColor: 'var(--color-accent)',
                        }}
                      />
                      <span className={styles.barLabel}>{dayLabel}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}

      {/* 5. Konfigurasi & Saklar Fitur Analitik (Akses Penuh: Admin & Anggota) */}
      {settings && (isAdmin || user?.role === 'member') && (
            <main className={styles.analyticsWrap} id="wrap" data-master={settings.enabled ? 'on' : 'off'}>
              <header className={styles.analyticsHead}>
                <div>
                  <h2 className={styles.analyticsTitle}>Fitur analitik</h2>
                  <p className={styles.analyticsSubtitle}>Pilih fitur yang aktif dan atur batas waktunya.</p>
                </div>
                <div className={styles.masterControl}>
                  <span className={styles.masterState} id="master-state" aria-live="polite">
                    {settings.enabled ? 'Aktif' : 'Nonaktif'}
                  </span>
                  <label className={styles.customSwitch}>
                    <input
                      type="checkbox"
                      role="switch"
                      id="master"
                      aria-label="Aktifkan semua fitur analitik"
                      checked={settings.enabled}
                      onChange={(e) => handleToggleSetting('enabled', e.target.checked)}
                    />
                    <span className={styles.switchTrack} />
                    <span className={styles.switchThumb} />
                  </label>
                </div>
              </header>

              <section
                className={`${styles.analyticsGrid} ${!settings.enabled ? styles.analyticsGridDimmed : ''}`}
                id="grid"
              >
                {/* 1. zona_belajar: "Aktivitas di zona belajar" | calm | param: Toleransi jeda (5 menit) */}
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
                        disabled={!settings.enabled}
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
                    disabled={!settings.enabled}
                    unit="menit"
                    paramLabel="Toleransi jeda"
                    ariaLabel="Toleransi jeda menit"
                    onChange={(val) => handleToggleSetting('study_gap_tolerance_minutes', val)}
                  />
                  <p className={styles.cardDesc}>
                    Hitung berapa lama seseorang duduk di zona belajar.
                  </p>
                </div>

                {/* 2. larut_malam: "Aktivitas larut malam" | calm | param: Batas durasi (15 menit) */}
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
                        disabled={!settings.enabled}
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
                    disabled={!settings.enabled}
                    unit="menit"
                    paramLabel="Batas durasi"
                    ariaLabel="Batas durasi menit"
                    onChange={(val) => handleToggleSetting('late_night_min_minutes', val)}
                  />
                  <p className={styles.cardDesc}>
                    Peringatan jika ada aktivitas di ruang umum pukul 23.00-04.30.
                  </p>
                </div>

                {/* 3. jatuh: "Kemungkinan jatuh" | urgent | param: Batas diam (30 detik) */}
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
                        disabled={!settings.enabled}
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
                    disabled={!settings.enabled}
                    unit="detik"
                    paramLabel="Batas diam"
                    ariaLabel="Batas diam detik"
                    onChange={(val) => handleToggleSetting('fall_stationary_seconds', val)}
                  />
                  <p className={styles.cardDesc}>
                    Peringatan prioritas tinggi jika postur berubah ke berbaring dan tidak bergerak.
                  </p>
                </div>

                {/* 4. diam_lama: "Tidak bergerak lama" | calm | param: Batas diam (120 menit) */}
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
                        disabled={!settings.enabled}
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
                    disabled={!settings.enabled}
                    unit="menit"
                    paramLabel="Batas diam"
                    ariaLabel="Batas diam menit"
                    onChange={(val) => handleToggleSetting('inactivity_min_minutes', val)}
                  />
                  <p className={styles.cardDesc}>
                    Peringatan jika posisi dan postur hampir tidak berubah dalam waktu lama.
                  </p>
                </div>

                {/* 5. zona_bahaya: "Orang di zona berbahaya" | urgent | param: Batas waktu (detik) */}
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
                        disabled={!settings.enabled}
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
                    disabled={!settings.enabled}
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
            </main>
      )}

      {/* 6. Zona Editor Card & 7. Riwayat Kejadian (Khusus Admin) */}
      {isAdmin && (
        <>
          {/* 6. Zona Editor Card */}
          <div className={styles.zoneEditorCard}>
            <div className={styles.chartHeader}>
              <h3 className={styles.chartTitle}>Zona Kamera Terdaftar</h3>
              <AppButton variant="primary" onClick={() => setShowZoneModal(true)}>
                <Plus size={16} />
                <span>Tambah Zona Baru</span>
              </AppButton>
            </div>
            {zones.length === 0 ? (
              <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                Belum ada zona yang dikonfigurasi. Buat zona untuk mengaktifkan pemantauan zona belajar atau zona berbahaya.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {zones.map((z) => (
                  <div key={z.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-2) 0', borderBottom: 'var(--border-width) solid var(--color-border)' }}>
                    <div>
                      <strong>{z.name}</strong> ({z.zone_type}) · Kamera: {z.camera_id}
                    </div>
                    <AppButton variant="outline" onClick={() => handleDeleteZone(z.id)}>
                      <Trash size={14} />
                      <span>Hapus</span>
                    </AppButton>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 7. Riwayat Kejadian Terakhir */}
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
                        <AppBadge variant={ev.severity === 'critical' ? 'danger' : ev.severity === 'warning' ? 'warn' : 'neutral'}>
                          {ev.severity.toUpperCase()}
                        </AppBadge>
                        <h4 className={styles.eventTitle}>{ev.title}</h4>
                        <span className={styles.eventTime}>{ev.created_at ? new Date(ev.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}</span>
                      </div>
                      <p className={styles.eventDesc}>{ev.description}</p>
                    </div>

                    {!ev.is_reviewed && (
                      <AppButton
                        variant="outline"
                        onClick={() => handleReviewEvent(ev.id)}
                      >
                        <CheckCircle size={16} style={{ marginRight: 6 }} />
                        Tandai Ditinjau
                      </AppButton>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}



      {/* Modal Dialog: Undang Anggota Baru */}
      {showInviteModal && (
        <div className={styles.modalBackdrop} onClick={() => setShowInviteModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Undang Anggota Baru</h3>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text)' }}
              >
                <X size={20} />
              </button>
            </div>
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
              Kirim undangan ke email atau username anggota agar dapat bergabung ke Nexa Home dan berbagi kendali perangkat.
            </p>
            <form onSubmit={handleSendInvite} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <AppInput
                placeholder="Masukkan email atau username (contoh: budi@gmail.com)"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
                <AppButton type="button" variant="outline" onClick={() => setShowInviteModal(false)}>
                  Batal
                </AppButton>
                <AppButton type="submit" variant="primary" disabled={sendingInvite || !inviteEmail.trim()}>
                  <PaperPlaneTilt size={16} />
                  <span>{sendingInvite ? 'Mengirim...' : 'Kirim Undangan'}</span>
                </AppButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Dialog: Pelajari Peran dan Privasi */}
      {showPrivacyModal && (
        <div className={styles.modalBackdrop} onClick={() => setShowPrivacyModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Peran Anggota & Kebijakan Privasi Nexa Home</h3>
              <button
                type="button"
                onClick={() => setShowPrivacyModal(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text)' }}
              >
                <X size={20} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', fontSize: 'var(--text-xs)', color: 'var(--color-text)', lineHeight: 1.6 }}>
              <div>
                <strong style={{ color: 'var(--color-accent)' }}>1. Peran Admin (Pengelola Nexa Home):</strong>
                <p style={{ margin: 'var(--space-1) 0 0 0', color: 'var(--color-text-secondary)' }}>
                  Memiliki kontrol penuh atas perangkat saklar dan sensor, mengundang atau mengeluarkan anggota keluarga, mengatur zona kamera, serta melihat ringkasan metrik analitik keluarga.
                </p>
              </div>
              <div>
                <strong style={{ color: 'var(--color-accent)' }}>2. Peran Anggota:</strong>
                <p style={{ margin: 'var(--space-1) 0 0 0', color: 'var(--color-text-secondary)' }}>
                  Memiliki kendali perangkat Nexa Home untuk kenyamanan sehari-hari. Anggota tidak memiliki akses untuk melihat ringkasan analitik, riwayat kejadian, maupun konfigurasi privasi.
                </p>
              </div>
              <div>
                <strong style={{ color: 'var(--color-accent)' }}>3. Komitmen Privasi Lokal:</strong>
                <p style={{ margin: 'var(--space-1) 0 0 0', color: 'var(--color-text-secondary)' }}>
                  Kamera ruang umum tidak pernah menyimpan rekaman video dan tidak menggunakan pengenalan wajah. Seluruh inferensi postur tubuh dan zona berjalan 100% lokal pada server Nexa Home Anda.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
              <AppButton variant="primary" onClick={() => setShowPrivacyModal(false)}>
                Saya Mengerti
              </AppButton>
            </div>
          </div>
        </div>
      )}

      {/* Modal Dialog: Apa yang Dipantau (Transparency) */}
      {showTransparencyModal && (
        <div className={styles.modalBackdrop} onClick={() => setShowTransparencyModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Apa yang Dipantau di Nexa Home</h3>
              <button
                type="button"
                onClick={() => setShowTransparencyModal(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text)' }}
              >
                <X size={20} />
              </button>
            </div>
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
              {transparency?.disclaimer || 'Transparansi pemantauan ruang umum.'}
            </p>
            <div className={styles.transparencyList}>
              <div className={styles.transparencyItem}>
                <span>Status AI Vision Worker:</span>
                <strong>{transparency?.ai_worker_status === 'online' ? 'Beroperasi' : 'Tidak Aktif'}</strong>
              </div>
              <div className={styles.transparencyItem}>
                <span>Pemantauan Zona Belajar:</span>
                <span>{transparency?.active_features.study_zone_monitoring ? 'Aktif' : 'Nonaktif'}</span>
              </div>
              <div className={styles.transparencyItem}>
                <span>Aktivitas Larut Malam:</span>
                <span>{transparency?.active_features.late_night_activity_monitoring ? 'Aktif' : 'Nonaktif'}</span>
              </div>
              <div className={styles.transparencyItem}>
                <span>Deteksi Jatuh:</span>
                <span>{transparency?.active_features.fall_detection_monitoring ? 'Aktif' : 'Nonaktif'}</span>
              </div>
              <div className={styles.transparencyItem}>
                <span>Deteksi Zona Berbahaya:</span>
                <span>{transparency?.active_features.hazard_zone_monitoring ? 'Aktif' : 'Nonaktif'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Tambah Zona Kamera */}
      {showZoneModal && (
        <div className={styles.modalBackdrop} onClick={() => setShowZoneModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Tambah Zona Baru</h3>
              <button
                type="button"
                onClick={() => setShowZoneModal(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text)' }}
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateZone} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600 }}>Nama Zona</label>
                <AppInput
                  placeholder="Misal: Meja Belajar Anak"
                  value={newZoneName}
                  onChange={(e) => setNewZoneName(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600 }}>ID Kamera</label>
                <AppInput
                  placeholder="ID Kamera (misal: cam_living_01)"
                  value={newZoneCameraId}
                  onChange={(e) => setNewZoneCameraId(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600 }}>Tipe Zona</label>
                <select
                  style={{ width: '100%', height: 'var(--control-height)', borderRadius: 'var(--radius-sm)', border: 'var(--border-width) solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', padding: '0 var(--space-3)' }}
                  value={newZoneType}
                  onChange={(e) => setNewZoneType(e.target.value as any)}
                >
                  <option value="belajar">Zona Belajar (Memonitor durasi duduk)</option>
                  <option value="umum">Zona Umum (Aktivitas biasa)</option>
                  <option value="berbahaya">Zona Berbahaya (Dapur/Tangga saat alarm)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600 }}>Titik Koordinat Poligon (Format: x,y; x,y; ...)</label>
                <AppInput
                  placeholder="0.1,0.1; 0.5,0.1; 0.5,0.5; 0.1,0.5"
                  value={newZonePolyStr}
                  onChange={(e) => setNewZonePolyStr(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
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

      {/* Confirm Clear All Data Modal */}
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

      {/* Confirm Kick Member Modal */}
      <ConfirmDialog
        isOpen={!!kickTarget}
        title="Keluarkan Anggota Keluarga"
        message={`Apakah Anda yakin ingin mengeluarkan ${kickTarget?.name} dari keluarga? Akses perangkat dan pantauan Nexa Home mereka akan langsung dicabut.`}
        confirmLabel={kickLoading ? 'Mengeluarkan...' : 'Keluarkan Anggota'}
        cancelLabel="Batal"
        isDanger={true}
        onConfirm={handleKickConfirm}
        onCancel={() => setKickTarget(null)}
      />

      {/* Confirm Cancel Invitation Modal */}
      <ConfirmDialog
        isOpen={!!cancelInviteTarget}
        title="Batalkan Undangan Keluarga"
        message={`Apakah Anda yakin ingin membatalkan undangan untuk ${cancelInviteTarget?.email}?`}
        confirmLabel={cancelInviteLoading ? 'Membatalkan...' : 'Batalkan Undangan'}
        cancelLabel="Kembali"
        isDanger={true}
        onConfirm={handleCancelInviteConfirm}
        onCancel={() => setCancelInviteTarget(null)}
      />
    </div>
  );
};
