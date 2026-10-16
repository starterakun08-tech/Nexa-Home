import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, UserMinus, ShieldCheck, User as UserIcon } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { familyApi, type FamilyMemberItem } from '../api/family';
import { AppBadge } from '../components/AppBadge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Avatar } from '../components/SegmentedList';
import { isOwnerRole, getRoleLabel } from '../utils/roleLabels';
import styles from './MemberDetailPage.module.css';

export const MemberDetailPage: React.FC = () => {
  const { memberId } = useParams<{ memberId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isOwner = isOwnerRole(user?.role);

  const [member, setMember] = useState<(FamilyMemberItem & { is_active?: boolean; last_login_at?: string }) | null>(null);
  const [members, setMembers] = useState<FamilyMemberItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // Kick modal state
  const [showKickConfirm, setShowKickConfirm] = useState(false);
  const [kickLoading, setKickLoading] = useState(false);

  // Role update state
  const [roleLoading, setRoleLoading] = useState(false);

  useEffect(() => {
    if (!isOwner) {
      navigate('/keluarga', { replace: true });
      return;
    }
    const fetchData = async () => {
      if (!memberId) return;
      try {
        setLoading(true);
        const [memberRes, membersRes] = await Promise.allSettled([
          familyApi.getMemberDetail(Number(memberId)),
          familyApi.getMembers(),
        ]);

        if (memberRes.status === 'fulfilled' && memberRes.value.status === 'ok' && memberRes.value.member) {
          setMember(memberRes.value.member);
        } else {
          setError('Data anggota tidak ditemukan.');
        }

        if (membersRes.status === 'fulfilled' && membersRes.value.status === 'ok') {
          setMembers(membersRes.value.members || []);
        }
      } catch (err: unknown) {
        const errObj = err as { message?: string };
        setError(errObj.message || 'Gagal memuat detail anggota.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [memberId, isOwner, navigate]);

  const handleRoleChange = async (newRole: string) => {
    if (!member) return;
    setRoleLoading(true);
    setMsg('');
    setError('');
    try {
      const res = await familyApi.updateMemberRole(member.id, newRole);
      setMsg(res.message);
      setMember((prev) => (prev ? { ...prev, role: newRole } : null));
      const membersRes = await familyApi.getMembers().catch(() => null);
      if (membersRes?.members) {
        setMembers(membersRes.members);
      }
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setError(errObj.message || 'Gagal memperbarui peran anggota.');
    } finally {
      setRoleLoading(false);
    }
  };

  const handleKickConfirm = async () => {
    if (!member) return;
    setKickLoading(true);
    setError('');
    try {
      await familyApi.removeMember(member.id);
      navigate('/keluarga', { replace: true });
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setError(errObj.message || 'Gagal mengeluarkan anggota dari Nexa Home.');
      setKickLoading(false);
      setShowKickConfirm(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
          Memuat data anggota...
        </p>
      </div>
    );
  }

  if (error && !member) {
    return (
      <div className={styles.container}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={() => navigate('/keluarga')}
          aria-label="Kembali ke Anggota keluarga"
        >
          <ArrowLeft size={16} />
          <span>Anggota keluarga</span>
        </button>
        <div className={`${styles.msgBanner} ${styles.msgErr}`}>{error}</div>
      </div>
    );
  }

  if (!member) return null;

  const displayName = member.full_name || member.username;
  const isSelf = user?.id === member.id;
  const isTargetOwner = member.is_owner || isOwnerRole(member.role);
  const totalOwners = members.filter((m) => m.is_owner || isOwnerRole(m.role)).length;
  const isLastOwner = isTargetOwner && totalOwners <= 1;

  // Role permissions
  const canChangeRole = isOwner && !isSelf && !isLastOwner;
  const roleDisabledReason = isSelf
    ? 'Tidak dapat mengubah peran akun sendiri'
    : isLastOwner
    ? 'Tidak dapat mengeluarkan atau menurunkan pemilik rumah terakhir'
    : undefined;

  // Kick permissions
  const canKick = isOwner && !isSelf && !isLastOwner;
  const kickDisabledReason = isSelf
    ? 'Tidak dapat mengeluarkan akun sendiri'
    : isLastOwner
    ? 'Tidak dapat mengeluarkan atau menurunkan pemilik rumah terakhir'
    : undefined;

  const createdDateStr = member.created_at
    ? new Date(member.created_at).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '-';

  const lastLoginStr = member.last_login_at
    ? new Date(member.last_login_at).toLocaleString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Belum pernah login';

  return (
    <div className={styles.container}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => navigate('/keluarga')}
        aria-label="Kembali ke Anggota keluarga"
      >
        <ArrowLeft size={16} />
        <span>Anggota keluarga</span>
      </button>

      {msg && <div className={`${styles.msgBanner} ${styles.msgOk}`}>{msg}</div>}
      {error && <div className={`${styles.msgBanner} ${styles.msgErr}`}>{error}</div>}

      <div className={styles.profileCard}>
        {/* Header Profile with 72px Avatar */}
        <div className={styles.profileHeader}>
          <Avatar name={displayName} size={72} />
          <div className={styles.profileDetails}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <h1 className={styles.displayName}>{displayName}</h1>
              {isSelf && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>(Anda)</span>}
            </div>
            <span className={styles.emailSubtext}>
              {member.email ? `${member.email} · ` : ''}@{member.username}
            </span>
          </div>
        </div>

        {/* Section Peran */}
        <div className={styles.sectionBlock}>
          <h2 className={styles.sectionTitle}>Peran dalam Nexa Home</h2>
          <p className={styles.sectionDesc}>
            Peran menentukan akses kendali perangkat, penambahan anggota baru, serta visibilitas analitik sensor.
          </p>

          <div className={styles.roleSelectorRow}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              {isOwnerRole(member.role) ? (
                <ShieldCheck size={20} color="var(--color-accent)" />
              ) : (
                <UserIcon size={20} color="var(--color-text-secondary)" />
              )}
              <span className={styles.roleLabel}>
                {getRoleLabel(member.role)}
              </span>
              <AppBadge variant={isOwnerRole(member.role) ? 'ok' : 'neutral'}>
                {isOwnerRole(member.role) ? 'Akses Penuh' : 'Akses Terbatas'}
              </AppBadge>
            </div>

            {isOwner && (
              <div className={styles.roleActions} title={roleDisabledReason}>
                <button
                  type="button"
                  className={`${styles.roleBtn} ${!isOwnerRole(member.role) ? styles.roleBtnActive : ''}`}
                  disabled={roleLoading || !canChangeRole}
                  onClick={() => handleRoleChange('member')}
                  title={roleDisabledReason}
                >
                  Anggota
                </button>
                <button
                  type="button"
                  className={`${styles.roleBtn} ${isOwnerRole(member.role) ? styles.roleBtnActive : ''}`}
                  disabled={roleLoading || !canChangeRole}
                  onClick={() => handleRoleChange('admin')}
                  title={roleDisabledReason}
                >
                  Pemilik
                </button>
              </div>
            )}
          </div>
          {roleDisabledReason && (
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
              {roleDisabledReason}
            </p>
          )}
        </div>

        {/* Info Grid */}
        <div className={styles.sectionBlock}>
          <h2 className={styles.sectionTitle}>Aktivitas & Akses</h2>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}>
              <span className={styles.infoItemLabel}>Bergabung ke Nexa Home</span>
              <span className={styles.infoItemValue}>{createdDateStr}</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoItemLabel}>Sesi Terakhir Aktif</span>
              <span className={styles.infoItemValue}>{lastLoginStr}</span>
            </div>
          </div>
        </div>

        {/* Danger Zone: Keluarkan Anggota */}
        {isOwner && (
          <div className={styles.dangerBlock}>
            <div className={styles.dangerText}>
              <h3 className={styles.dangerTitle}>Keluarkan dari Nexa Home</h3>
              <p className={styles.dangerSubtitle}>
                {kickDisabledReason
                  ? kickDisabledReason
                  : 'Akses pengguna ke seluruh perangkat saklar, kamera, dan sensor Nexa Home akan dicabut seketika.'}
              </p>
            </div>
            <button
              type="button"
              className={styles.kickBtnLarge}
              disabled={!canKick || kickLoading}
              onClick={() => setShowKickConfirm(true)}
              title={kickDisabledReason}
            >
              <UserMinus size={16} />
              <span>Keluarkan Anggota</span>
            </button>
          </div>
        )}
      </div>

      {/* Confirm Kick Member Dialog */}
      <ConfirmDialog
        isOpen={showKickConfirm}
        title="Keluarkan dari Nexa Home"
        message={`Apakah Anda yakin ingin mengeluarkan ${displayName} dari Nexa Home? Akses mereka ke perangkat dan pantauan Nexa Home akan langsung dicabut.`}
        confirmLabel={kickLoading ? 'Mengeluarkan...' : 'Keluarkan dari Nexa Home'}
        cancelLabel="Batal"
        isDanger={true}
        onConfirm={handleKickConfirm}
        onCancel={() => setShowKickConfirm(false)}
      />
    </div>
  );
};
