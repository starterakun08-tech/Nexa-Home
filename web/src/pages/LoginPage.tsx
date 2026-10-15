import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Sun, Moon, X } from '@phosphor-icons/react';
import { authApi, type SetupStatusResponse } from '../api/auth';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { AppButton } from '../components/AppButton';
import { AppInput } from '../components/AppInput';
import { AppBadge } from '../components/AppBadge';
import styles from './LoginPage.module.css';

const GoogleIcon: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
  </svg>
);

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, register, googleLogin, verify2fa, isAuthenticated } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [setupStatus, setSetupStatus] = useState<SetupStatusResponse | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [step, setStep] = useState<1 | 2>(1);
  const [isSetupMode, setIsSetupMode] = useState(false);

  // Form states - Login & Register
  const [username, setUsername] = useState('budi');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  // Setup Admin
  const [setupCode, setSetupCode] = useState('');

  // 2FA state
  const [tempToken, setTempToken] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);

  // Forgot password modal state
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotStep, setForgotStep] = useState<1 | 2>(1);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  // Google dev prompt
  const [showGooglePrompt, setShowGooglePrompt] = useState(false);
  const [googleDevEmail, setGoogleDevEmail] = useState('');

  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const otpInputsRef = useRef<(HTMLInputElement | null)[]>([]);

  // Jika sudah terautentikasi, alihkan ke beranda
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/beranda');
    }
  }, [isAuthenticated, navigate]);

  const handledGoogleCodeRef = useRef<string | null>(null);

  // Handle Google OAuth Callback jika ada ?code= di URL
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    if (code && handledGoogleCodeRef.current !== code) {
      handledGoogleCodeRef.current = code;
      setLoading(true);
      window.history.replaceState({}, document.title, window.location.pathname);
      googleLogin({ code, redirect_uri: window.location.origin + '/login' })
        .then((res) => {
          if (res.status === 'ok') {
            navigate('/beranda');
          } else if (res.status === '2fa_required' && res.temp_token) {
            setTempToken(res.temp_token);
            setStep(2);
          } else {
            setErrorMsg(res.message || 'Gagal masuk dengan Google.');
          }
        })
        .catch((err: unknown) => {
          const errObj = err as { message?: string };
          setErrorMsg(errObj.message || 'Gagal memproses otorisasi Google.');
        })
        .finally(() => setLoading(false));
    }
  }, [location.search, googleLogin, navigate]);

  // Cek apakah setup admin diperlukan
  useEffect(() => {
    authApi
      .getSetupStatus()
      .then((status) => {
        setSetupStatus(status);
        if (!status.admin_exists) {
          setIsSetupMode(true);
        }
      })
      .catch(() => {});
  }, []);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      if (isSetupMode) {
        const res = await authApi.setupAdmin({
          setup_code: setupCode,
          username,
          password,
        });
        if (res.status === 'ok') {
          setIsSetupMode(false);
          const loginRes = await login(username, password);
          if (loginRes.status === '2fa_required' && loginRes.temp_token) {
            setTempToken(loginRes.temp_token);
            setStep(2);
          } else {
            navigate('/beranda');
          }
        }
      } else if (authMode === 'login') {
        const res = await login(username, password);
        if (res.status === '2fa_required' && res.temp_token) {
          setTempToken(res.temp_token);
          setStep(2);
        } else if (res.status === 'ok') {
          navigate('/beranda');
        } else {
          setErrorMsg(res.message || 'Gagal masuk.');
        }
      } else {
        // Register mandiri
        const res = await register({
          full_name: fullName,
          username,
          email,
          password,
          invite_code: inviteCode.trim() ? inviteCode.trim() : undefined,
        });
        if (res.status === 'ok') {
          navigate('/beranda');
        } else {
          setErrorMsg(res.message || 'Pendaftaran gagal.');
        }
      }
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setErrorMsg(errObj.message || 'Terjadi kesalahan saat memproses.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleClick = async () => {
    setErrorMsg('');
    setLoading(true);
    try {
      const res = await authApi.getGoogleAuthUrl(window.location.origin + '/login');
      // Jika Google Client ID sudah dikonfigurasi di server
      if (res.url && !res.url.includes('client_id=&')) {
        window.location.href = res.url;
      } else {
        // Jika belum diisi di .env, tampilkan modal interaktif untuk pengujian langsung
        setShowGooglePrompt(true);
      }
    } catch {
      setShowGooglePrompt(true);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleDevSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!googleDevEmail) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await googleLogin({ id_token: `mock_google_${googleDevEmail.trim().toLowerCase()}` });
      setShowGooglePrompt(false);
      if (res.status === 'ok') {
        navigate('/beranda');
      } else if (res.status === '2fa_required' && res.temp_token) {
        setTempToken(res.temp_token);
        setStep(2);
      } else {
        setErrorMsg(res.message || 'Gagal masuk.');
      }
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setErrorMsg(errObj.message || 'Gagal login via Google.');
    } finally {
      setLoading(false);
    }
  };

  // Forgot password flow
  const handleForgotRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError('');
    setForgotMsg('');
    setForgotLoading(true);
    try {
      const res = await authApi.forgotPasswordRequest(forgotEmail);
      setForgotMsg(res.message || 'Kode OTP telah dikirimkan ke email Anda.');
      setForgotStep(2);
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setForgotError(errObj.message || 'Gagal meminta kode OTP.');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleForgotReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError('');
    setForgotMsg('');
    setForgotLoading(true);
    try {
      const res = await authApi.forgotPasswordReset(forgotEmail, forgotOtp, forgotNewPassword);
      setSuccessMsg(res.message || 'Kata sandi berhasil diperbarui! Silakan masuk.');
      setShowForgotModal(false);
      setAuthMode('login');
      setUsername(forgotEmail);
      setPassword('');
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setForgotError(errObj.message || 'Gagal memperbarui kata sandi.');
    } finally {
      setForgotLoading(false);
    }
  };

  const handleOtpChange = (index: number, val: string) => {
    if (!/^[0-9]?$/.test(val)) return;
    const newOtp = [...otp];
    newOtp[index] = val;
    setOtp(newOtp);

    if (val && index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus();
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otp.join('');
    if (code.length !== 6) {
      setErrorMsg('Masukkan 6-digit kode verifikasi lengkap.');
      return;
    }

    setErrorMsg('');
    setLoading(true);
    try {
      const res = await verify2fa(tempToken, code);
      if (res.status === 'ok') {
        navigate('/beranda');
      } else {
        setErrorMsg(res.message || 'Kode verifikasi tidak valid.');
      }
    } catch (err: unknown) {
      const errObj = err as { message?: string };
      setErrorMsg(errObj.message || 'Verifikasi 2FA gagal.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      {/* Top Header Minimal */}
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandTitle}>Nexa Home</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <button
            type="button"
            onClick={toggleTheme}
            className={styles.themeToggle}
            title={theme === 'light' ? 'Beralih ke mode gelap' : 'Beralih ke mode terang'}
            aria-label="Ubah tema"
          >
            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
          </button>
          <AppBadge variant="ok">Server terhubung</AppBadge>
        </div>
      </header>

      {/* Main Form Center */}
      <main className={styles.main}>
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div className={styles.titleRow}>
              <h1 className={styles.cardTitle}>
                {isSetupMode
                  ? 'Penyiapan Admin'
                  : step === 2
                  ? 'Verifikasi 2 Langkah'
                  : authMode === 'login'
                  ? 'Masuk ke Nexa Home'
                  : 'Daftar Akun Baru'}
              </h1>
              <span
                style={{
                  fontSize: 'var(--text-xs)',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-chip)',
                  backgroundColor: 'var(--color-subtle)',
                  color: 'var(--color-text-secondary)',
                  fontWeight: 600,
                }}
              >
                {isSetupMode ? 'Setup' : step === 2 ? 'Tahap 2/2' : authMode === 'login' ? 'Masuk' : 'Daftar'}
              </span>
            </div>
            <p className={styles.cardSubtitle}>
              {isSetupMode
                ? 'Buat akun pengelola utama Nexa Home'
                : step === 2
                ? 'Masukkan kode TOTP dari aplikasi autentikator'
                : authMode === 'login'
                ? 'Gunakan Username atau Email Anda'
                : 'Lengkapi data untuk membuat akun penghuni'}
            </p>
          </div>

          {!isSetupMode && step === 1 && (
            <div className={styles.tabBar}>
              <button
                type="button"
                className={`${styles.tabItem} ${authMode === 'login' ? styles.tabItemActive : ''}`}
                onClick={() => {
                  setAuthMode('login');
                  setErrorMsg('');
                }}
              >
                Masuk
              </button>
              <button
                type="button"
                className={`${styles.tabItem} ${authMode === 'register' ? styles.tabItemActive : ''}`}
                onClick={() => {
                  setAuthMode('register');
                  setErrorMsg('');
                }}
              >
                Daftar Akun Baru
              </button>
            </div>
          )}

          {errorMsg && <div className={styles.errorMessage}>{errorMsg}</div>}
          {successMsg && <div className={styles.successMessage}>{successMsg}</div>}

          {step === 1 ? (
            <form onSubmit={handleLoginSubmit} className={styles.form}>
              {isSetupMode && setupStatus?.setup_code_required && (
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="setupCode">
                    Kode Setup Awal
                  </label>
                  <AppInput
                    id="setupCode"
                    type="password"
                    placeholder="Masukkan kode setup dari server..."
                    value={setupCode}
                    onChange={(e) => setSetupCode(e.target.value)}
                    required
                  />
                </div>
              )}

              {authMode === 'register' && !isSetupMode && (
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="fullName">
                    Nama Lengkap
                  </label>
                  <AppInput
                    id="fullName"
                    type="text"
                    placeholder="Nama lengkap Anda..."
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </div>
              )}

              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="username">
                  {authMode === 'login' && !isSetupMode ? 'Nama Pengguna atau Email' : 'Nama Pengguna'}
                </label>
                <AppInput
                  id="username"
                  type="text"
                  placeholder={authMode === 'login' && !isSetupMode ? 'Username atau email...' : 'Pilih nama pengguna...'}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>

              {authMode === 'register' && !isSetupMode && (
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="email">
                    Alamat Email Aktif
                  </label>
                  <AppInput
                    id="email"
                    type="email"
                    placeholder="nama@email.com..."
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              )}

              <div className={styles.fieldGroup}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className={styles.label} htmlFor="password">
                    Kata Sandi
                  </label>
                  {authMode === 'login' && !isSetupMode && (
                    <button
                      type="button"
                      className={styles.forgotBtn}
                      onClick={() => {
                        setShowForgotModal(true);
                        setForgotStep(1);
                        setForgotError('');
                        setForgotMsg('');
                      }}
                    >
                      Lupa Kata Sandi?
                    </button>
                  )}
                </div>
                <AppInput
                  id="password"
                  type="password"
                  placeholder="Masukkan kata sandi..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {authMode === 'register' && !isSetupMode && (
                <div className={styles.fieldGroup}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label className={styles.label} htmlFor="inviteCode">
                      Kode Undangan Keluarga
                    </label>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                      Opsional
                    </span>
                  </div>
                  <AppInput
                    id="inviteCode"
                    type="text"
                    placeholder="Contoh: RUMAH-ABCD (Langsung aktif)"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  />
                </div>
              )}

              <AppButton type="submit" variant="primary" disabled={loading} style={{ width: '100%', marginTop: 'var(--space-2)' }}>
                <span>{isSetupMode ? 'Buat Akun Admin' : authMode === 'login' ? 'Masuk' : 'Daftar Akun Baru'}</span>
                <ArrowRight size={18} />
              </AppButton>

              {!isSetupMode && (
                <>
                  <div className={styles.dividerRow}>
                    <div className={styles.dividerLine} />
                    <span>atau</span>
                    <div className={styles.dividerLine} />
                  </div>

                  <button
                    type="button"
                    className={styles.googleBtn}
                    onClick={handleGoogleClick}
                    disabled={loading}
                  >
                    <GoogleIcon />
                    <span>{authMode === 'login' ? 'Lanjutkan dengan Google' : 'Daftar dengan Google'}</span>
                  </button>
                </>
              )}
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className={styles.form}>
              <div className={styles.fieldGroup}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                  <label className={styles.label}>Kode Verifikasi 6-Digit</label>
                </div>
                <div className={styles.otpRow}>
                  {otp.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => {
                        otpInputsRef.current[idx] = el;
                      }}
                      className={styles.otpInput}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      pattern="[0-9]"
                      value={digit}
                      onChange={(e) => handleOtpChange(idx, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                    />
                  ))}
                </div>
              </div>

              <AppButton
                type="submit"
                variant="primary"
                disabled={loading}
                style={{ width: '100%', marginTop: 'var(--space-2)' }}
              >
                <ShieldCheck size={18} />
                <span>Verifikasi & Masuk</span>
              </AppButton>

              <AppButton
                type="button"
                variant="outline"
                onClick={() => setStep(1)}
                style={{ width: '100%' }}
              >
                Kembali
              </AppButton>
            </form>
          )}

          <div className={styles.cardMeta}>
            <span>Protokol Jaringan</span>
            <span className={styles.metaMono}>MQTT · TLS</span>
          </div>
        </div>
      </main>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                {forgotStep === 1 ? 'Lupa Kata Sandi' : 'Verifikasi OTP & Kata Sandi Baru'}
              </h3>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setShowForgotModal(false)}
              >
                <X size={20} />
              </button>
            </div>

            {forgotError && <div className={styles.errorMessage} style={{ marginBottom: 'var(--space-3)' }}>{forgotError}</div>}
            {forgotMsg && <div className={styles.successMessage} style={{ marginBottom: 'var(--space-3)' }}>{forgotMsg}</div>}

            {forgotStep === 1 ? (
              <form onSubmit={handleForgotRequest} className={styles.form}>
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="forgotEmail">
                    Alamat Email Terdaftar
                  </label>
                  <AppInput
                    id="forgotEmail"
                    type="email"
                    placeholder="nama@email.com..."
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    required
                  />
                </div>
                <AppButton type="submit" variant="primary" disabled={forgotLoading} style={{ width: '100%' }}>
                  <span>Kirim Kode OTP</span>
                  <ArrowRight size={18} />
                </AppButton>
              </form>
            ) : (
              <form onSubmit={handleForgotReset} className={styles.form}>
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="forgotOtp">
                    Kode OTP 6-Digit (dari Email)
                  </label>
                  <AppInput
                    id="forgotOtp"
                    type="text"
                    maxLength={6}
                    placeholder="Contoh: 123456"
                    value={forgotOtp}
                    onChange={(e) => setForgotOtp(e.target.value)}
                    required
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.label} htmlFor="forgotNewPassword">
                    Kata Sandi Baru
                  </label>
                  <AppInput
                    id="forgotNewPassword"
                    type="password"
                    placeholder="Masukkan kata sandi baru..."
                    value={forgotNewPassword}
                    onChange={(e) => setForgotNewPassword(e.target.value)}
                    required
                  />
                </div>
                <AppButton type="submit" variant="primary" disabled={forgotLoading} style={{ width: '100%' }}>
                  <span>Perbarui Kata Sandi</span>
                  <ShieldCheck size={18} />
                </AppButton>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Google Dev Testing Prompt (bila client ID belum diisi) */}
      {showGooglePrompt && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalCard}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>Masuk via Akun Google</h3>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={() => setShowGooglePrompt(false)}
              >
                <X size={20} />
              </button>
            </div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
              Masukkan email Google Anda untuk simulasi masuk / registrasi Google OAuth:
            </p>
            <form onSubmit={handleGoogleDevSubmit} className={styles.form}>
              <div className={styles.fieldGroup}>
                <label className={styles.label} htmlFor="devGoogleEmail">
                  Email Akun Google
                </label>
                <AppInput
                  id="devGoogleEmail"
                  type="email"
                  placeholder="nama.user@gmail.com"
                  value={googleDevEmail}
                  onChange={(e) => setGoogleDevEmail(e.target.value)}
                  required
                />
              </div>
              <AppButton type="submit" variant="primary" disabled={loading} style={{ width: '100%' }}>
                <GoogleIcon />
                <span>Lanjutkan dengan Akun Google</span>
              </AppButton>
            </form>
          </div>
        </div>
      )}

      {/* Footer Minimal */}
      <footer className={styles.footer}>
        <div className={styles.footerNote}>
          <span className={styles.dot} />
          <span>Akses aman untuk penghuni Nexa Home · aujasena.my.id</span>
        </div>
        <div>
          <span>Protokol MQTT · 2026</span>
        </div>
      </footer>
    </div>
  );
};
