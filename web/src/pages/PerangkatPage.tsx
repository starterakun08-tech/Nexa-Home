import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Lightbulb,
  Fan,
  SpeakerHigh,
  Flame,
  Sun,
  Plus,
  Warning,
  SpeakerSlash,
  HardDrives,
  Graph,
  Table,
} from '@phosphor-icons/react';
import { devicesApi, type DeviceItem, type ChannelItem, type TelemetryPoint } from '../api/devices';
import { useAuth } from '../context/AuthContext';
import { deviceWs, type WebSocketMessage } from '../api/websocket';
import { AppSwitch } from '../components/AppSwitch';
import { AppButton } from '../components/AppButton';
import { AppBadge } from '../components/AppBadge';
import { AppInput } from '../components/AppInput';
import { EmptyState } from '../components/EmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import styles from './PerangkatPage.module.css';

export const PerangkatPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === 'pemilik' || user?.role === 'admin';
  const canAddDevice = isOwner;

  const formatClaimErrorMessage = (rawError: string): string => {
    const err = (rawError || '').toLowerCase();
    if (err.includes('terpakai') || err.includes('used')) {
      return 'Kode pairing sudah terpakai';
    }
    if (err.includes('kedaluwarsa') || err.includes('expired')) {
      return 'Kode pairing kedaluwarsa. Silakan tekan tombol pairing di perangkat untuk kode baru';
    }
    if (err.includes('terlalu banyak') || err.includes('rate limit') || err.includes('429')) {
      return 'Terlalu banyak percobaan. Tunggu 10 menit';
    }
    if (err.includes('sudah terdaftar') || err.includes('already bound') || err.includes('409') || err.includes('lain') || err.includes('terhubung')) {
      return 'Perangkat ini sudah terdaftar di akun lain. Hubungi pemiliknya untuk melepaskan';
    }
    if (err.includes('pengelola') || err.includes('403') || err.includes('forbidden')) {
      return 'Hanya Pengelola yang dapat menambahkan perangkat';
    }
    return rawError || 'Gagal menghubungkan perangkat.';
  };

  // Add Device Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newDeviceId, setNewDeviceId] = useState('');
  const [newDeviceName, setNewDeviceName] = useState('');
  const [newDeviceRoom] = useState('Ruang Tamu');
  const [addError, setAddError] = useState('');
  const [isClaiming, setIsClaiming] = useState(false);

  // Reset / Unbind Device State
  const [deviceToReset, setDeviceToReset] = useState<DeviceItem | null>(null);
  const [unbindError, setUnbindError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const unbindMutation = useMutation({
    mutationFn: (id: string) => devicesApi.unbindDevice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      setDeviceToReset(null);
      setUnbindError(null);
      setToastMsg('Perangkat diputuskan');
      setTimeout(() => setToastMsg(null), 3500);
    },
    onError: (err: unknown) => {
      const errObj = err as { message?: string };
      setUnbindError(errObj?.message || 'Gagal memutuskan perangkat dari server.');
    },
  });

  // 1. Fetch devices list
  const { data: devices = [], isLoading } = useQuery<DeviceItem[]>({
    queryKey: ['devices'],
    queryFn: devicesApi.getDevices,
    refetchInterval: 5000,
  });

  const primaryDevice = devices[0];

  // 2. Fetch telemetry for sensor graph (default to primary device)
  const { data: telemetry = [] } = useQuery<TelemetryPoint[]>({
    queryKey: ['telemetry', primaryDevice?.id],
    queryFn: () => (primaryDevice ? devicesApi.getTelemetry(primaryDevice.id, 'mq2', 40) : Promise.resolve([])),
    enabled: !!primaryDevice,
    refetchInterval: 5000,
  });

  // Realtime websocket listener
  useEffect(() => {
    const unsub = deviceWs.subscribe((msg: WebSocketMessage) => {
      if (msg.type === 'state' || msg.type === 'telemetry') {
        queryClient.invalidateQueries({ queryKey: ['devices'] });
        queryClient.invalidateQueries({ queryKey: ['telemetry'] });
      }
    });
    return () => unsub();
  }, [queryClient]);

  // Aggregate channels & gas metrics
  let gasValue = 0;
  const gasThreshold = 1500;
  let isGasAlert = false;
  let buzzerChannel: { deviceId: string; channel: ChannelItem } | null = null;

  devices.forEach((dev) => {
    dev.channels.forEach((ch) => {
      if (ch.channel_type === 'gas_sensor') {
        const val = parseFloat(ch.current_value || '0');
        if (!isNaN(val)) gasValue = val;
        if (gasValue >= gasThreshold) isGasAlert = true;
      } else if (ch.channel_type === 'buzzer') {
        buzzerChannel = { deviceId: dev.id, channel: ch };
      }
    });
  });

  // Toggle mutation
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

  const handleSilenceBuzzer = () => {
    if (buzzerChannel) {
      toggleMutation.mutate({
        deviceId: buzzerChannel.deviceId,
        channelKey: buzzerChannel.channel.channel_key,
        nextVal: false,
      });
    }
  };

  const handlePairCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.toUpperCase();
    // Jika format hex/digit tanpa strip, format otomatis XXX-XXX jika panjang > 3
    const rawClean = val.replace(/[^A-Z0-9]/g, '');
    if (rawClean.length <= 6 && !val.includes(' ') && !val.includes('_')) {
      if (rawClean.length > 3) {
        val = rawClean.slice(0, 3) + '-' + rawClean.slice(3);
      } else {
        val = rawClean;
      }
    }
    setNewDeviceId(val);
  };

  const handleClaimDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    const rawCode = newDeviceId.trim();
    const token = rawCode.replace(/[^A-Za-z0-9_-]/g, '');
    if (!token) {
      setAddError('Masukkan kode pairing atau scan token QR.');
      return;
    }
    setIsClaiming(true);
    try {
      await devicesApi.claimDevice({
        device_id: token.startsWith('esp32_') ? token : '',
        claim_token: token,
        name: newDeviceName.trim() || undefined,
        room: newDeviceRoom.trim() || 'Ruang Tamu',
      });
      setShowAddModal(false);
      setNewDeviceId('');
      setNewDeviceName('');
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      setToastMsg('Perangkat berhasil dihubungkan ke Nexa Home');
      setTimeout(() => setToastMsg(null), 3500);
    } catch (err: unknown) {
      const errObj = err as { message?: string; detail?: string };
      const rawMsg = errObj.detail || errObj.message || '';
      setAddError(formatClaimErrorMessage(rawMsg));
    } finally {
      setIsClaiming(false);
    }
  };

  // Build SVG points for telemetry graph
  const renderSvgGraph = () => {
    if (telemetry.length < 2) {
      return (
        <EmptyState
          icon={Graph}
          title="Belum ada data riwayat telemetri"
          description="Data pengukuran dari sensor MQ-2 akan terekam otomatis dalam interval 1 menit."
        />
      );
    }

    const width = 1000;
    const height = 160;
    const padding = 20;

    const values = telemetry.map((t) => t.value);
    const minVal = Math.min(...values, 0);
    const maxVal = Math.max(...values, 2000);

    const points = telemetry.map((t, i) => {
      const x = padding + (i / (telemetry.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((t.value - minVal) / (maxVal - minVal || 1)) * (height - 2 * padding);
      return `${x},${y}`;
    });

    const pathD = `M ${points.join(' L ')}`;

    return (
      <div className={styles.chartContainer}>
        <svg viewBox={`0 0 ${width} ${height}`} className={styles.chartSvg}>
          <line
            x1={padding}
            y1={height - padding - ((gasThreshold - minVal) / (maxVal - minVal)) * (height - 2 * padding)}
            x2={width - padding}
            y2={height - padding - ((gasThreshold - minVal) / (maxVal - minVal)) * (height - 2 * padding)}
            stroke="var(--color-status-danger)"
            strokeDasharray="4 4"
            strokeWidth="1.5"
          />
          <path d={pathD} fill="none" stroke="var(--color-accent)" strokeWidth="2.5" />
          {telemetry.map((t, i) => {
            const x = padding + (i / (telemetry.length - 1)) * (width - 2 * padding);
            const y = height - padding - ((t.value - minVal) / (maxVal - minVal || 1)) * (height - 2 * padding);
            return (
              <circle
                key={t.id || i}
                cx={x}
                cy={y}
                r="4"
                fill="var(--color-accent)"
              />
            );
          })}
        </svg>
        <div className={styles.chartMeta}>
          <span>Ambang Bahaya: Gas {gasThreshold} (Garis Merah Putus-putus)</span>
          <span>Titik Terkini: Gas {telemetry[telemetry.length - 1]?.value ?? 0}</span>
        </div>
      </div>
    );
  };

  return (
    <div className={styles.container}>
      {/* 1. Banner Bahaya Gas jika Alarm */}
      {isGasAlert && (
        <div className={styles.dangerBanner}>
          <div className={styles.dangerLeft}>
            <div className={styles.dangerIcon}>
              <Warning size={24} />
            </div>
            <div>
              <p className={styles.dangerText}>
                <strong>Peringatan Darurat:</strong> Gas <strong>{gasValue}</strong> (ambang <strong>{gasThreshold}</strong>) — Terdeteksi di atas ambang aman!
              </p>
              <div className={styles.dangerSub}>
                Topik MQTT: home/{primaryDevice?.id || 'esp32'}/sensor/gas · Katup darurat tertutup
              </div>
            </div>
          </div>
          <AppButton
            variant="danger"
            onClick={handleSilenceBuzzer}
          >
            <SpeakerSlash size={18} />
            <span>Bungkam Buzzer</span>
          </AppButton>
        </div>
      )}

      {/* 2. Header Panel Saklar & Tambah Perangkat */}
      <section aria-label="Panel Saklar Perangkat">
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Panel Saklar & Sensor Nexa Home</h2>
            <p className={styles.sectionSubtitle}>
              Kendali langsung modul mikrokontroler lokal ESP32 via MQTT
            </p>
          </div>
          {canAddDevice && (
            <AppButton
              variant="primary"
              onClick={() => {
                setShowAddModal(true);
                setAddError('');
              }}
            >
              <Plus size={18} />
              <span>Tambah Perangkat</span>
            </AppButton>
          )}
        </div>

        {/* Status LWT dan Kanal Grid */}
        <div style={{ marginTop: 'var(--space-4)' }}>
          {isLoading && devices.length === 0 ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
              Memuat data perangkat...
            </div>
          ) : devices.length === 0 ? (
            <EmptyState
              icon={HardDrives}
              title="Belum ada perangkat terdaftar"
              description="Tambahkan atau hubungkan modul ESP32 baru untuk menjadi Pemilik Nexa Home dan mengontrol peralatan."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
              {devices.map((device) => (
                <div key={device.id} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <span style={{ fontWeight: 700, fontSize: 'var(--text-md)' }}>{device.name}</span>
                      <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}>
                        ({device.room})
                      </span>
                      <AppBadge variant={device.is_online ? 'ok' : 'danger'}>
                        {device.is_online ? 'LWT: Online' : 'LWT: Terputus'}
                      </AppBadge>
                      {device.ip_address && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-primary)' }}>
                          IP: {device.ip_address}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                        Topik: home/{device.id}/...
                      </span>
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => {
                            setDeviceToReset(device);
                            setUnbindError(null);
                          }}
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--color-border)',
                            color: 'var(--color-status-danger)',
                            borderRadius: 'var(--radius-chip)',
                            padding: '3px 8px',
                            fontSize: 'var(--text-xs)',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                          title="Putuskan perangkat dan kembalikan ke kondisi baru"
                        >
                          Putuskan Perangkat
                        </button>
                      )}
                    </div>
                  </div>

                  <div className={styles.switchboardGrid}>
                    {device.channels
                      .filter((ch) => ch.channel_key !== 'lamp')
                      .map((channel) => {
                      const isActuator =
                        channel.channel_type === 'switch' ||
                        channel.channel_type === 'relay' ||
                        channel.channel_type === 'buzzer';
                      const isOn = channel.current_value === 'true' || channel.current_value === '1';

                      // Format sensor mentah
                      let sensorDisplay = channel.current_value || '0';
                      if (channel.channel_type === 'gas_sensor') {
                        sensorDisplay = `Gas ${channel.current_value || 0} (ambang ${gasThreshold})`;
                      } else if (channel.channel_type === 'light_sensor') {
                        const ldrVal = parseFloat(channel.current_value || '0');
                        const isDark = channel.current_value === '0' || ldrVal < 500;
                        sensorDisplay = `${isDark ? 'Gelap' : 'Terang'} · ${channel.current_value || 0}`;
                      }

                      return (
                        <div
                          key={channel.channel_key}
                          className={`${styles.tile} ${isOn && isActuator ? styles.tileOn : ''}`}
                        >
                          <div className={styles.tileInfo}>
                            <div className={`${styles.tileIcon} ${isOn && isActuator ? styles.tileIconOn : ''}`}>
                              {channel.channel_type === 'gas_sensor' ? (
                                <Flame size={22} />
                              ) : channel.channel_type === 'light_sensor' ? (
                                <Sun size={22} />
                              ) : channel.channel_type === 'buzzer' ? (
                                <SpeakerHigh size={22} />
                              ) : channel.channel_key.toLowerCase().includes('fan') ? (
                                <Fan size={22} />
                              ) : (
                                <Lightbulb size={22} />
                              )}
                            </div>
                            <div>
                              <div className={styles.tileName}>
                                {channel.alias || channel.name}
                              </div>
                              <div className={styles.tileSub}>
                                {isActuator ? (
                                  <>
                                    <span>{channel.channel_key}</span>
                                    {channel.channel_key === 'lamp_tengah' && <span> · Pin 21</span>}
                                    {channel.channel_key === 'lamp_dapur_tamu' && <span> · Pin 17</span>}
                                    {channel.channel_key === 'lamp_kamar' && <span> · Pin 16</span>}
                                    {channel.channel_key === 'relay' && <span> · Pin 32 (LOW)</span>}
                                    {channel.channel_key === 'buzzer' && <span> · Pin 19</span>}
                                    <span> · {isOn ? 'Aktif' : 'Mati'}</span>
                                  </>
                                ) : (
                                  <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>
                                    {sensorDisplay}
                                    {channel.channel_key === 'mq2' && ' · Pin 33 (ADC)'}
                                    {channel.channel_key === 'ldr' && ' · Pin 22'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {isActuator && (
                            <AppSwitch
                              checked={isOn}
                              onChange={() => handleToggle(device.id, channel)}
                              disabled={toggleMutation.isPending}
                              ariaLabel={`Saklar ${channel.alias || channel.name}`}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 3. Grafik Telemetri 24 Jam */}
      <section aria-label="Grafik Telemetri">
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Grafik Telemetri Sensor MQ-2</h2>
            <p className={styles.sectionSubtitle}>
              Tren nilai mentah sensor gas MQ-2 (ambang aman {gasThreshold})
            </p>
          </div>
        </div>

        <div style={{ marginTop: 'var(--space-4)' }}>
          <div className={styles.card}>{renderSvgGraph()}</div>
        </div>
      </section>

      {/* 4. Tabel Telemetri */}
      <section aria-label="Tabel Telemetri">
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Tabel Log Pengukuran Sensor</h2>
            <p className={styles.sectionSubtitle}>
              Data mentah telemetri yang diterima broker MQTT
            </p>
          </div>
        </div>

        <div style={{ marginTop: 'var(--space-4)' }}>
          <div className={styles.card}>
            {telemetry.length === 0 ? (
              <EmptyState
                icon={Table}
                title="Belum ada catatan telemetri"
                description="Pembaruan telemetri otomatis dari perangkat akan tercatat di tabel ini."
              />
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th}>Waktu Pengukuran</th>
                      <th className={styles.th}>Kanal</th>
                      <th className={styles.th}>Nilai Mentah</th>
                      <th className={styles.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {telemetry.slice(0, 15).map((point) => {
                      const dt = new Date(point.created_at).toLocaleString('id-ID', {
                        dateStyle: 'short',
                        timeStyle: 'medium',
                      });
                      const isHigh = point.value >= gasThreshold;

                      return (
                        <tr key={point.id}>
                          <td className={`${styles.td} ${styles.tdMono}`}>{dt}</td>
                          <td className={styles.td}>{point.channel_key}</td>
                          <td className={`${styles.td} ${styles.tdMono}`}>
                            <strong>{point.value}</strong>
                          </td>
                          <td className={styles.td}>
                            <AppBadge variant={isHigh ? 'danger' : 'ok'}>
                              {isHigh ? 'Bahaya' : 'Normal'}
                            </AppBadge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Modal Tambah Perangkat (Admin Only) */}
      {showAddModal && (
        <div
          className={styles.modalBackdrop}
          onClick={(e) => { if (e.target === e.currentTarget) setShowAddModal(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setShowAddModal(false); }}
          role="dialog"
          aria-modal="true"
          aria-label="Tambah Perangkat Baru"
        >
          <div className={styles.modalCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 700 }}>
                Hubungkan Perangkat Baru
              </h3>
            </div>

            <div style={{
              background: 'var(--color-bg-secondary, rgba(0,0,0,0.04))',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              lineHeight: 1.4,
              border: '1px solid var(--color-border)'
            }}>
              Kode pairing dan token QR berputar otomatis setiap <strong>120 detik</strong> di layar/portal perangkat ESP32. Pastikan kode yang dimasukkan masih aktif.
            </div>

            <form onSubmit={handleClaimDevice} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {addError && (
                <div style={{
                  color: 'var(--color-status-danger)',
                  fontSize: 'var(--text-xs)',
                  padding: 'var(--space-2)',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  fontWeight: 500,
                }}>
                  {addError}
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                  Kode Pairing (6-Digit) atau Token QR
                </label>
                <AppInput
                  placeholder="Contoh: 123-456 atau token QR"
                  value={newDeviceId}
                  onChange={handlePairCodeChange}
                  autoComplete="off"
                  autoFocus
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                  Nama Perangkat (Opsional)
                </label>
                <AppInput
                  placeholder="Contoh: Lampu Ruang Tamu"
                  value={newDeviceName}
                  onChange={(e) => setNewDeviceName(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
                <AppButton
                  type="button"
                  variant="outline"
                  onClick={() => setShowAddModal(false)}
                  disabled={isClaiming}
                >
                  Batal
                </AppButton>
                <AppButton type="submit" variant="primary" disabled={isClaiming}>
                  {isClaiming ? 'Menghubungkan...' : 'Hubungkan Perangkat'}
                </AppButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dialog Konfirmasi Putuskan & Reset Perangkat */}
      <ConfirmDialog
        isOpen={!!deviceToReset}
        title="Putuskan Sambungan Perangkat?"
        message={
          deviceToReset?.is_online
            ? "Perangkat akan direset ke pengaturan pabrik dan dapat dihubungkan ke akun lain. Tindakan ini memerlukan persetujuan Pengelola."
            : "Perangkat sedang offline. Sambungan akun akan diputus sekarang, tetapi Anda harus menahan tombol fisik di perangkat selama 10 detik sebelum dapat menghubungkannya ke akun baru. Tindakan ini memerlukan persetujuan Pengelola."
        }
        confirmLabel={unbindMutation.isPending ? "Mengirim perintah reset..." : "Ya, Putuskan Perangkat"}
        cancelLabel="Batal"
        isDanger={true}
        isLoading={unbindMutation.isPending}
        error={unbindError}
        onRetry={() => {
          if (deviceToReset && !unbindMutation.isPending) {
            setUnbindError(null);
            unbindMutation.mutate(deviceToReset.id);
          }
        }}
        onConfirm={() => {
          if (deviceToReset && !unbindMutation.isPending) {
            setUnbindError(null);
            unbindMutation.mutate(deviceToReset.id);
          }
        }}
        onCancel={() => {
          if (!unbindMutation.isPending) {
            setDeviceToReset(null);
            setUnbindError(null);
          }
        }}
      />

      {/* Snackbar / Toast Notifikasi */}
      {toastMsg && (
        <div
          role="status"
          style={{
            position: 'fixed',
            bottom: 'var(--space-6)',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-text)',
            padding: 'var(--space-3) var(--space-5)',
            borderRadius: 'var(--radius-pill)',
            boxShadow: 'var(--shadow-lg, 0 10px 25px rgba(0,0,0,0.15))',
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            border: '1px solid var(--color-border)',
          }}
        >
          <span style={{ color: 'var(--color-status-ok)', fontSize: '10px' }}>●</span>
          <span>{toastMsg}</span>
        </div>
      )}
    </div>
  );
};
