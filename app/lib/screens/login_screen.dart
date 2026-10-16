import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:local_auth/local_auth.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:app/components/app_bottom_sheet.dart';
import 'package:app/components/app_button.dart';
import 'package:app/components/app_input.dart';
import 'package:app/components/app_toast.dart';
import 'package:app/core/api_client.dart';
import 'package:app/core/auth_state.dart';
import 'package:app/core/storage.dart';
import 'package:app/theme/tokens.dart';

import 'package:app/screens/google_oauth_screen.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  // Mode: 'login' atau 'register'
  String _mode = 'login';

  // Login controllers
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();

  // Register controllers
  final _regFullNameController = TextEditingController();
  final _regUsernameController = TextEditingController();
  final _regEmailController = TextEditingController();
  final _regPasswordController = TextEditingController();
  final _regInviteCodeController = TextEditingController();

  // Server state
  String _currentServerUrl = StorageService.defaultServerUrl;

  bool _obscurePassword = true;
  bool _obscureRegPassword = true;
  bool _isSubmitting = false;

  final _localAuth = LocalAuthentication();
  bool _canCheckBiometrics = false;

  @override
  void initState() {
    super.initState();
    _checkBiometrics();
    StorageService.getUsername().then((saved) {
      if (saved != null && saved.isNotEmpty && mounted) {
        _usernameController.text = saved;
      }
    });
    StorageService.getServerUrl().then((url) {
      if (mounted) setState(() => _currentServerUrl = url);
    });
  }

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    _regFullNameController.dispose();
    _regUsernameController.dispose();
    _regEmailController.dispose();
    _regPasswordController.dispose();
    _regInviteCodeController.dispose();
    super.dispose();
  }

  Future<void> _checkBiometrics() async {
    try {
      final isEnabled = await StorageService.isBiometricEnabled();
      if (isEnabled) {
        final canCheck = await _localAuth.canCheckBiometrics;
        if (mounted) setState(() => _canCheckBiometrics = canCheck);
      }
    } catch (_) {}
  }

  Future<void> _handleLogin() async {
    final username = _usernameController.text.trim();
    final password = _passwordController.text;

    if (username.isEmpty || password.isEmpty) {
      AppToast.show(context, 'Masukkan nama pengguna atau email dan kata sandi.', isError: true);
      return;
    }

    setState(() => _isSubmitting = true);
    try {
      final success = await ref.read(authProvider.notifier).login(username, password);
      if (!mounted) return;

      final state = ref.read(authProvider);
      if (success) {
        if (state.status == AuthStatus.twoFactorPending) {
          context.go('/verify-2fa');
        } else if (state.status == AuthStatus.authenticated) {
          context.go('/');
        }
      } else {
        final err = state.errorMessage ?? 'Nama pengguna atau kata sandi tidak sesuai.';
        AppToast.show(context, err, isError: true);
      }
    } catch (e) {
      if (mounted) {
        AppToast.show(context, 'Koneksi ke server gagal: $e', isError: true);
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _handleRegister() async {
    final fullName = _regFullNameController.text.trim();
    final username = _regUsernameController.text.trim();
    final email = _regEmailController.text.trim();
    final password = _regPasswordController.text;
    final inviteCode = _regInviteCodeController.text.trim();

    if (username.isEmpty || email.isEmpty || password.isEmpty) {
      AppToast.show(context, 'Nama pengguna, email, dan kata sandi wajib diisi.', isError: true);
      return;
    }

    setState(() => _isSubmitting = true);
    try {
      final success = await ref.read(authProvider.notifier).register(
        fullName: fullName.isEmpty ? username : fullName,
        username: username,
        email: email,
        password: password,
        inviteCode: inviteCode.isEmpty ? null : inviteCode,
      );
      if (!mounted) return;

      final state = ref.read(authProvider);
      if (success) {
        if (state.status == AuthStatus.authenticated) {
          context.go('/');
        }
      } else {
        final err = state.errorMessage ?? 'Pendaftaran gagal.';
        AppToast.show(context, err, isError: true);
      }
    } catch (e) {
      if (mounted) {
        AppToast.show(context, 'Pendaftaran gagal: $e', isError: true);
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _handleGoogleLogin() async {
    setState(() => _isSubmitting = true);
    try {
      // 1. Coba Native Google Sign In via bottom-sheet Android
      final googleSignIn = GoogleSignIn(
        serverClientId: '308846339094-40iamjf6utfldtrroe4f6v48j5viaiq7.apps.googleusercontent.com',
        scopes: ['email', 'profile', 'openid'],
      );

      GoogleSignInAccount? account;
      try {
        account = await googleSignIn.signIn();
      } catch (nativeErr) {
        debugPrint('[GoogleAuth] Native sign in failed, fallback to In-App OAuth: $nativeErr');
      }

      if (account != null) {
        final auth = await account.authentication;
        final idToken = auth.idToken;
        final accessToken = auth.accessToken;

        if (idToken != null || accessToken != null) {
          final success = await ref.read(authProvider.notifier).googleAuth(
            idToken: idToken,
            accessToken: accessToken,
          );
          if (!mounted) return;
          final state = ref.read(authProvider);
          if (success) {
            if (state.status == AuthStatus.twoFactorPending) {
              context.go('/verify-2fa');
            } else if (state.status == AuthStatus.authenticated) {
              context.go('/');
            }
            return;
          } else {
            final err = state.errorMessage ?? 'Gagal masuk menggunakan Google.';
            AppToast.show(context, err, isError: true);
            return;
          }
        }
      }

      // 2. Fallback: Dapatkan URL Consent Google dari server dan buka In-App WebView
      String? authUrl;
      try {
        final dio = await ApiClient.getInstance();
        final res = await dio.get(
          '/api/auth/google/url',
          queryParameters: {'redirect_uri': 'https://aujasena.my.id/login'},
        );
        authUrl = res.data['url']?.toString();
      } catch (e) {
        debugPrint('[GoogleAuth] Gagal mengambil URL Google OAuth: $e');
      }

      if (authUrl != null && authUrl.isNotEmpty) {
        if (!mounted) return;
        setState(() => _isSubmitting = false);
        final code = await GoogleOAuthScreen.show(context, authUrl);
        if (code != null && code.isNotEmpty) {
          setState(() => _isSubmitting = true);
          final success = await ref.read(authProvider.notifier).googleAuth(
            code: code,
            redirectUri: 'https://aujasena.my.id/login',
          );
          if (!mounted) return;
          final state = ref.read(authProvider);
          if (success) {
            if (state.status == AuthStatus.twoFactorPending) {
              context.go('/verify-2fa');
            } else if (state.status == AuthStatus.authenticated) {
              context.go('/');
            }
            return;
          } else {
            final err = state.errorMessage ?? 'Otentikasi kode Google gagal.';
            AppToast.show(context, err, isError: true);
            return;
          }
        }
        return;
      }

      if (mounted) {
        AppToast.show(context, 'Layanan Google Login belum siap di server.', isError: true);
      }
    } catch (e) {
      if (mounted) {
        AppToast.show(context, 'Gagal memproses Google Login: $e', isError: true);
      }
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  void _showServerModal() {
    final controller = TextEditingController(text: _currentServerUrl);
    showAppBottomSheet(
      context: context,
      title: 'Pilih / Atur Alamat Server',
      child: StatefulBuilder(
        builder: (ctx, setModalState) {
          final isDark = Theme.of(context).brightness == Brightness.dark;
          final text = isDark ? AppColors.darkText : AppColors.lightText;
          final textSec = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;
          final accent = isDark ? AppColors.darkAccent : AppColors.lightAccent;
          final border = isDark ? AppColors.darkBorder : AppColors.lightBorder;

          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Pilih alamat koneksi yang paling stabil sesuai jaringan HP saat ini:',
                style: AppTypography.body(textSec, size: AppTypography.textSm),
              ),
              const SizedBox(height: AppSpacing.space3),

              // Pilihan Kandidat URL
              ...StorageService.candidateServerUrls.map((cand) {
                final isSelected = cand == _currentServerUrl;
                String desc = cand;
                if (cand.contains('aujasena')) {
                  desc = 'Cloud Server (https://aujasena.my.id)';
                } else if (cand.contains('127.0.0.1')) {
                  desc = 'Kabel USB / ADB Reverse (http://127.0.0.1:8000)';
                } else if (cand.contains('192.168.1.21')) {
                  desc = 'WiFi LAN Laptop (http://192.168.1.21:8000)';
                }

                return Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.space2),
                  child: InkWell(
                    borderRadius: AppRadius.borderSm,
                    onTap: () async {
                      await StorageService.setServerUrl(cand);
                      ApiClient.reset();
                      if (mounted) {
                        setState(() => _currentServerUrl = cand);
                        AppToast.show(context, 'Alamat server aktif: $cand');
                      }
                      if (ctx.mounted) {
                        Navigator.of(ctx).pop();
                      }
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.space3, vertical: AppSpacing.space2),
                      decoration: BoxDecoration(
                        border: Border.all(
                          color: isSelected ? accent : border,
                          width: isSelected ? 2.0 : 1.0,
                        ),
                        borderRadius: AppRadius.borderSm,
                      ),
                      child: Row(
                        children: [
                          PhosphorIcon(
                            isSelected ? PhosphorIcons.checkCircle(PhosphorIconsStyle.fill) : PhosphorIcons.circle(),
                            size: AppDimensions.iconSizeSm,
                            color: isSelected ? accent : textSec,
                          ),
                          const SizedBox(width: AppSpacing.space2),
                          Expanded(
                            child: Text(
                              desc,
                              style: AppTypography.body(
                                text,
                                size: AppTypography.textXs,
                                weight: isSelected ? FontWeight.w600 : FontWeight.w400,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              }),

              const SizedBox(height: AppSpacing.space3),
              AppInput(
                label: 'Atur Alamat Manual',
                controller: controller,
                hint: 'https://aujasena.my.id',
              ),
              const SizedBox(height: AppSpacing.space4),
              Row(
                children: [
                  Expanded(
                    child: AppButton(
                      label: 'Simpan Alamat Server',
                      onPressed: () async {
                        final val = controller.text.trim();
                        if (val.isNotEmpty) {
                          await StorageService.setServerUrl(val);
                          ApiClient.reset();
                          if (mounted) {
                            setState(() => _currentServerUrl = val);
                            AppToast.show(context, 'Alamat server disimpan: $val');
                          }
                          if (ctx.mounted) {
                            Navigator.of(ctx).pop();
                          }
                        }
                      },
                    ),
                  ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }

  Future<void> _handleBiometricLogin() async {
    try {
      final didAuth = await _localAuth.authenticate(
        localizedReason: 'Pindai sidik jari untuk masuk ke Rumah',
      );
      if (didAuth && mounted) {
        final token = await StorageService.getAccessToken();
        if (token != null && token.isNotEmpty) {
          ref.read(authProvider.notifier).init();
        }
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? AppColors.darkBg : AppColors.lightBg;
    final text = isDark ? AppColors.darkText : AppColors.lightText;
    final textSec = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;
    final accent = isDark ? AppColors.darkAccent : AppColors.lightAccent;
    final border = isDark ? AppColors.darkBorder : AppColors.lightBorder;

    final auth = ref.watch(authProvider);
    final isLoading = _isSubmitting || auth.isLoading;

    return Scaffold(
      backgroundColor: bg,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: AppDimensions.screenMarginAuth),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: AppSpacing.space6),

              // Header Aplikasi: Logo Rumah
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      PhosphorIcon(
                        PhosphorIcons.house(PhosphorIconsStyle.fill),
                        size: AppDimensions.iconSizeMd,
                        color: accent,
                      ),
                      const SizedBox(width: AppSpacing.space2),
                      Text(
                        'Rumah',
                        style: AppTypography.body(
                          text,
                          size: AppTypography.textMd,
                          weight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),

                  // Indikator Server Cepat
                  InkWell(
                    onTap: _showServerModal,
                    borderRadius: AppRadius.borderChip,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: isDark ? AppColors.darkSubtle : AppColors.lightSubtle,
                        borderRadius: AppRadius.borderChip,
                        border: Border.all(color: border, width: 1.0),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 6,
                            height: 6,
                            decoration: const BoxDecoration(
                              color: AppColors.statusOk,
                              shape: BoxShape.circle,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            _currentServerUrl.replaceAll('http://', '').replaceAll('https://', ''),
                            style: AppTypography.mono(textSec, size: 10.0),
                          ),
                          const SizedBox(width: 4),
                          PhosphorIcon(PhosphorIcons.gear(), size: 12, color: textSec),
                        ],
                      ),
                    ),
                  ),
                ],
              ),

              const SizedBox(height: AppSpacing.space6),

              // Tab Segmented Masuk vs Daftar Akun
              Container(
                decoration: BoxDecoration(
                  color: isDark ? AppColors.darkSubtle : AppColors.lightSubtle,
                  borderRadius: AppRadius.borderSm,
                ),
                padding: const EdgeInsets.all(4.0),
                child: Row(
                  children: [
                    Expanded(
                      child: InkWell(
                        onTap: () => setState(() => _mode = 'login'),
                        borderRadius: AppRadius.borderSm,
                        child: Container(
                          padding: const EdgeInsets.symmetric(vertical: 8.0),
                          decoration: BoxDecoration(
                            color: _mode == 'login'
                                ? (isDark ? AppColors.darkSurface : AppColors.lightSurface)
                                : Colors.transparent,
                            borderRadius: AppRadius.borderSm,
                          ),
                          alignment: Alignment.center,
                          child: Text(
                            'Masuk',
                            style: AppTypography.body(
                              _mode == 'login' ? text : textSec,
                              size: AppTypography.textSm,
                              weight: _mode == 'login' ? FontWeight.w600 : FontWeight.w400,
                            ),
                          ),
                        ),
                      ),
                    ),
                    Expanded(
                      child: InkWell(
                        onTap: () => setState(() => _mode = 'register'),
                        borderRadius: AppRadius.borderSm,
                        child: Container(
                          padding: const EdgeInsets.symmetric(vertical: 8.0),
                          decoration: BoxDecoration(
                            color: _mode == 'register'
                                ? (isDark ? AppColors.darkSurface : AppColors.lightSurface)
                                : Colors.transparent,
                            borderRadius: AppRadius.borderSm,
                          ),
                          alignment: Alignment.center,
                          child: Text(
                            'Daftar Akun',
                            style: AppTypography.body(
                              _mode == 'register' ? text : textSec,
                              size: AppTypography.textSm,
                              weight: _mode == 'register' ? FontWeight.w600 : FontWeight.w400,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: AppSpacing.space6),

              // Title
              Text(
                _mode == 'login' ? 'Selamat Datang' : 'Buat Akun Baru',
                style: AppTypography.body(
                  text,
                  size: AppTypography.textXl,
                  weight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: AppSpacing.space1),
              Text(
                _mode == 'login'
                    ? 'Masuk menggunakan email atau username Anda.'
                    : 'Daftar sebagai anggota rumah atau pemilik modul.',
                style: AppTypography.body(textSec, size: AppTypography.textSm),
              ),

              const SizedBox(height: AppDimensions.sectionGap),

              // Form Masuk
              if (_mode == 'login') ...[
                AppInput(
                  hint: 'Nama pengguna atau email',
                  controller: _usernameController,
                ),
                const SizedBox(height: AppDimensions.cardGap),
                AppInput(
                  hint: 'Kata sandi',
                  controller: _passwordController,
                  obscureText: _obscurePassword,
                  suffixIcon: IconButton(
                    icon: PhosphorIcon(
                      _obscurePassword ? PhosphorIcons.eye() : PhosphorIcons.eyeSlash(),
                      size: AppDimensions.iconSizeSm,
                      color: textSec,
                    ),
                    onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
                  ),
                ),
                const SizedBox(height: AppSpacing.space2),
                Text(
                  'Lupa kata sandi? Minta admin keluarga mengatur ulang.',
                  style: AppTypography.body(textSec, size: AppTypography.textXs),
                ),
                const SizedBox(height: AppDimensions.sectionGap),
                AppButton(
                  label: 'Masuk',
                  isLoading: isLoading,
                  onPressed: _handleLogin,
                ),
              ],

              // Form Daftar
              if (_mode == 'register') ...[
                AppInput(
                  hint: 'Nama lengkap (opsional)',
                  controller: _regFullNameController,
                ),
                const SizedBox(height: AppDimensions.cardGap),
                AppInput(
                  hint: 'Nama pengguna (username)',
                  controller: _regUsernameController,
                ),
                const SizedBox(height: AppDimensions.cardGap),
                AppInput(
                  hint: 'Alamat email',
                  controller: _regEmailController,
                  keyboardType: TextInputType.emailAddress,
                ),
                const SizedBox(height: AppDimensions.cardGap),
                AppInput(
                  hint: 'Kata sandi (minimal 6 karakter)',
                  controller: _regPasswordController,
                  obscureText: _obscureRegPassword,
                  suffixIcon: IconButton(
                    icon: PhosphorIcon(
                      _obscureRegPassword ? PhosphorIcons.eye() : PhosphorIcons.eyeSlash(),
                      size: AppDimensions.iconSizeSm,
                      color: textSec,
                    ),
                    onPressed: () => setState(() => _obscureRegPassword = !_obscureRegPassword),
                  ),
                ),
                const SizedBox(height: AppDimensions.cardGap),
                AppInput(
                  hint: 'Kode undangan keluarga (opsional)',
                  controller: _regInviteCodeController,
                ),
                const SizedBox(height: AppDimensions.sectionGap),
                AppButton(
                  label: 'Daftar Akun',
                  isLoading: isLoading,
                  onPressed: _handleRegister,
                ),
              ],

              const SizedBox(height: AppSpacing.space4),

              // Divider "atau"
              Row(
                children: [
                  Expanded(child: Divider(color: border)),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.space3),
                    child: Text('atau', style: AppTypography.body(textSec, size: AppTypography.textXs)),
                  ),
                  Expanded(child: Divider(color: border)),
                ],
              ),

              const SizedBox(height: AppSpacing.space4),

              // Tombol "Lanjutkan dengan Google"
              AppButton(
                label: 'Lanjutkan dengan Google',
                variant: AppButtonVariant.secondary,
                isLoading: isLoading,
                icon: PhosphorIcon(PhosphorIcons.googleLogo(), size: AppDimensions.iconSizeSm),
                onPressed: _handleGoogleLogin,
              ),

              if (_canCheckBiometrics && _mode == 'login') ...[
                const SizedBox(height: AppSpacing.space3),
                AppButton(
                  label: 'Masuk dengan Sidik Jari',
                  variant: AppButtonVariant.secondary,
                  onPressed: _handleBiometricLogin,
                ),
              ],

              const SizedBox(height: AppSpacing.space6),

              // Footer Link Server
              Center(
                child: TextButton.icon(
                  onPressed: _showServerModal,
                  icon: PhosphorIcon(PhosphorIcons.arrowsLeftRight(), size: 14, color: textSec),
                  label: Text(
                    'Ubah Alamat Server ($_currentServerUrl)',
                    style: AppTypography.body(textSec, size: AppTypography.textXs),
                  ),
                ),
              ),

              const SizedBox(height: AppSpacing.space6),
            ],
          ),
        ),
      ),
    );
  }
}
