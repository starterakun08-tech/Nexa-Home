import React, { useEffect, useState } from 'react';
import {
  Info,
  Trash,
  Eye,
  Warning,
  CheckCircle,
  Plus,
  X,
  PaperPlaneTilt,
} from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { AppButton } from '../components/AppButton';
import { AppBadge } from '../components/AppBadge';
import { AppInput } from '../components/AppInput';
import { AppSwitch } from '../components/AppSwitch';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { familyApi } from '../api/family';
import type {
  FamilySettingsData,
  TransparencyData,
  CameraZoneData,
  FamilyEventItem,
} from '../api/family';
import styles from './KeluargaPage.module.css';

export const KeluargaPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // State Data
  const [settings, setSettings] = useState<FamilySettingsData | null>(null);
  const [transparency, setTransparency] = useState<TransparencyData | null>(null);
  const [summaryToday, setSummaryToday] = useState<any>(null);
  const [summaryWeek, setSummaryWeek] = useState<any[]>([]);
  const [events, setEvents] = useState<FamilyEventItem[]>([]);
  const [zones, setZones] = useState<CameraZoneData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Modals
  const [showTransparencyModal, setShowTransparencyModal] = useState<boolean>(false);
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

  const fetchSentInvites = async () => {
    try {
      const res = await familyApi.getSentInvitations();
      setSentInvites(res.invitations || []);
    } catch {
      // ignore
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
      fetchSentInvites();
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
      const transRes = await familyApi.getTransparency();
      setTransparency(transRes);

      if (isAdmin) {
        const [settRes, sumTodayRes, sumWeekRes, evRes, zoneRes] = await Promise.all([
          familyApi.getSettings(),
          familyApi.getSummary('today'),
          familyApi.getSummary('week'),
          familyApi.getEvents(20),
          familyApi.getZones(),
        ]);
        setSettings(settRes.settings);
        setSummaryToday(sumTodayRes?.data || null);
        setSummaryWeek(sumWeekRes?.history || []);
        setEvents(evRes?.events || []);
        setZones(zoneRes?.zones || []);
        if (zoneRes?.zones?.length && !newZoneCameraId && transRes.monitored_cameras.length) {
          setNewZoneCameraId(transRes.monitored_cameras[0].id);
        }
        fetchSentInvites();
      }
    } catch (err) {
      console.error('Failed to load family analytics data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [isAdmin]);

  const handleToggleSetting = async (key: keyof FamilySettingsData, value: any) => {
    if (!settings) return;
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    try {
      await familyApi.updateSettings({ [key]: value });
      fetchData();
    } catch (err) {
      console.error('Failed to update setting:', err);
      fetchData();
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

  // If user is non-admin, show informative transparency view
  if (!isAdmin) {
    return (
      <div className={styles.container}>
        <div className={styles.headerRow}>
          <div className={styles.titleArea}>
            <div className={styles.titleWithBadge}>
              <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>
                Pantauan & Keamanan Ruang Umum
              </h2>
              <AppBadge variant={isWorkerOffline ? 'danger' : 'ok'}>
                {isWorkerOffline ? 'AI Tidak Aktif' : 'AI Aktif'}
              </AppBadge>
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', margin: 0 }}>
              Transparansi sensor ruang umum tanpa pengenalan wajah.
            </p>
          </div>
        </div>

        <div className={styles.disclaimerBanner}>
          <div className={styles.disclaimerIcon}>
            <Info size={22} />
          </div>
          <div className={styles.disclaimerContent}>
            <p className={styles.disclaimerTitle}>
              Bukan alat medis. Hanya angka dan kejadian dari kamera ruang umum, tanpa menyimpan video.
            </p>
            <p className={styles.disclaimerSub}>
              Data analitik hanya dapat diakses oleh akun pengelola utama (Admin). Anda dapat memeriksa kamera dan fitur apa saja yang sedang aktif melalui daftar transparansi di bawah.
            </p>
          </div>
        </div>

        <div className={styles.eventsCard}>
          <h3 className={styles.chartTitle}>Daftar Fitur Yang Dipantau (Transparansi)</h3>
          <div className={styles.transparencyList}>
            <div className={styles.transparencyItem}>
              <span>Aktivitas di Zona Belajar</span>
              <span>{transparency?.active_features.study_zone_monitoring ? 'Aktif' : 'Non-aktif'}</span>
            </div>
            <div className={styles.transparencyItem}>
              <span>Aktivitas Larut Malam</span>
              <span>{transparency?.active_features.late_night_activity_monitoring ? 'Aktif' : 'Non-aktif'}</span>
            </div>
            <div className={styles.transparencyItem}>
              <span>Peringatan Kemungkinan Jatuh</span>
              <span>{transparency?.active_features.fall_detection_monitoring ? 'Aktif' : 'Non-aktif'}</span>
            </div>
            <div className={styles.transparencyItem}>
              <span>Peringatan Zona Berbahaya</span>
              <span>{transparency?.active_features.hazard_zone_monitoring ? 'Aktif' : 'Non-aktif'}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Admin View
  return (
    <div className={styles.container}>
      {/* 1. Header Row */}
      <div className={styles.headerRow}>
        <div className={styles.titleArea}>
          <div className={styles.titleWithBadge}>
            <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>
              Wawasan & Aktivitas Ruang Umum
            </h2>
            <AppBadge variant={isWorkerOffline ? 'danger' : 'ok'}>
              {isWorkerOffline ? 'AI Tidak Aktif' : 'AI Aktif'}
            </AppBadge>
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', margin: 0 }}>
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

      {/* 2. Resilience Banner (Worker Offline) */}
      {isWorkerOffline && (
        <div className={styles.workerOfflineAlert}>
          <Warning size={22} />
          <div>
            <strong>AI Tidak Aktif:</strong> Vision AI Worker sedang offline atau tidak mengirim heartbeat.
            Deteksi postur, zona, dan kemungkinan jatuh tidak beroperasi saat ini.
          </div>
        </div>
      )}

      {/* 2. Kartu Undangan Anggota Keluarga */}
      <div className={styles.zoneEditorCard}>
        <div className={styles.chartHeader}>
          <div>
            <h3 className={styles.chartTitle}>Undang Anggota Keluarga</h3>
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
              Undang anggota keluarga (misal: dtrbimu) untuk bergabung ke rumah dan berbagi kendali perangkat pintar.
            </p>
          </div>
        </div>

        {inviteMsg && (
          <div style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-accent)', fontSize: 'var(--text-xs)', marginBottom: 'var(--space-3)' }}>
            {inviteMsg}
          </div>
        )}
        {inviteError && (
          <div style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-button)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-status-danger)', fontSize: 'var(--text-xs)', marginBottom: 'var(--space-3)' }}>
            {inviteError}
          </div>
        )}

        <form onSubmit={handleSendInvite} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <AppInput
              placeholder="Masukkan email atau username (contoh: dtrbimu)"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </div>
          <AppButton type="submit" variant="primary" disabled={sendingInvite || !inviteEmail.trim()}>
            <PaperPlaneTilt size={16} style={{ marginRight: 6 }} />
            <span>{sendingInvite ? 'Mengirim...' : 'Kirim Undangan'}</span>
          </AppButton>
        </form>

        {sentInvites.length > 0 && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
              Undangan Terkirim:
            </span>
            <div className={styles.transparencyList} style={{ marginTop: 'var(--space-2)' }}>
              {sentInvites.map((inv) => (
                <div key={inv.id} className={styles.transparencyItem}>
                  <div>
                    <strong>{inv.invitee_email}</strong>
                    <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                      Dikirim: {inv.created_at ? new Date(inv.created_at).toLocaleString('id-ID') : '-'}
                    </div>
                  </div>
                  <AppBadge variant={inv.status === 'accepted' ? 'ok' : inv.status === 'rejected' ? 'danger' : 'warn'}>
                    {inv.status === 'accepted' ? 'Diterima' : inv.status === 'rejected' ? 'Ditolak' : 'Menunggu'}
                  </AppBadge>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 3. Non-Medical Disclaimer Banner */}
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

      {/* 4. Daily Metrics Grid */}
      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Aktivitas di Zona Belajar</span>
          <span className={styles.metricValue}>
            {summaryToday ? `${Math.floor(summaryToday.study_minutes / 60)}j ${summaryToday.study_minutes % 60}m` : '0j 0m'}
          </span>
          <span className={styles.metricSub}>Hari ini (postur duduk)</span>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Aktivitas Larut Malam</span>
          <span className={styles.metricValue}>
            {summaryToday?.late_night_count ?? 0}
          </span>
          <span className={styles.metricSub}>Kejadian (23:00 - 04:30)</span>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Peringatan Kemungkinan Jatuh</span>
          <span className={styles.metricValue}>
            {summaryToday?.fall_incident_count ?? 0}
          </span>
          <span className={styles.metricSub}>Perlu dicek admin</span>
        </div>

        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Zona Berbahaya</span>
          <span className={styles.metricValue}>
            {summaryToday?.hazard_alert_count ?? 0}
          </span>
          <span className={styles.metricSub}>Peringatan keamanan</span>
        </div>
      </div>

      {/* 5. Simple CSS Token Charts (Weekly) */}
      <div className={styles.chartsGrid}>
        <div className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <h3 className={styles.chartTitle}>Tren Aktivitas Zona Belajar 7 Hari Terakhir (Menit)</h3>
          </div>
          <div className={styles.barChartContainer}>
            {summaryWeek.length === 0 ? (
              <div style={{ margin: 'auto', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                Belum ada data riwayat mingguan
              </div>
            ) : (
              summaryWeek.map((day, idx) => {
                const maxVal = Math.max(...summaryWeek.map((d) => d.study_minutes), 60);
                const heightPct = Math.min(100, (day.study_minutes / maxVal) * 100);
                const dayLabel = day.date ? day.date.slice(5) : `H-${idx}`;
                return (
                  <div key={day.date || idx} className={styles.barColumn}>
                    <span className={styles.barValue}>{day.study_minutes}m</span>
                    <div className={styles.bar} style={{ height: `${Math.max(4, heightPct)}%` }} />
                    <span className={styles.barLabel}>{dayLabel}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className={styles.chartCard}>
          <div className={styles.chartHeader}>
            <h3 className={styles.chartTitle}>Riwayat Insiden & Larut Malam 7 Hari Terakhir</h3>
          </div>
          <div className={styles.barChartContainer}>
            {summaryWeek.length === 0 ? (
              <div style={{ margin: 'auto', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                Belum ada data riwayat mingguan
              </div>
            ) : (
              summaryWeek.map((day, idx) => {
                const totalIncidents = (day.late_night_count || 0) + (day.fall_incident_count || 0) + (day.hazard_alert_count || 0);
                const maxVal = Math.max(...summaryWeek.map((d) => (d.late_night_count || 0) + (d.fall_incident_count || 0) + (d.hazard_alert_count || 0)), 5);
                const heightPct = Math.min(100, (totalIncidents / maxVal) * 100);
                const dayLabel = day.date ? day.date.slice(5) : `H-${idx}`;
                return (
                  <div key={day.date || idx} className={styles.barColumn}>
                    <span className={styles.barValue}>{totalIncidents}</span>
                    <div
                      className={styles.bar}
                      style={{
                        height: `${Math.max(4, heightPct)}%`,
                        backgroundColor: totalIncidents > 0 ? 'var(--color-status-warn)' : 'var(--color-border)',
                      }}
                    />
                    <span className={styles.barLabel}>{dayLabel}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 6. Feature Cards with Switches & Thresholds */}
      {settings && (
        <div className={styles.eventsCard}>
          <div className={styles.chartHeader}>
            <h3 className={styles.chartTitle}>Konfigurasi & Saklar Fitur Analitik</h3>
            <AppSwitch
              checked={settings.enabled}
              onChange={(val) => handleToggleSetting('enabled', val)}
              label={settings.enabled ? 'Master: AKTIF' : 'Master: NON-AKTIF'}
            />
          </div>

          <div className={styles.featuresGrid}>
            {/* Fitur 1: Zona Belajar */}
            <div className={styles.featureCard}>
              <div className={styles.featureCardHeader}>
                <h4 className={styles.featureTitle}>Aktivitas di Zona Belajar</h4>
                <AppSwitch
                  checked={settings.study_zone_enabled}
                  onChange={(val) => handleToggleSetting('study_zone_enabled', val)}
                />
              </div>
              <p className={styles.featureDesc}>
                Menghitung durasi seseorang berada di zona belajar dengan postur duduk.
              </p>
              <div className={styles.featureInputs}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                  Toleransi jeda:
                </span>
                <input
                  type="number"
                  className={styles.inputNumber}
                  min={1}
                  max={60}
                  value={settings.study_gap_tolerance_minutes}
                  onChange={(e) => handleToggleSetting('study_gap_tolerance_minutes', parseInt(e.target.value) || 5)}
                />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>menit</span>
              </div>
            </div>

            {/* Fitur 2: Larut Malam */}
            <div className={styles.featureCard}>
              <div className={styles.featureCardHeader}>
                <h4 className={styles.featureTitle}>Aktivitas Larut Malam</h4>
                <AppSwitch
                  checked={settings.late_night_enabled}
                  onChange={(val) => handleToggleSetting('late_night_enabled', val)}
                />
              </div>
              <p className={styles.featureDesc}>
                Peringatan jika ada aktivitas di ruang umum pada jam 23:00 - 04:30.
              </p>
              <div className={styles.featureInputs}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                  Batas durasi:
                </span>
                <input
                  type="number"
                  className={styles.inputNumber}
                  min={1}
                  max={120}
                  value={settings.late_night_min_minutes}
                  onChange={(e) => handleToggleSetting('late_night_min_minutes', parseInt(e.target.value) || 15)}
                />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>menit</span>
              </div>
            </div>

            {/* Fitur 3: Kemungkinan Jatuh */}
            <div className={styles.featureCard}>
              <div className={styles.featureCardHeader}>
                <h4 className={styles.featureTitle}>Kemungkinan Jatuh</h4>
                <AppSwitch
                  checked={settings.fall_detection_enabled}
                  onChange={(val) => handleToggleSetting('fall_detection_enabled', val)}
                />
              </div>
              <p className={styles.featureDesc}>
                Peringatan prioritas tinggi jika postur berubah ke berbaring dan tidak bergerak.
              </p>
              <div className={styles.featureInputs}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                  Batas diam:
                </span>
                <input
                  type="number"
                  className={styles.inputNumber}
                  min={10}
                  max={120}
                  value={settings.fall_stationary_seconds}
                  onChange={(e) => handleToggleSetting('fall_stationary_seconds', parseInt(e.target.value) || 30)}
                />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>detik</span>
              </div>
            </div>

            {/* Fitur 4: Tidak Bergerak Lama */}
            <div className={styles.featureCard}>
              <div className={styles.featureCardHeader}>
                <h4 className={styles.featureTitle}>Tidak Bergerak Lama</h4>
                <AppSwitch
                  checked={settings.inactivity_enabled}
                  onChange={(val) => handleToggleSetting('inactivity_enabled', val)}
                />
              </div>
              <p className={styles.featureDesc}>
                Peringatan lembut jika posisi dan postur hampir tetap selama jangka waktu lama.
              </p>
              <div className={styles.featureInputs}>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                  Batas diam:
                </span>
                <input
                  type="number"
                  className={styles.inputNumber}
                  min={30}
                  max={360}
                  value={settings.inactivity_min_minutes}
                  onChange={(e) => handleToggleSetting('inactivity_min_minutes', parseInt(e.target.value) || 120)}
                />
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>menit</span>
              </div>
            </div>

            {/* Fitur 5: Zona Berbahaya */}
            <div className={styles.featureCard}>
              <div className={styles.featureCardHeader}>
                <h4 className={styles.featureTitle}>Orang di Zona Berbahaya</h4>
                <AppSwitch
                  checked={settings.hazard_zone_enabled}
                  onChange={(val) => handleToggleSetting('hazard_zone_enabled', val)}
                />
              </div>
              <p className={styles.featureDesc}>
                Peringatan jika ada orang di area berbahaya saat alarm gas aktif.
              </p>
            </div>

            {/* Fitur 6: Saklar Asisten AI */}
            <div className={styles.featureCard}>
              <div className={styles.featureCardHeader}>
                <h4 className={styles.featureTitle}>Saklar Asisten AI</h4>
                <AppSwitch
                  checked={settings.allow_assistant_family_summary}
                  onChange={(val) => handleToggleSetting('allow_assistant_family_summary', val)}
                />
              </div>
              <p className={styles.featureDesc}>
                Izinkan asisten AI membaca ringkasan agregat angka keluarga (tanpa nama per orang).
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 7. Zona Editor Card */}
      <div className={styles.zoneEditorCard}>
        <div className={styles.chartHeader}>
          <h3 className={styles.chartTitle}>Zona Kamera Terdaftar</h3>
          <AppButton variant="primary" onClick={() => setShowZoneModal(true)}>
            <Plus size={16} style={{ marginRight: 6 }} />
            Tambah Zona
          </AppButton>
        </div>

        {zones.length === 0 ? (
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
            Belum ada zona yang dikonfigurasi. Buat zona untuk mengaktifkan pemantauan zona belajar atau zona berbahaya.
          </p>
        ) : (
          <div className={styles.transparencyList}>
            {zones.map((z) => (
              <div key={z.id} className={styles.transparencyItem}>
                <div>
                  <strong>{z.name}</strong> ({z.zone_type}) — Kamera: {z.camera_id}
                  <div style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                    Poligon: {z.polygon?.length || 0} titik koordinat
                  </div>
                </div>
                <AppButton variant="outline" onClick={() => handleDeleteZone(z.id)}>
                  Hapus
                </AppButton>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 8. Recent Events List */}
      <div className={styles.eventsCard}>
        <h3 className={styles.chartTitle}>Daftar Peringatan & Kejadian Terbaru</h3>
        {events.length === 0 ? (
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
            {isWorkerOffline ? 'Pemantauan offline.' : 'Belum ada catatan kejadian hari ini.'}
          </p>
        ) : (
          events.map((ev) => (
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
                    {ev.event_type}
                  </AppBadge>
                  <h4 className={styles.eventTitle}>{ev.title}</h4>
                  <span className={styles.eventTime}>
                    {new Date(ev.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className={styles.eventDesc}>{ev.description}</p>
              </div>

              {!ev.is_reviewed && (
                <AppButton variant="outline" onClick={() => handleReviewEvent(ev.id)}>
                  <CheckCircle size={16} style={{ marginRight: 6 }} />
                  Tandai Sudah Dilihat
                </AppButton>
              )}
            </div>
          ))
        )}
      </div>

      {/* Transparency Modal */}
      {showTransparencyModal && transparency && (
        <div className={styles.modalBackdrop} onClick={() => setShowTransparencyModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Apa yang Dipantau di Rumah</h3>
              <AppButton variant="ghost" onClick={() => setShowTransparencyModal(false)}>
                <X size={20} />
              </AppButton>
            </div>

            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', margin: 0 }}>
              Halaman transparansi ini dapat dilihat oleh semua anggota keluarga untuk mengetahui fitur apa saja yang aktif tanpa mengekspos data metrik pribadi.
            </p>

            <div className={styles.transparencyList}>
              <div className={styles.transparencyItem}>
                <span>Status AI Vision Worker</span>
                <strong>{transparency.ai_worker_status === 'online' ? 'Online' : 'Offline'}</strong>
              </div>
              <div className={styles.transparencyItem}>
                <span>Pemantauan Zona Belajar</span>
                <span>{transparency.active_features.study_zone_monitoring ? 'Aktif' : 'Non-aktif'}</span>
              </div>
              <div className={styles.transparencyItem}>
                <span>Pemantauan Larut Malam</span>
                <span>{transparency.active_features.late_night_activity_monitoring ? 'Aktif' : 'Non-aktif'}</span>
              </div>
              <div className={styles.transparencyItem}>
                <span>Deteksi Jatuh</span>
                <span>{transparency.active_features.fall_detection_monitoring ? 'Aktif' : 'Non-aktif'}</span>
              </div>
              <div className={styles.transparencyItem}>
                <span>Pemantauan Zona Berbahaya</span>
                <span>{transparency.active_features.hazard_zone_monitoring ? 'Aktif' : 'Non-aktif'}</span>
              </div>
              <div className={styles.transparencyItem}>
                <span>Integrasi Asisten AI</span>
                <span>{transparency.active_features.assistant_integration ? 'Diizinkan' : 'Dinonaktifkan'}</span>
              </div>
            </div>

            <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, margin: 'var(--space-2) 0 0' }}>
              Kamera yang Terhubung:
            </h4>
            <div className={styles.transparencyList}>
              {transparency.monitored_cameras.map((c) => (
                <div key={c.id} className={styles.transparencyItem}>
                  <span>{c.name}</span>
                  <span style={{ color: 'var(--color-text-muted)' }}>{c.room_id}</span>
                </div>
              ))}
            </div>

            <AppButton variant="primary" onClick={() => setShowTransparencyModal(false)}>
              Tutup
            </AppButton>
          </div>
        </div>
      )}

      {/* New Zone Modal */}
      {showZoneModal && (
        <div className={styles.modalBackdrop} onClick={() => setShowZoneModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Tambah Poligon Zona Baru</h3>
              <AppButton variant="ghost" onClick={() => setShowZoneModal(false)}>
                <X size={20} />
              </AppButton>
            </div>

            <form onSubmit={handleCreateZone} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Nama Zona
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Meja Belajar Anak"
                  value={newZoneName}
                  onChange={(e) => setNewZoneName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 'var(--space-2)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-background)',
                    color: 'var(--color-text)',
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Pilih Kamera
                </label>
                <select
                  value={newZoneCameraId}
                  onChange={(e) => setNewZoneCameraId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: 'var(--space-2)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-background)',
                    color: 'var(--color-text)',
                  }}
                >
                  {transparency?.monitored_cameras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Tipe Zona
                </label>
                <select
                  value={newZoneType}
                  onChange={(e) => setNewZoneType(e.target.value as any)}
                  style={{
                    width: '100%',
                    padding: 'var(--space-2)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-background)',
                    color: 'var(--color-text)',
                  }}
                >
                  <option value="belajar">Belajar (Aktivitas Duduk)</option>
                  <option value="umum">Umum</option>
                  <option value="berbahaya">Berbahaya (Dapur/Gas)</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Titik Koordinat Normalisasi [0.0 - 1.0]
                </label>
                <input
                  type="text"
                  value={newZonePolyStr}
                  onChange={(e) => setNewZonePolyStr(e.target.value)}
                  placeholder="x1,y1; x2,y2; x3,y3; x4,y4"
                  style={{
                    width: '100%',
                    padding: 'var(--space-2)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-background)',
                    color: 'var(--color-text)',
                  }}
                />
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: 4, display: 'block' }}>
                  Format: x1,y1; x2,y2; x3,y3 (koordinat 0.0 s.d 1.0 dipisahkan titik koma)
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
                <AppButton variant="outline" type="button" onClick={() => setShowZoneModal(false)}>
                  Batal
                </AppButton>
                <AppButton variant="primary" type="submit">
                  Simpan Zona
                </AppButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        title="Hapus Semua Data Keluarga?"
        message="Aksi ini akan menghapus seluruh riwayat kejadian analitik dan ringkasan statistik keluarga secara permanen dari basis data. Pengaturan saklar dan zona tidak akan dihapus."
        confirmLabel="Hapus Permanen"
        cancelLabel="Batal"
        isDanger={true}
        onConfirm={handleClearAllData}
        onCancel={() => setShowClearConfirm(false)}
      />
    </div>
  );
};
