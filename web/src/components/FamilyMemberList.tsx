import React from 'react';
import { UserMinus, X } from '@phosphor-icons/react';
import { AppBadge } from './AppBadge';
import type { FamilyMemberItem } from '../api/family';
import styles from './FamilyMemberList.module.css';

export interface FamilyInvitationData {
  id: number;
  invitee_email: string;
  status: 'pending' | 'accepted' | 'rejected' | string;
  created_at?: string;
  updated_at?: string;
}

export interface FamilyMemberListProps {
  members: FamilyMemberItem[];
  invitations?: FamilyInvitationData[];
  currentUserId?: number;
  currentUsername?: string;
  isLoading?: boolean;
  isAdmin?: boolean;
  onRemoveMember?: (memberId: number, memberName: string) => void;
  onCancelInvitation?: (invitationId: number, email: string) => void;
}

export const FamilyMemberList: React.FC<FamilyMemberListProps> = ({
  members,
  invitations = [],
  currentUserId,
  currentUsername,
  isLoading = false,
  isAdmin = false,
  onRemoveMember,
  onCancelInvitation,
}) => {
  // 1. Urutkan anggota aktif: Pemilik (admin/owner) di paling atas, diikuti Anggota
  const owners = members.filter((m) => m.role === 'admin' || m.is_owner);
  const activeMembers = members.filter((m) => m.role !== 'admin' && !m.is_owner);

  // 2. Filter undangan: pisahkan pending dari status lainnya
  const pendingInvites = invitations.filter(
    (inv) => inv.status === 'pending' || inv.status === 'menunggu'
  );

  // Total terdaftar / terhubung
  const totalCount = members.length + pendingInvites.length;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>Anggota Keluarga</h3>
          <p className={styles.subtitle}>
            Kelola pemilik dan anggota keluarga yang memiliki akses ke Nexa Home
          </p>
        </div>
        <span className={styles.memberCount}>{totalCount} Orang</span>
      </div>

      <div className={styles.list}>
        {isLoading && members.length === 0 ? (
          <div className={styles.emptyState}>Memuat data anggota keluarga...</div>
        ) : totalCount === 0 ? (
          <div className={styles.emptyState}>Belum ada anggota keluarga terdaftar.</div>
        ) : (
          <>
            {/* Bagian 1: Pemilik (Admin / Owner) */}
            {owners.map((member) => {
              const isCurrentUser =
                (currentUserId && member.id === currentUserId) ||
                (currentUsername && member.username === currentUsername);
              const displayName = member.full_name || member.username;
              const initial = displayName.charAt(0).toUpperCase();

              return (
                <div key={`member-${member.id}`} className={styles.memberItem}>
                  <div className={styles.userInfo}>
                    <div className={styles.avatar}>{initial}</div>
                    <div className={styles.nameBlock}>
                      <div className={styles.nameRow}>
                        <span className={styles.name}>{displayName}</span>
                        {isCurrentUser && <span className={styles.youLabel}>(Anda)</span>}
                      </div>
                      <span className={styles.subtext}>
                        {member.email || `@${member.username}`}
                      </span>
                    </div>
                  </div>

                  <div className={styles.rightMeta}>
                    <span className={styles.roleLabel}>Pemilik</span>
                    <AppBadge variant="ok">Diterima</AppBadge>
                  </div>
                </div>
              );
            })}

            {/* Bagian 2: Anggota Aktif */}
            {activeMembers.map((member) => {
              const isCurrentUser =
                (currentUserId && member.id === currentUserId) ||
                (currentUsername && member.username === currentUsername);
              const displayName = member.full_name || member.username;
              const initial = displayName.charAt(0).toUpperCase();

              return (
                <div key={`member-${member.id}`} className={styles.memberItem}>
                  <div className={styles.userInfo}>
                    <div className={styles.avatar}>{initial}</div>
                    <div className={styles.nameBlock}>
                      <div className={styles.nameRow}>
                        <span className={styles.name}>{displayName}</span>
                        {isCurrentUser && <span className={styles.youLabel}>(Anda)</span>}
                        {isAdmin && !isCurrentUser && onRemoveMember && (
                          <button
                            type="button"
                            className={styles.kickBtn}
                            onClick={() => onRemoveMember(member.id, displayName)}
                            title={`Keluarkan ${displayName} dari keluarga`}
                            aria-label={`Keluarkan ${displayName} dari keluarga`}
                          >
                            <UserMinus size={13} />
                            <span>Keluarkan</span>
                          </button>
                        )}
                      </div>
                      <span className={styles.subtext}>
                        {member.email || `@${member.username}`}
                      </span>
                    </div>
                  </div>

                  <div className={styles.rightMeta}>
                    <span className={styles.roleLabel}>Anggota</span>
                    <AppBadge variant="ok">Diterima</AppBadge>
                  </div>
                </div>
              );
            })}

            {/* Bagian 3: Undangan Pending (Menunggu Konfirmasi) */}
            {pendingInvites.map((invite) => {
              const initial = (invite.invitee_email || 'U').charAt(0).toUpperCase();
              const sentTimeStr = invite.created_at
                ? new Date(invite.created_at).toLocaleDateString('id-ID', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : null;

              return (
                <div key={`invite-${invite.id}`} className={styles.memberItem}>
                  <div className={styles.userInfo}>
                    <div className={`${styles.avatar} ${styles.avatarPending}`}>{initial}</div>
                    <div className={styles.nameBlock}>
                      <div className={styles.nameRow}>
                        <span className={styles.name}>{invite.invitee_email}</span>
                        {isAdmin && onCancelInvitation && (
                          <button
                            type="button"
                            className={styles.kickBtn}
                            onClick={() => onCancelInvitation(invite.id, invite.invitee_email)}
                            title={`Batalkan undangan untuk ${invite.invitee_email}`}
                            aria-label={`Batalkan undangan untuk ${invite.invitee_email}`}
                          >
                            <X size={13} />
                            <span>Batalkan</span>
                          </button>
                        )}
                      </div>
                      <span className={styles.subtext}>
                        {sentTimeStr ? `Dikirim pada ${sentTimeStr}` : 'Undangan terkirim'}
                      </span>
                    </div>
                  </div>

                  <div className={styles.rightMeta}>
                    <span className={styles.roleLabel}>Anggota</span>
                    <AppBadge variant="warn">Menunggu Konfirmasi</AppBadge>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
};
