import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:app/components/app_badge.dart';
import 'package:app/components/app_button.dart';
import 'package:app/components/app_card.dart';
import 'package:app/components/app_input.dart';
import 'package:app/components/app_toast.dart';
import 'package:app/core/api_client.dart';
import 'package:app/core/auth_state.dart';
import 'package:app/theme/tokens.dart';

class SetupWizardScreen extends ConsumerStatefulWidget {
  const SetupWizardScreen({super.key});

  @override
  ConsumerState<SetupWizardScreen> createState() => _SetupWizardScreenState();
}

class _SetupWizardScreenState extends ConsumerState<SetupWizardScreen> {
  final _codeController = TextEditingController();
  final _usernameController = TextEditingController(text: 'admin');
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  bool _isSuccess = false;
  String? _totpSecret;
  List<String> _recoveryCodes = [];

  Future<void> _handleSetup() async {
    final code = _codeController.text.trim();
    final username = _usernameController.text.trim();
    final password = _passwordController.text;
    final confirm = _confirmPasswordController.text;

    if (code.isEmpty || username.isEmpty || password.isEmpty) {
      AppToast.show(context, 'Semua kolom wajib diisi.', isError: true);
      return;
    }

    if (password.length < 8) {
      AppToast.show(context, 'Kata sandi minimal 8 karakter.', isError: true);
      return;
    }

    if (password != confirm) {
      AppToast.show(context, 'Konfirmasi kata sandi tidak cocok.', isError: true);
      return;
    }

    try {
      final dio = await ApiClient.getInstance();
      final res = await dio.post(
        '/api/auth/setup-admin',
        data: {
          'setup_code': code,
          'username': username,
          'password': password,
        },
      );

      if (res.statusCode == 201) {
        final data = res.data;
        setState(() {
          _isSuccess = true;
          _totpSecret = data['totp_secret'] as String?;
          _recoveryCodes = List<String>.from(data['recovery_codes'] as List? ?? []);
        });
      }
    } on DioException catch (e) {
      String msg = 'Gagal melakukan setup Pengelola.';
      if (e.response?.data != null) {
        msg = e.response!.data['detail']?.toString() ?? msg;
      }
      if (mounted) {
        AppToast.show(context, msg, isError: true);
      }
    } catch (_) {
      if (mounted) {
        AppToast.show(context, 'Terjadi kesalahan sistem.', isError: true);
      }
    }
  }

  @override
  void dispose() {
    _codeController.dispose();
    _usernameController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final text = isDark ? AppColors.darkText : AppColors.lightText;
    final textSec = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Setup Admin Pertama'),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.space4),
          child: _isSuccess ? _buildSuccessView(text, textSec) : _buildFormView(text, textSec),
        ),
      ),
    );
  }

  Widget _buildFormView(Color text, Color textSec) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(
                    PhosphorIcons.shieldCheck(),
                    size: AppDimensions.iconSizeSm,
                    color: AppColors.statusWarn,
                  ),
                  const SizedBox(width: AppSpacing.space2),
                  Text(
                    'Inisialisasi Sistem',
                    style: AppTypography.body(
                      text,
                      size: AppTypography.textMd,
                      weight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.space2),
              Text(
                'Belum ada akun Pengelola di server ini. Masukkan kode setup sekali pakai yang tercetak di konsol server terminal.',
                style: AppTypography.body(textSec, size: AppTypography.textSm),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.space4),
        AppInput(
          label: 'Kode Setup Sekali Pakai',
          hint: 'Contoh: RUMAH-A8F2K9',
          controller: _codeController,
          prefixIcon: Icon(
            PhosphorIcons.key(),
            size: AppDimensions.iconSizeSm,
            color: textSec,
          ),
        ),
        const SizedBox(height: AppSpacing.space3),
        AppInput(
          label: 'Nama Pengguna Admin',
          hint: 'admin',
          controller: _usernameController,
          prefixIcon: Icon(
            PhosphorIcons.user(),
            size: AppDimensions.iconSizeSm,
            color: textSec,
          ),
        ),
        const SizedBox(height: AppSpacing.space3),
        AppInput(
          label: 'Kata Sandi',
          hint: 'Minimal 8 karakter',
          obscureText: true,
          controller: _passwordController,
          prefixIcon: Icon(
            PhosphorIcons.lock(),
            size: AppDimensions.iconSizeSm,
            color: textSec,
          ),
        ),
        const SizedBox(height: AppSpacing.space3),
        AppInput(
          label: 'Konfirmasi Kata Sandi',
          hint: 'Ulangi kata sandi',
          obscureText: true,
          controller: _confirmPasswordController,
          prefixIcon: Icon(
            PhosphorIcons.lockKey(),
            size: AppDimensions.iconSizeSm,
            color: textSec,
          ),
        ),
        const SizedBox(height: AppSpacing.space6),
        AppButton(
          label: 'Inisialisasi Akun Admin',
          onPressed: _handleSetup,
          icon: Icon(
            PhosphorIcons.check(),
            size: AppDimensions.iconSizeSm,
            color: AppColors.lightSurface,
          ),
        ),
      ],
    );
  }

  Widget _buildSuccessView(Color text, Color textSec) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const AppBadge(
                label: 'ADMIN DIBUAT',
                variant: AppBadgeVariant.ok,
              ),
              const SizedBox(height: AppSpacing.space3),
              Text(
                'Simpan Rahasia 2FA & Kode Pemulihan',
                style: AppTypography.body(
                  text,
                  size: AppTypography.textMd,
                  weight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: AppSpacing.space2),
              Text(
                'Akun Pengelola wajib menggunakan 2FA. Masukkan secret di bawah ke Google Authenticator atau aplikasi TOTP Anda:',
                style: AppTypography.body(textSec, size: AppTypography.textSm),
              ),
              const SizedBox(height: AppSpacing.space3),
              Container(
                padding: const EdgeInsets.all(AppSpacing.space3),
                decoration: BoxDecoration(
                  color: Theme.of(context).brightness == Brightness.dark
                      ? AppColors.darkSubtle
                      : AppColors.lightSubtle,
                  borderRadius: AppRadius.borderSm,
                ),
                child: SelectableText(
                  _totpSecret ?? '-',
                  style: AppTypography.mono(
                    text,
                    size: AppTypography.textSm,
                    weight: FontWeight.w600,
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.space4),
              Text(
                '8 Kode Pemulihan Cadangan (Simpan di tempat aman):',
                style: AppTypography.body(
                  text,
                  size: AppTypography.textSm,
                  weight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: AppSpacing.space2),
              Wrap(
                spacing: AppSpacing.space2,
                runSpacing: AppSpacing.space2,
                children: _recoveryCodes.map((c) {
                  return AppBadge(label: c, variant: AppBadgeVariant.neutral);
                }).toList(),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.space6),
        AppButton(
          label: 'Lanjut ke Halaman Login',
          onPressed: () {
            ref.read(authProvider.notifier).init();
            context.go('/login');
          },
        ),
      ],
    );
  }
}
