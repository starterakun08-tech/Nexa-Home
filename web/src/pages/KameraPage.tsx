import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  VideoCamera,
  Play,
  Lock,
  Plus,
  Trash,
  X,
  Clock,
  EyeSlash,
} from '@phosphor-icons/react';
import { camerasApi, type CameraItem, type MotionEventItem, type PairingCodeResponse } from '../api/cameras';
import { useAuth } from '../context/AuthContext';
import { AppSwitch } from '../components/AppSwitch';
import { AppButton } from '../components/AppButton';
import { AppBadge } from '../components/AppBadge';
import { AppInput } from '../components/AppInput';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import styles from './KameraPage.module.css';

// Fungsi pengecekan LAN lokal
function checkIsLan(): boolean {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

// Subkomponen WebRTC WHEP / Snapshot Player untuk tiap kamera
const CameraPlayer: React.FC<{ camera: CameraItem; isLan: boolean }> = ({ camera, isLan }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamError, setStreamError] = useState(false);
  const [snapshotNonce, setSnapshotNonce] = useState(0);

  // WebRTC WHEP jika berada di jaringan LAN
  useEffect(() => {
    if (!isLan || camera.privacy_mode || camera.status !== 'online') {
      return;
    }

    let pc: RTCPeerConnection | null = null;
    let isCancelled = false;

    async function initWhep() {
      try {
        pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });

        pc.addTransceiver('video', { direction: 'recvonly' });

        pc.ontrack = (event) => {
          if (videoRef.current && event.streams[0]) {
            videoRef.current.srcObject = event.streams[0];
            setStreamConnected(true);
            setStreamError(false);
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        // Kirim offer ke endpoint MediaMTX WHEP (port 8889 pada host lokal)
        const whepUrl = `http://${window.location.hostname}:8889/${camera.id}/whep`;
        const res = await fetch(whepUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: offer.sdp,
        });

        if (res.ok) {
          const answerSdp = await res.text();
          if (!isCancelled && pc) {
            await pc.setRemoteDescription({
              type: 'answer',
              sdp: answerSdp,
            });
          }
        } else {
          setStreamError(true);
        }
      } catch {
        if (!isCancelled) {
          setStreamError(true);
        }
      }
    }

    initWhep();

    return () => {
      isCancelled = true;
      if (pc) {
        pc.close();
      }
    };
  }, [camera.id, camera.privacy_mode, camera.status, isLan]);

  // Snapshot berkala jika di luar LAN atau WHEP gagal
  useEffect(() => {
    if (!isLan && !camera.privacy_mode) {
      const timer = setInterval(() => {
        setSnapshotNonce(Date.now());
      }, 5000);
      return () => clearInterval(timer);
    }
  }, [isLan, camera.privacy_mode]);

  if (camera.privacy_mode) {
    return (
      <div className={styles.videoContainer}>
        <div className={styles.placeholderCenter}>
          <EyeSlash size={36} />
          <span className={styles.placeholderText}>Mode Privasi Aktif</span>
          <span className={styles.placeholderSub}>Stream & deteksi dihentikan</span>
        </div>
      </div>
    );
  }

  if (isLan && streamConnected && !streamError) {
    return (
      <div className={styles.videoContainer}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={styles.videoElement}
        />
        <div className={styles.overlayTop}>
          <span className={styles.overlayBadge}>{camera.id} · WHEP LAN</span>
          <span className={styles.overlayBadge}>Live</span>
        </div>
      </div>
    );
  }

  // Fallback ke Snapshot jika di luar LAN atau WHEP belum terhubung
  const snapshotUrl = `${camerasApi.getSnapshotUrl(camera.id)}?t=${snapshotNonce}`;

  return (
    <div className={styles.videoContainer}>
      <img
        src={snapshotUrl}
        alt={`Snapshot ${camera.name}`}
        className={styles.snapshotImage}
        onError={() => setStreamError(true)}
      />
      <div className={styles.overlayTop}>
        <span className={styles.overlayBadge}>{camera.id}</span>
        <span className={styles.overlayBadge}>
          {isLan ? 'Memuat WebRTC...' : 'Snapshot Berkala'}
        </span>
      </div>
      <div className={styles.overlayBottom}>
        <span className={styles.overlayBadge}>
          {isLan ? 'Menghubungkan WHEP' : 'Setiap 5 detik'}
        </span>
      </div>
    </div>
  );
};

