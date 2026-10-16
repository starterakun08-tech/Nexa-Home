import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:app/components/app_bottom_sheet.dart';
import 'package:app/components/app_button.dart';
import 'package:app/components/app_card.dart';
import 'package:app/components/app_input.dart';
import 'package:app/components/app_toast.dart';
import 'package:app/components/app_top_bar.dart';
import 'package:app/components/empty_state.dart';
import 'package:app/core/api_client.dart';
import 'package:app/theme/tokens.dart';

class ManageMembersScreen extends ConsumerStatefulWidget {
  const ManageMembersScreen({super.key});

  @override
  ConsumerState<ManageMembersScreen> createState() => _ManageMembersScreenState();
}

class _ManageMembersScreenState extends ConsumerState<ManageMembersScreen> {
  bool _isLoading = true;
  List<dynamic> _users = [];

  @override
  void initState() {
    super.initState();
    _fetchUsers();
  }

  Future<void> _fetchUsers() async {
    setState(() => _isLoading = true);
    try {
      final dio = await ApiClient.getInstance();
      final res = await dio.get('/api/auth/users');
      if (res.statusCode == 200 && mounted) {
        setState(() {
          _users = res.data['users'] as List<dynamic>? ?? [];
          _isLoading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _openAddMemberSheet() {
    final usernameCtrl = TextEditingController();
    final passwordCtrl = TextEditingController();
    String selectedRole = 'member';

    showAppBottomSheet(
      context: context,
      title: 'Tambah Anggota Keluarga',
      child: StatefulBuilder(
        builder: (ctx, setSheetState) {
          final isDark = Theme.of(ctx).brightness == Brightness.dark;
          final subtle = isDark ? AppColors.darkSubtle : AppColors.lightSubtle;
          final text = isDark ? AppColors.darkText : AppColors.lightText;
          final textSec = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;

          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AppInput(
                label: 'Nama Pengguna',
                controller: usernameCtrl,
                hint: 'misal: ibu, anak',
              ),
              const SizedBox(height: AppSpacing.space3),
              AppInput(
                label: 'Kata Sandi Sementara',
                controller: passwordCtrl,
                obscureText: true,
                hint: 'minimal 8 karakter',
              ),
              const SizedBox(height: AppSpacing.space3),
              Text(
                'Peran Akses',
                style: AppTypography.body(textSec, size: AppTypography.textXs, weight: FontWeight.w600),
              ),
              const SizedBox(height: AppSpacing.space2),
              Row(
                children: [
                  _buildRoleRadio('admin', 'Pengelola', selectedRole, subtle, text, (val) {
                    setSheetState(() => selectedRole = val);
                  }),
                  const SizedBox(width: AppSpacing.space3),
                  _buildRoleRadio('member', 'Anggota', selectedRole, subtle, text, (val) {
                    setSheetState(() => selectedRole = val);
                  }),
                  const SizedBox(width: AppSpacing.space3),
                  _buildRoleRadio('child', 'Anak', selectedRole, subtle, text, (val) {
                    setSheetState(() => selectedRole = val);
                  }),
                ],
              ),
              const SizedBox(height: AppDimensions.sectionGap),
              AppButton(
                label: 'Buat Akun Anggota',
                onPressed: () async {
                  final uname = usernameCtrl.text.trim();
                  final pass = passwordCtrl.text;
                  if (uname.isEmpty || pass.length < 6) {
                    AppToast.show(context, 'Nama pengguna dan sandi minimal 6 karakter.', isError: true);
                    return;
                  }

                  Navigator.of(ctx).pop();
                  try {
                    final dio = await ApiClient.getInstance();
                    await dio.post('/api/auth/users', data: {
                      'username': uname,
                      'password': pass,
                      'role': selectedRole,
                    });
                    if (mounted) {
                      AppToast.show(context, 'Akun "$uname" berhasil dibuat.');
                      _fetchUsers();
                    }
                  } catch (_) {
                    if (mounted) {
                      AppToast.show(context, 'Gagal membuat akun anggota.', isError: true);
                    }
                  }
                },
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildRoleRadio(
    String roleVal,
    String label,
    String currentRole,
    Color subtle,
    Color text,
    ValueChanged<String> onSelect,
  ) {
    final isSelected = currentRole == roleVal;
    return Expanded(
      child: InkWell(
        onTap: () => onSelect(roleVal),
        borderRadius: AppRadius.borderChip,
        child: Container(
          height: 36,
          decoration: BoxDecoration(
            color: isSelected ? AppColors.lightAccentLight : subtle,
            borderRadius: AppRadius.borderChip,
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: AppTypography.body(
              isSelected ? AppColors.lightAccent : text,
              size: AppTypography.textXs,
              weight: isSelected ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? AppColors.darkBg : AppColors.lightBg;
    final text = isDark ? AppColors.darkText : AppColors.lightText;
    final textSec = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;
    final accent = isDark ? AppColors.darkAccent : AppColors.lightAccent;
    final subtle = isDark ? AppColors.darkSubtle : AppColors.lightSubtle;

    return Scaffold(
      backgroundColor: bg,
      appBar: AppTopBar(
        title: 'Kelola Anggota',
        actions: [
          IconButton(
            tooltip: 'Tambah Anggota',
            icon: PhosphorIcon(PhosphorIcons.plus(), size: AppDimensions.iconSizeSm, color: text),
            onPressed: _openAddMemberSheet,
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: _isLoading
                  ? const Center(child: CircularProgressIndicator())
                  : _users.isEmpty
                      ? const Center(
                          child: EmptyState(
                            icon: Icon(Icons.group_outlined, size: 48),
                            title: 'Belum ada anggota',
                            description: 'Tekan tombol "+" untuk menambahkan akun anggota keluarga.',
                          ),
                        )
                      : RefreshIndicator(
                          onRefresh: _fetchUsers,
                          color: accent,
                          child: ListView(
                            padding: const EdgeInsets.symmetric(horizontal: AppDimensions.screenMargin),
                            children: [
                              const SizedBox(height: AppSpacing.space2),

                              // Kartu Jumlah Anggota
                              AppCard(
                                padding: const EdgeInsets.all(AppSpacing.space4),
                                child: Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          '${_users.length} Anggota Terdaftar',
                                          style: AppTypography.body(text, size: AppTypography.textSm, weight: FontWeight.w600),
                                        ),
                                        const SizedBox(height: 2),
                                        Text(
                                          'Akses kontrol perangkat dan notifikasi sesuai hak.',
                                          style: AppTypography.body(textSec, size: AppTypography.textXs),
                                        ),
                                      ],
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: isDark ? AppColors.darkAccentLight : AppColors.lightAccentLight,
                                        borderRadius: AppRadius.borderChip,
                                      ),
                                      child: Text(
                                        'Lokal Aktif',
                                        style: AppTypography.body(accent, size: 11, weight: FontWeight.w600),
                                      ),
                                    ),
                                  ],
                                ),
                              ),

                              const SizedBox(height: AppDimensions.sectionGap),

                              // Daftar Anggota
                              AppCard(
                                padding: EdgeInsets.zero,
                                child: Column(
                                  children: _users.asMap().entries.map((entry) {
                                    final idx = entry.key;
                                    final user = entry.value;
                                    final isLast = idx == _users.length - 1;

                                    final uname = user['username']?.toString() ?? 'Pengguna';
                                    final role = user['role']?.toString() ?? 'member';
                                    final initial = uname.isNotEmpty ? uname[0].toUpperCase() : 'U';

                                    String roleLabel = 'Anggota';
                                    if (role.toLowerCase() == 'admin' || role.toLowerCase() == 'pemilik') roleLabel = 'Pengelola';
                                    if (role.toLowerCase() == 'child') roleLabel = 'Anak';

                                    return Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: AppSpacing.space4,
                                        vertical: AppSpacing.space3,
                                      ),
                                      decoration: !isLast
                                          ? BoxDecoration(
                                              border: Border(
                                                bottom: BorderSide(
                                                  color: isDark ? AppColors.darkBorder : AppColors.lightBorder,
                                                  width: AppDimensions.borderWidth,
                                                ),
                                              ),
                                            )
                                          : null,
                                      child: Row(
                                        children: [
                                          CircleAvatar(
                                            radius: 20,
                                            backgroundColor: subtle,
                                            child: Text(
                                              initial,
                                              style: AppTypography.body(text, size: AppTypography.textSm, weight: FontWeight.w600),
                                            ),
                                          ),
                                          const SizedBox(width: AppSpacing.space3),
                                          Expanded(
                                            child: Column(
                                              crossAxisAlignment: CrossAxisAlignment.start,
                                              children: [
                                                Text(
                                                  uname,
                                                  style: AppTypography.body(text, size: AppTypography.textSm, weight: FontWeight.w600),
                                                ),
                                                const SizedBox(height: 2),
                                                Text(
                                                  roleLabel,
                                                  style: AppTypography.body(textSec, size: AppTypography.textXs),
                                                ),
                                              ],
                                            ),
                                          ),
                                          Container(
                                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                            decoration: BoxDecoration(
                                              color: subtle,
                                              borderRadius: AppRadius.borderChip, // radius 8
                                            ),
                                            child: Text(
                                              roleLabel,
                                              style: AppTypography.body(
                                                text,
                                                size: 11,
                                                weight: FontWeight.w600,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    );
                                  }).toList(),
                                ),
                              ),

                              const SizedBox(height: AppSpacing.space6),
                            ],
                          ),
                        ),
            ),

            // Tombol Tambah Anggota di Bawah
            Padding(
              padding: const EdgeInsets.all(AppDimensions.screenMargin),
              child: AppButton(
                label: 'Tambah Anggota',
                icon: PhosphorIcon(PhosphorIcons.userPlus(), size: AppDimensions.iconSizeSm, color: AppColors.lightSurface),
                onPressed: _openAddMemberSheet,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
