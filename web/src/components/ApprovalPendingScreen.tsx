import React, { useState } from 'react';
import { ShieldWarning, Key, ArrowsClockwise, SignOut } from '@phosphor-icons/react';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/auth';
import { AppButton } from './AppButton';
import { AppInput } from './AppInput';
import { AppBadge } from './AppBadge';
import styles from './ApprovalPendingScreen.module.css';

export const ApprovalPendingScreen: React.FC = () => {
  const { user, setUser, logout } = useAuth();
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleRedeemInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;

    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const res = await authApi.redeemInvite(inviteCode.trim());
      setSuccessMsg(res.message || 'Kode undangan berhasil digunakan! Akun Anda telah aktif.');
      const updatedUser = await authApi.getMe();
      setUser(updatedUser);
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setErrorMsg(errObj.message || 'Kode undangan tidak valid atau sudah kedaluwarsa.');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckStatus = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setChecking(true);

    try {
      const updatedUser = await authApi.getMe();
      setUser(updatedUser);
      if (updatedUser.is_approved) {
        setSuccessMsg('Akun Anda telah disetujui! Memuat aplikasi...');
      } else {
        setErrorMsg('Akun Anda masih berstatus tertunda. Menunggu persetujuan Pengelola.');
      }
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setErrorMsg(errObj.message || 'Gagal memeriksa status.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.iconWrapper}>
            <ShieldWarning size={28} />
          </div>
          <AppBadge variant="warn">Akses Terbatas</AppBadge>
          <h1 className={styles.title}>Menunggu Persetujuan Admin</h1>
          <p className={styles.subtitle}>
            Halo <strong>{user?.display_name || user?.username}</strong>, akun Anda telah terdaftar namun belum disetujui oleh Administrator Nexa Home. Demi keamanan bersama, perangkat pintar belum dapat diakses.
          </p>
        </div>

        {errorMsg && <div className={`${styles.message} ${styles.messageDanger}`}>{errorMsg}</div>}
        {successMsg && <div className={`${styles.message} ${styles.messageOk}`}>{successMsg}</div>}

        <div className={styles.section}>
          <span className={styles.sectionTitle}>Punya Kode Undangan Keluarga?</span>
          <form onSubmit={handleRedeemInvite} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <AppInput
              type="text"
              placeholder="Contoh: RUMAH-ABCD"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            />
            <AppButton type="submit" variant="primary" disabled={loading || !inviteCode.trim()} style={{ width: '100%' }}>
              <Key size={18} />
              <span>Aktivasi dengan Kode</span>
            </AppButton>
          </form>
        </div>

        <div className={styles.section}>
          <div className={styles.buttonRow}>
            <AppButton variant="outline" onClick={handleCheckStatus} disabled={checking} style={{ flex: 1 }}>
              <ArrowsClockwise size={18} />
              <span>Cek Status</span>
            </AppButton>
            <AppButton variant="outline" onClick={logout} style={{ flex: 1 }}>
              <SignOut size={18} />
              <span>Keluar</span>
            </AppButton>
          </div>
        </div>
      </div>
    </div>
  );
};
