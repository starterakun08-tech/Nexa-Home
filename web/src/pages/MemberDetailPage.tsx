import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, UserMinus, ShieldCheck, User as UserIcon } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { familyApi, type FamilyMemberItem } from '../api/family';
import { AppBadge } from '../components/AppBadge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import styles from './MemberDetailPage.module.css';

export const MemberDetailPage: React.FC = () => {
  const { memberId } = useParams<{ memberId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [member, setMember] = useState<(FamilyMemberItem & { is_active?: boolean; last_login_at?: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // Kick modal state
  const [showKickConfirm, setShowKickConfirm] = useState(false);
  const [kickLoading, setKickLoading] = useState(false);

  // Role update state
  const [roleLoading, setRoleLoading] = useState(false);

  useEffect(() => {
    if (!isAdmin) {
      navigate('/keluarga', { replace: true });
      return;
    }
    const fetchMember = async () => {
      if (!memberId) return;
      try {
        setLoading(true);
        const res = await familyApi.getMemberDetail(Number(memberId));
        if (res.status === 'ok' && res.member) {
          setMember(res.member);
        } else {
          setError('Data anggota tidak ditemukan.');
        }
      } catch (err: unknown) {
        const errObj = err as { message?: string };
        setError(errObj.message || 'Gagal memuat detail anggota.');
      } finally {
        setLoading(false);
      }
    };

    fetchMember();
  }, [memberId]);

  const handleRoleChange = async (newRole: string) => {
    if (!member) return;
    setRoleLoading(true);
    setMsg('');
    setError('');
    try {
      const res = await familyApi.updateMemberRole(member.id, newRole);
      setMsg(res.message);
      setMember((prev) => (prev ? { ...prev, role: newRole } : null));
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
        <button type="button" className={styles.backBtn} onClick={() => navigate('/keluarga')}>
          <ArrowLeft size={16} />
          <span>Kembali ke Anggota Nexa Home</span>
        </button>
        <div className={`${styles.msgBanner} ${styles.msgErr}`}>{error}</div>
      </div>
    );
  }

  if (!member) return null;

  const displayName = member.full_name || member.username;
  const initial = displayName.charAt(0).toUpperCase();
  const isSelf = user?.id === member.id;
  const isOwner = member.is_owner;
  const canModify = isAdmin && !isOwner && !isSelf;

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
      <button type="button" className={styles.backBtn} onClick={() => navigate('/keluarga')}>
        <ArrowLeft size={16} />
        <span>Kembali ke Anggota Nexa Home</span>
      </button>

      {msg && <div className={`${styles.msgBanner} ${styles.msgOk}`}>{msg}</div>}
      {error && <div className={`${styles.msgBanner} ${styles.msgErr}`}>{error}</div>}

      <div className={styles.profileCard}>
        {/* Header Profile */}
        <div className={styles.profileHeader}>
          <div className={styles.avatar}>{initial}</div>
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
              {member.role === 'admin' ? (
                <ShieldCheck size={20} color="var(--color-accent)" />
              ) : (
                <UserIcon size={20} color="var(--color-text-secondary)" />
              )}
              <span className={styles.roleLabel}>
                {member.role === 'admin'
                  ? isOwner
                    ? 'Pengelola Akun (Pemilik Utama)'
                    : 'Administrator Nexa Home'
                  : 'Anggota Biasa'}
              </span>
              <AppBadge variant={member.role === 'admin' ? 'ok' : 'neutral'}>
                {member.role === 'admin' ? 'Akses Penuh' : 'Akses Terbatas'}
              </AppBadge>
            </div>

            {canModify && (
              <div className={styles.roleActions}>
                <button
                  type="button"
                  className={`${styles.roleBtn} ${member.role === 'member' ? styles.roleBtnActive : ''}`}
                  disabled={roleLoading}
                  onClick={() => handleRoleChange('member')}
                >
                  Anggota
                </button>
                <button
                  type="button"
                  className={`${styles.roleBtn} ${member.role === 'admin' ? styles.roleBtnActive : ''}`}
                  disabled={roleLoading}
                  onClick={() => handleRoleChange('admin')}
                >
                  Admin
                </button>
              </div>
            )}
          </div>
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
        {canModify && (
          <div className={styles.dangerBlock}>
            <div className={styles.dangerText}>
              <h3 className={styles.dangerTitle}>Keluarkan dari Nexa Home</h3>
              <p className={styles.dangerSubtitle}>
                Akses pengguna ke seluruh perangkat saklar, kamera, dan sensor Nexa Home akan dicabut seketika.
              </p>
            </div>
            <button
              type="button"
              className={styles.kickBtnLarge}
              onClick={() => setShowKickConfirm(true)}
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
