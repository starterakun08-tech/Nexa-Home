import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Warning } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { AppButton } from '../components/AppButton';
import { AppInput } from '../components/AppInput';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { SegmentedList, ListRow, InfoRow } from '../components/SegmentedList';
import { familyApi, type FamilyMemberItem, type TransparencyData } from '../api/family';
import { isOwnerRole } from '../utils/roleLabels';
import styles from './KeluargaPage.module.css';

export const KeluargaPage: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isOwner = isOwnerRole(user?.role);

  // Modals state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [inviteInput, setInviteInput] = useState('');
  const [inviteModalError, setInviteModalError] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [feedbackErr, setFeedbackErr] = useState('');

  // Cancel invite state
  const [cancelTarget, setCancelTarget] = useState<{ id: number; email: string } | null>(null);

  // 1. Transparency query (worker status)
  const { data: transparency } = useQuery<TransparencyData>({
    queryKey: ['family-transparency'],
    queryFn: familyApi.getTransparency,
    staleTime: 30000,
  });

  // 2. Members query (BUG-10: reactive with queryKey ['family-members'])
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
    enabled: isOwner,
    refetchInterval: 10000,
  });

  // Send invite mutation
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

  // Cancel invite mutation
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

  // Sort order: 1. Pemilik, 2. Anggota, 3. Anak, 4. Other
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

        {isOwner && (
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
                  to={isOwner ? `/keluarga/${m.id}` : undefined}
                  showChevron={isOwner}
                />
              );
            })}

            {/* Pending Invitations at Bottom (Owner only) */}
            {isOwner &&
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
        </>
      )}

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
    </div>
  );
};