export const KameraPage: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isLan = checkIsLan();

  // Modals state
  const [showPairModal, setShowPairModal] = useState(false);
  const [pairName, setPairName] = useState('');
  const [pairRoom, setPairRoom] = useState('Ruang Tamu');
  const [pairingResult, setPairingResult] = useState<PairingCodeResponse | null>(null);
  const [pairError, setPairError] = useState('');

  const [revokingCameraId, setRevokingCameraId] = useState<string | null>(null);
  const [selectedClip, setSelectedClip] = useState<{ camId: string; clipId: string } | null>(null);

  // 1. Fetch cameras
  const { data: cameras = [], isLoading } = useQuery<CameraItem[]>({
    queryKey: ['cameras'],
    queryFn: camerasApi.getCameras,
    refetchInterval: 5000,
  });

  // Selected camera for motion events
  const [selectedCamId, setSelectedCamId] = useState<string>('');
  const activeCamId = selectedCamId || cameras[0]?.id || '';

  // 2. Fetch motion events for selected camera
  const { data: events = [] } = useQuery<MotionEventItem[]>({
    queryKey: ['camera-events', activeCamId],
    queryFn: () => (activeCamId ? camerasApi.getEvents(activeCamId) : Promise.resolve([])),
    enabled: !!activeCamId,
    refetchInterval: 10000,
  });

  // Privacy toggle mutation
  const togglePrivacyMutation = useMutation({
    mutationFn: async ({ id, nextVal }: { id: string; nextVal: boolean }) => {
      await camerasApi.togglePrivacy(id, nextVal);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
    },
  });

  const handleTogglePrivacy = (cam: CameraItem) => {
    togglePrivacyMutation.mutate({
      id: cam.id,
      nextVal: !cam.privacy_mode,
    });
  };

  const handleCreatePairingCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setPairError('');
    try {
      const res = await camerasApi.createPairingCode(pairName.trim(), pairRoom.trim());
      setPairingResult(res);
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setPairError(errObj.message || 'Gagal membuat kode pairing.');
    }
  };

  const handleRevokeConfirm = async () => {
    if (!revokingCameraId) return;
    try {
      await camerasApi.revokeCamera(revokingCameraId);
      queryClient.invalidateQueries({ queryKey: ['cameras'] });
    } finally {
      setRevokingCameraId(null);
    }
  };

  return (
    <div className={styles.container}>
      {/* 1. Banner LAN */}
      <section aria-label="Status Jaringan Kamera" className={styles.lanBanner}>
        <div className={styles.lanLeft}>
          <Lock size={24} className={styles.lanIcon} />
          <p className={styles.lanText}>
            {isLan
              ? 'Live view aktif di jaringan rumah (LAN). Semua feed streaming diproses secara lokal tanpa server cloud pihak ketiga.'
              : 'Di luar LAN: Live stream WHEP dinonaktifkan demi privasi. Menampilkan snapshot berkala setiap 5 detik.'}
          </p>
        </div>
        <div className={styles.lanStatus}>
          <span className={isLan ? styles.dotOk : styles.dotWarn} />
          <span>{isLan ? 'Jaringan: LAN Lokal' : 'Jaringan: Akses Luar (WAN)'}</span>
        </div>
      </section>

      {/* 2. Grid Kamera Langsung */}
      <section aria-label="Kamera Langsung">
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Kamera Langsung</h2>
            <p className={styles.sectionSubtitle}>
              Ponsel kamera bekas terhubung MediaMTX (WHEP WebRTC)
            </p>
          </div>
          {isAdmin && (
            <AppButton
              variant="primary"
              onClick={() => {
                setShowPairModal(true);
                setPairingResult(null);
                setPairError('');
              }}
            >
              <Plus size={18} />
              <span>Pasangkan Kamera</span>
            </AppButton>
          )}
        </div>

        <div style={{ marginTop: 'var(--space-4)' }}>
          {isLoading && cameras.length === 0 ? (
            <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
              Memuat daftar kamera...
            </div>
          ) : cameras.length === 0 ? (
            <EmptyState
              icon={VideoCamera}
              title="Belum ada kamera terpasang"
              description="Admin dapat memasangkan ponsel bekas menjadi kamera CCTV lokal via kode pairing."
            />
          ) : (
            <div className={styles.cameraGrid}>
              {cameras.map((cam) => {
                const isOnline = cam.status === 'online';
                return (
                  <div key={cam.id} className={styles.cameraTile}>
                    {/* Header Tile */}
                    <div className={styles.tileHeader}>
                      <div className={styles.cameraTitleRow}>
                        <span className={styles.cameraName}>{cam.name}</span>
                        <AppBadge variant={isOnline ? 'ok' : 'neutral'}>
                          {isOnline ? 'ONLINE' : 'OFFLINE'}
                        </AppBadge>
                      </div>
                      {isOnline && !cam.privacy_mode && (
                        <div className={styles.recBadge}>
                          <span className={styles.dotPulse} />
                          <span>REC</span>
                        </div>
                      )}
                    </div>

                    {/* Video / Snapshot Player */}
                    <CameraPlayer camera={cam} isLan={isLan} />

                    <div className={styles.tileDivider} />

                    {/* Footer Privasi & Pencabutan */}
                    <div className={styles.tileFooter}>
                      <div className={styles.privacyMeta}>
                        <span className={styles.privacyLabel}>Mode Privasi</span>
                        <span className={styles.privacySub}>
                          {cam.privacy_mode ? 'Lensa & deteksi mati' : 'Merekam aktif'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <AppSwitch
                          checked={cam.privacy_mode}
                          onChange={() => handleTogglePrivacy(cam)}
                          ariaLabel={`Mode privasi ${cam.name}`}
                        />
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => setRevokingCameraId(cam.id)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--color-status-danger)',
                              cursor: 'pointer',
                              padding: 'var(--space-1)',
                            }}
                            title="Cabut izin kamera"
                          >
                            <Trash size={18} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 3. Kejadian Gerakan & Pemutar Klip Rekaman */}
      {cameras.length > 0 && (
        <section aria-label="Kejadian Gerakan Terdeteksi">
          <div className={styles.sectionHeader}>
            <div>
              <h2 className={styles.sectionTitle}>Kejadian Gerakan Terdeteksi</h2>
              <p className={styles.sectionSubtitle}>
                Klip rekaman terenkripsi AES-256-GCM (didekripsi on-the-fly oleh server)
              </p>
            </div>
            {cameras.length > 1 && (
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                {cameras.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCamId(c.id)}
                    style={{
                      background: activeCamId === c.id ? 'var(--color-accent-light)' : 'transparent',
                      color: activeCamId === c.id ? 'var(--color-accent)' : 'var(--color-text)',
                      border: 'var(--border-width) solid var(--color-border)',
                      borderRadius: 'var(--radius-chip)',
                      padding: '4px 10px',
                      fontSize: 'var(--text-xs)',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginTop: 'var(--space-4)' }}>
            <div className={styles.card}>
              {events.length === 0 ? (
                <EmptyState
                  icon={Clock}
                  title="Belum ada kejadian gerakan"
                  description="Klip video saat ada gerakan terdeteksi akan tersimpan terenkripsi dan muncul di sini."
                />
              ) : (
                <div className={styles.eventsGrid}>
                  {events.map((ev) => {
                    const startDt = new Date(ev.start_time).toLocaleString('id-ID', {
                      dateStyle: 'short',
                      timeStyle: 'medium',
                    });

                    return (
                      <div
                        key={ev.id}
                        className={styles.eventCard}
                        onClick={() => setSelectedClip({ camId: ev.camera_id, clipId: ev.id })}
                      >
                        <div className={styles.eventTop}>
                          <span className={styles.eventTime}>{startDt}</span>
                          <span className={styles.eventDuration}>
                            {ev.duration_seconds.toFixed(1)}s
                          </span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-2)',
                            color: 'var(--color-accent)',
                            fontSize: 'var(--text-xs)',
                            fontWeight: 600,
                          }}
                        >
                          <Play size={16} />
                          <span>Putar Klip Rekaman</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Modal Pairing Kamera (Admin) */}
      {showPairModal && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 700 }}>
                {pairingResult ? 'Kode Pairing Kamera' : 'Pasangkan Kamera HP Bekas'}
              </h3>
              <button
                type="button"
                onClick={() => setShowPairModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text)' }}
              >
                <X size={20} />
              </button>
            </div>

            {pairingResult ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
                  Masukkan kode berikut ke aplikasi <strong>Kamera Nexa Home</strong> di ponsel bekas Anda.
                  Kode ini berlaku selama <strong>10 menit</strong>:
                </p>

                <div className={styles.pairingCodeBox}>
                  <span className={styles.pairingCodeText}>{pairingResult.code}</span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                    Ruangan: {pairingResult.room_id} · {pairingResult.camera_name}
                  </span>
                </div>

                <AppButton
                  variant="primary"
                  onClick={() => setShowPairModal(false)}
                  style={{ width: '100%' }}
                >
                  Tutup
                </AppButton>
              </div>
            ) : (
              <form onSubmit={handleCreatePairingCode} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {pairError && (
                  <div style={{ color: 'var(--color-status-danger)', fontSize: 'var(--text-xs)' }}>
                    {pairError}
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                    Nama Kamera
                  </label>
                  <AppInput
                    placeholder="Kamera Ruang Tamu"
                    value={pairName}
                    onChange={(e) => setPairName(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                    Lokasi Ruangan
                  </label>
                  <AppInput
                    placeholder="Ruang Tamu"
                    value={pairRoom}
                    onChange={(e) => setPairRoom(e.target.value)}
                    required
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
                  <AppButton type="button" variant="outline" onClick={() => setShowPairModal(false)}>
                    Batal
                  </AppButton>
                  <AppButton type="submit" variant="primary">
                    Buat Kode Pairing
                  </AppButton>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal Pemutar Klip Video */}
      {selectedClip && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalCard} style={{ maxWidth: 720 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 700 }}>
                Pemutar Klip Rekaman Terdekripsi
              </h3>
              <button
                type="button"
                onClick={() => setSelectedClip(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text)' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ width: '100%', aspectRatio: '16/9', backgroundColor: 'var(--color-subtle)', borderRadius: 'var(--radius-button)', overflow: 'hidden' }}>
              <video
                src={camerasApi.getClipUrl(selectedClip.camId, selectedClip.clipId)}
                controls
                autoPlay
                style={{ width: '100%', height: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <AppButton variant="outline" onClick={() => setSelectedClip(null)}>
                Tutup
              </AppButton>
            </div>
          </div>
        </div>
      )}

      {/* Dialog Konfirmasi Cabut Kamera */}
      <ConfirmDialog
        open={!!revokingCameraId}
        title="Cabut Izin Kamera?"
        message="Apakah Anda yakin ingin mencabut kamera ini? Akses stream dan rekaman akan langsung diputus seketika."
        confirmLabel="Ya, Cabut Kamera"
        cancelLabel="Batal"
        danger
        onConfirm={handleRevokeConfirm}
        onCancel={() => setRevokingCameraId(null)}
      />
    </div>
  );
};
