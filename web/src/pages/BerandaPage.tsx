import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Lightbulb,
  Fan,
  Power,
  Flame,
  Sun,
  VideoCamera,
  Clock,
  Plus,
  CheckCircle,
  X,
  UsersThree,
} from '@phosphor-icons/react';
import { devicesApi, type DeviceItem, type ChannelItem } from '../api/devices';
import { camerasApi, type CameraItem } from '../api/cameras';
import { auditApi, type AuditLogItem } from '../api/audit';
import { familyApi, type FamilyInvitationItem } from '../api/family';
import { authApi } from '../api/auth';
import { useAuth } from '../context/AuthContext';
import { deviceWs, type WebSocketMessage } from '../api/websocket';
import { AppSwitch } from '../components/AppSwitch';
import { AppButton } from '../components/AppButton';
import { AppInput } from '../components/AppInput';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import styles from './BerandaPage.module.css';

export const BerandaPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { setUser, refreshUser } = useAuth();
  const [confirmTurnOffAll, setConfirmTurnOffAll] = useState(false);
  const [turnOffLoading, setTurnOffLoading] = useState(false);

  // Claim Device Modal State
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState(false);
  const [claimError, setClaimError] = useState('');

  const handleClaimDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = pairCode.trim();
    const name = deviceName.trim();
    let targetId = deviceId.trim();
    let finalCode = code;

    // Dukung format gabungan ID:KODE (contoh: esp32_559ed8:537591)
    if (code.includes(':')) {
      const parts = code.split(':');
      if (parts.length >= 2) {
        targetId = parts[0].trim();
        finalCode = parts[1].trim();
      }
    }

    const cleanFinalCode = finalCode.replace(/[\s-]/g, '').toUpperCase();

    if (!cleanFinalCode) {
      setClaimError('Masukkan 6-digit Kode Pairing (contoh: 537591).');
      return;
    }

    if (!name) {
      setClaimError('Masukkan nama perangkat.');
      return;
    }

    setClaimLoading(true);
    setClaimError('');
    try {
      await devicesApi.claimDevice({
        device_id: targetId,
        claim_token: cleanFinalCode,
        name,
        room: 'Ruang Tamu',
      });
      try {
        await refreshUser();
        const me = await authApi.getMe();
        setUser(me);
      } catch {
        // fallback
      }
      setClaimLoading(false);
      setClaimSuccess(true);
      await queryClient.invalidateQueries({ queryKey: ['devices'] });
      await queryClient.refetchQueries({ queryKey: ['devices'] });
    } catch (err: any) {
      setClaimLoading(false);
      setClaimError(err?.message || 'Gagal menghubungkan perangkat. Pastikan ESP32 telah terhubung WiFi.');
    }
  };

  // 1. Fetch devices & channels
  const { data: devices = [], isLoading: devicesLoading } = useQuery<DeviceItem[]>({
    queryKey: ['devices'],
    queryFn: devicesApi.getDevices,
    refetchInterval: 5000,
  });

  // 2. Fetch cameras
  const { data: cameras = [] } = useQuery<CameraItem[]>({
    queryKey: ['cameras'],
    queryFn: camerasApi.getCameras,
    refetchInterval: 10000,
  });

  // 3. Fetch audit logs
  const { data: auditLogs = [] } = useQuery<AuditLogItem[]>({
    queryKey: ['audit-logs'],
    queryFn: () => auditApi.getLogs(10),
    refetchInterval: 10000,
  });

  // 4. Fetch incoming family invitations for target user
  const { data: invitationsData } = useQuery<{ status: string; invitations: FamilyInvitationItem[] }>({
    queryKey: ['family-invitations'],
    queryFn: familyApi.getInvitations,
    refetchInterval: 5000,
  });

  const pendingInvitations = invitationsData?.invitations || [];
  const [respondingId, setRespondingId] = useState<number | null>(null);
  const [inviteFeedback, setInviteFeedback] = useState<{ type: 'ok' | 'error'; message: string } | null>(null);

  const handleRespondInvite = async (invitationId: number, action: 'accept' | 'reject') => {
    setRespondingId(invitationId);
    setInviteFeedback(null);
    try {
      const res = await familyApi.respondInvitation(invitationId, action);
      setInviteFeedback({
        type: 'ok',
        message: res.message || (action === 'accept' ? 'Undangan diterima!' : 'Undangan ditolak.'),
      });
      queryClient.invalidateQueries({ queryKey: ['family-invitations'] });
      queryClient.invalidateQueries({ queryKey: ['family-members'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      try {
        await refreshUser();
      } catch {
        // ignore
      }
    } catch (err: any) {
      setInviteFeedback({
        type: 'error',
        message: err?.message || 'Gagal menanggapi undangan.',
      });
    } finally {
      setRespondingId(null);
    }
  };

  // WebSocket listener for real-time state changes
  useEffect(() => {
    const unsub = deviceWs.subscribe((msg: WebSocketMessage) => {
      if (msg.type === 'state' || msg.type === 'telemetry') {
        queryClient.invalidateQueries({ queryKey: ['devices'] });
      }
    });
    return () => unsub();
  }, [queryClient]);

  // Saklar fisik hardware yang didukung (GPIO 21, 17, 16, 32 / relay_fan)
  const PHYSICAL_SWITCH_KEYS = ['lamp_tengah', 'lamp_dapur_tamu', 'lamp_kamar', 'relay', 'relay_fan'];

  const switchChannels: { deviceId: string; channel: ChannelItem }[] = [];
  let gasValue: number | null = null;
  const gasThreshold = 1500;
  let lightRawValue: number | null = null;
  const totalActuators = 4;
  let activeActuators = 0;

  // Evaluasi perangkat aktif/online (heartbeat < 15 detik)
  const onlineDevices = devices.filter((d) => d.is_online);
  const hasOnlineDevice = onlineDevices.length > 0;

  if (hasOnlineDevice) {
    onlineDevices.forEach((dev) => {
      dev.channels.forEach((ch) => {
        if (PHYSICAL_SWITCH_KEYS.includes(ch.channel_key)) {
          const isCurrentOn = ch.current_value === 'true' || ch.current_value === '1';
          if (isCurrentOn) activeActuators++;
          switchChannels.push({ deviceId: dev.id, channel: ch });
        } else if (ch.channel_type === 'gas_sensor' || ch.channel_key === 'mq2') {
          const val = parseFloat(ch.current_value || '');
          if (!isNaN(val)) gasValue = Math.round(val);
        } else if (ch.channel_type === 'light_sensor' || ch.channel_key === 'ldr') {
          const val = parseFloat(ch.current_value || '');
          if (!isNaN(val)) lightRawValue = Math.round(val);
        }
      });
    });
  }

  const activeCamerasCount = cameras.filter((c) => c.status === 'online' && !c.privacy_mode).length;

  // Toggle single channel mutation
  const toggleMutation = useMutation({
    mutationFn: async ({
      deviceId,
      channelKey,
      nextVal,
    }: {
      deviceId: string;
      channelKey: string;
      nextVal: boolean;
    }) => {
      await devicesApi.sendCommand(deviceId, channelKey, nextVal);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });

  const handleToggle = (deviceId: string, channel: ChannelItem) => {
    const isCurrentOn = channel.current_value === 'true' || channel.current_value === '1';
    toggleMutation.mutate({
      deviceId,
      channelKey: channel.channel_key,
      nextVal: !isCurrentOn,
    });
  };

  const handleTurnOffAll = async () => {
    setTurnOffLoading(true);
    try {
      const activeSwitches = switchChannels.filter(
        (sc) => sc.channel.current_value === 'true' || sc.channel.current_value === '1'
      );
      await Promise.all(
        activeSwitches.map((sc) =>
          devicesApi.sendCommand(sc.deviceId, sc.channel.channel_key, false)
        )
      );
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    } finally {
      setTurnOffLoading(false);
      setConfirmTurnOffAll(false);
    }
  };

  const getGasStatusBadge = (val: number, th: number) => {
    if (val >= th) {
      return <span className={styles.metricBadgeDanger}>Bahaya</span>;
    }
    if (val >= th * 0.7) {
      return <span className={styles.metricBadgeWarn}>Waspada</span>;
    }
    return <span className={styles.metricBadge}>Aman</span>;
  };

  return (
    <div className={styles.container}>
      {/* Notifikasi Undangan Keluarga Masuk */}
      {pendingInvitations.length > 0 && (
        <div className={styles.inviteBanner}>
          {pendingInvitations.map((inv) => (
            <div key={inv.id} className={styles.inviteCard}>
              <div className={styles.inviteInfo}>
                <div className={styles.inviteIcon}>
                  <UsersThree size={24} />
                </div>
                <div>
                  <div className={styles.inviteTitle}>
                    Undangan Bergabung ke Nexa Home dari <strong>{inv.inviter_name}</strong>
                  </div>
                  <div className={styles.inviteSubtitle}>
                    {inv.inviter_email ? `${inv.inviter_email} · ` : ''}
                    Terima undangan untuk mengakses kendali perangkat dan status keluarga bersama.
                  </div>
                </div>
              </div>
              <div className={styles.inviteActions}>
                <AppButton
                  variant="primary"
                  onClick={() => handleRespondInvite(inv.id, 'accept')}
                  disabled={respondingId === inv.id}
                >
                  <CheckCircle size={18} />
                  <span>{respondingId === inv.id ? 'Memproses...' : 'Terima'}</span>
                </AppButton>
                <AppButton
                  variant="outline"
                  onClick={() => handleRespondInvite(inv.id, 'reject')}
                  disabled={respondingId === inv.id}
                >
                  <X size={18} />
                  <span>Tolak</span>
                </AppButton>
              </div>
            </div>
          ))}
        </div>
      )}

      {inviteFeedback && (
        <div
          style={{
            padding: 'var(--space-3) var(--space-4)',
            borderRadius: 'var(--radius-button)',
            backgroundColor: inviteFeedback.type === 'ok' ? 'var(--color-accent-light)' : 'var(--color-subtle)',
            color: inviteFeedback.type === 'ok' ? 'var(--color-accent)' : 'var(--color-status-danger)',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
          }}
        >
          {inviteFeedback.message}
        </div>
      )}

      {/* 1. 4 Summary Cards */}
      <section aria-label="Ringkasan Status Nexa Home" className={styles.summaryGrid}>
        {/* Card 1: Perangkat Menyala */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryTop}>
            <span className={styles.summaryLabel}>Perangkat menyala</span>
            <div className={styles.summaryIcon}>
              <Power size={22} />
            </div>
          </div>
          <div className={styles.summaryBottom}>
            <div className={styles.metricValue}>
              {hasOnlineDevice ? `${activeActuators} dari ${totalActuators}` : '—'}
            </div>
            {hasOnlineDevice ? (
              <span className={styles.metricBadge}>
                {activeActuators > 0 ? 'Aktif' : 'Semua Mati'}
              </span>
            ) : (
              <span className={styles.metricBadgeNeutral}>
                Tidak terhubung
              </span>
            )}
          </div>
        </div>

        {/* Card 2: Sensor Gas (Wajib: Gas {val} (ambang 1500) tanpa terpotong) */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryTop}>
            <span className={styles.summaryLabel}>Sensor gas</span>
            <div className={styles.summaryIcon}>
              <Flame size={22} />
            </div>
          </div>
          <div className={styles.summaryBottom}>
            <div className={styles.metricValue} style={{ fontSize: 'var(--text-md)' }}>
              {!hasOnlineDevice
                ? '—'
                : gasValue === null
                ? 'Kalibrasi...'
                : `Gas ${gasValue} (ambang ${gasThreshold})`}
            </div>
            {!hasOnlineDevice ? (
              <span className={styles.metricBadgeNeutral}>Tidak terhubung</span>
            ) : gasValue === null ? (
              <span className={styles.metricBadge}>Kalibrasi</span>
            ) : (
              getGasStatusBadge(gasValue, gasThreshold)
            )}
          </div>
        </div>

        {/* Card 3: Cahaya (Gelap/Terang + raw, bukan lux) */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryTop}>
            <span className={styles.summaryLabel}>Cahaya ruangan</span>
            <div className={styles.summaryIcon}>
              <Sun size={22} />
            </div>
          </div>
          <div className={styles.summaryBottom}>
            <div className={styles.metricValue}>
              {!hasOnlineDevice
                ? '—'
                : lightRawValue === null
                ? 'Kalibrasi...'
                : `${lightRawValue < 500 ? 'Gelap' : 'Terang'} · ${lightRawValue}`}
            </div>
            {!hasOnlineDevice ? (
              <span className={styles.metricBadgeNeutral}>Tidak terhubung</span>
            ) : lightRawValue === null ? (
              <span className={styles.metricBadge}>Kalibrasi</span>
            ) : (
              <span className={styles.metricBadge}>
                {lightRawValue < 500 ? 'Malam' : 'Siang'}
              </span>
            )}
          </div>
        </div>

        {/* Card 4: Kamera Aktif */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryTop}>
            <span className={styles.summaryLabel}>Kamera aktif</span>
            <div className={styles.summaryIcon}>
              <VideoCamera size={22} />
            </div>
          </div>
          <div className={styles.summaryBottom}>
            <div className={styles.metricValue}>
              {activeCamerasCount > 0 ? `${activeCamerasCount} kamera` : '—'}
            </div>
            <span className={activeCamerasCount > 0 ? styles.metricBadge : styles.metricBadgeNeutral}>
              {activeCamerasCount > 0 ? 'Siaga' : 'Belum ada perangkat yang terhubung'}
            </span>
          </div>
        </div>
      </section>

      {/* 2. Section Saklar Lampu & Kipas */}
      <section aria-label="Kontrol Saklar">
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Kontrol Saklar</h2>
            <p className={styles.sectionSubtitle}>
              Kanal lampu dan kipas yang terhubung langsung ke relai
            </p>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <AppButton
              variant="primary"
              onClick={() => {
                setShowClaimModal(true);
                setClaimSuccess(false);
                setClaimError('');
                setPairCode('');
                setDeviceName('');
              }}
            >
              <Plus size={18} style={{ marginRight: 6 }} />
              Hubungkan Perangkat
            </AppButton>
            {activeActuators > 0 && (
              <AppButton
                variant="outline"
                onClick={() => setConfirmTurnOffAll(true)}
                disabled={turnOffLoading}
              >
                Matikan Semua
              </AppButton>
            )}
          </div>
        </div>

        <div style={{ marginTop: 'var(--space-4)' }}>
          {devicesLoading && switchChannels.length === 0 ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
              Memuat perangkat...
            </div>
          ) : switchChannels.length === 0 ? (
            <EmptyState
              icon={Lightbulb}
              title="Belum ada perangkat yang terhubung"
              description="Nyalakan ESP32 atau hubungkan modul perangkat ke sistem untuk mengontrol saklar fisik."
            />
          ) : (
            <div className={styles.switchboardGrid}>
              {switchChannels.map(({ deviceId, channel }) => {
                const isOn = channel.current_value === 'true' || channel.current_value === '1';
                const isFan = channel.channel_key.toLowerCase().includes('fan') || channel.name.toLowerCase().includes('kipas');

                return (
                  <div
                    key={`${deviceId}-${channel.channel_key}`}
                    className={`${styles.tile} ${isOn ? styles.tileOn : ''}`}
                  >
                    <div className={styles.tileInfo}>
                      <div className={`${styles.tileIcon} ${isOn ? styles.tileIconOn : ''}`}>
                        {isFan ? <Fan size={22} /> : <Lightbulb size={22} />}
                      </div>
                      <div>
                        <div className={styles.tileName}>
                          {channel.alias || channel.name}
                        </div>
                        <div className={styles.tileSub}>
                          {channel.channel_key} · {deviceId}
                        </div>
                      </div>
                    </div>
                    <AppSwitch
                      checked={isOn}
                      onChange={() => handleToggle(deviceId, channel)}
                      ariaLabel={`Saklar ${channel.alias || channel.name}`}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 3. Section Aktivitas Terakhir */}
      <section aria-label="Aktivitas Terakhir">
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Aktivitas Terakhir</h2>
            <p className={styles.sectionSubtitle}>
              Catatan kejadian otomatis dan perintah pengguna di sistem
            </p>
          </div>
        </div>

        <div style={{ marginTop: 'var(--space-4)' }}>
          <div className={styles.activityCard}>
            {auditLogs.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="Belum ada aktivitas tercatat"
                description="Perintah pengguna dan status aktuator akan muncul secara otomatis di sini."
              />
            ) : (
              <div className={styles.activityList}>
                {auditLogs.map((log) => {
                  const dateStr = new Date(log.created_at).toLocaleString('id-ID', {
                    dateStyle: 'short',
                    timeStyle: 'medium',
                  });

                  return (
                    <div key={log.id} className={styles.activityItem}>
                      <div className={styles.activityLeft}>
                        <span className={styles.activityDot} />
                        <span className={styles.activityText}>
                          <span className={styles.activityActor}>
                            {log.username || 'Sistem'}:
                          </span>{' '}
                          {log.action} {log.target_id ? `(${log.target_id})` : ''}
                        </span>
                      </div>
                      <div className={styles.activityTime}>{dateStr}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Dialog Konfirmasi: Matikan Semua */}
      <ConfirmDialog
        open={confirmTurnOffAll}
        title="Matikan Semua Perangkat?"
        message="Apakah Anda yakin ingin mematikan semua saklar lampu dan kipas yang sedang menyala di Nexa Home?"
        confirmLabel="Ya, Matikan Semua"
        cancelLabel="Batal"
        danger
        onConfirm={handleTurnOffAll}
        onCancel={() => setConfirmTurnOffAll(false)}
      />

      {/* Modal: Hubungkan Perangkat (Kode Pairing) */}
      {showClaimModal && (
        <div
          className={styles.modalBackdrop}
          onClick={(e) => { if (e.target === e.currentTarget) setShowClaimModal(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setShowClaimModal(false); }}
          role="dialog"
          aria-modal="true"
          aria-label="Hubungkan Perangkat Baru"
        >
          <div className={styles.modalCard}>
            {claimSuccess ? (
              <div className={styles.successBox}>
                <CheckCircle size={48} color="var(--color-status-ok)" />
                <h3 style={{ margin: 0, fontSize: 'var(--text-lg)', color: 'var(--color-text)' }}>
                  Sambungan Telah Berhasil!
                </h3>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                  Perangkat <strong>{deviceName}</strong> telah berhasil dihubungkan ke akun Anda dan kini siap dikontrol langsung dari dashboard.
                </p>
                <div style={{ marginTop: 'var(--space-3)', width: '100%' }}>
                  <AppButton
                    variant="primary"
                    onClick={() => {
                      setShowClaimModal(false);
                      setClaimSuccess(false);
                    }}
                  >
                    Mulai Kontrol Perangkat
                  </AppButton>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                  <h3 style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--color-text)' }}>
                    Hubungkan Perangkat Baru
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowClaimModal(false)}
                    aria-label="Tutup modal"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--color-text-secondary)',
                      padding: 'var(--space-1)',
                      borderRadius: 'var(--radius-button)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className={styles.guideBox}>
                  <strong>Langkah Mudah Menyambungkan:</strong>
                  <br />
                  1. Hubungkan ESP32 ke WiFi rumah Anda (lewat portal <code>192.168.4.1</code> atau Thonny IDE).
                  <br />
                  2. Lihat <strong>KODE PAIRING (6-digit)</strong> dan <strong>ID Perangkat</strong> (contoh: <code>esp32_559ed8</code>) yang tampil di layar portal / serial monitor.
                  <br />
                  3. Masukkan kode & ID perangkat di bawah ini, lalu klik <em>Hubungkan ke Akun</em>.
                </div>

                <form onSubmit={handleClaimDevice} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <AppInput
                    label="ID Perangkat (Opsional / Disarankan)"
                    placeholder="contoh: esp32_559ed8 (dari portal/layar ESP32)"
                    value={deviceId}
                    onChange={(e) => setDeviceId(e.target.value)}
                  />

                  <AppInput
                    label="Kode Pairing"
                    placeholder="contoh: 537591 (atau format esp32_559ed8:537591)"
                    value={pairCode}
                    onChange={(e) => setPairCode(e.target.value)}
                    required
                  />

                  <AppInput
                    label="Nama Perangkat"
                    placeholder="contoh: Lampu Ruang Tamu"
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    required
                  />

                  {claimError && (
                    <p style={{ color: 'var(--color-status-danger)', fontSize: 'var(--text-xs)', margin: 0 }}>
                      {claimError}
                    </p>
                  )}

                  <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)', justifyContent: 'flex-end' }}>
                    <AppButton
                      type="button"
                      variant="outline"
                      onClick={() => setShowClaimModal(false)}
                    >
                      Batal
                    </AppButton>
                    <AppButton
                      type="submit"
                      variant="primary"
                      disabled={claimLoading}
                    >
                      {claimLoading ? 'Menghubungkan...' : 'Hubungkan ke Akun'}
                    </AppButton>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

