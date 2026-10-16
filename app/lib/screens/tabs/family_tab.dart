import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:app/components/app_badge.dart';
import 'package:app/components/app_button.dart';
import 'package:app/components/app_card.dart';
import 'package:app/components/app_switch.dart';
import 'package:app/components/app_toast.dart';
import 'package:app/core/api_client.dart';
import 'package:app/core/auth_state.dart';
import 'package:app/theme/tokens.dart';

class FamilyTab extends ConsumerStatefulWidget {
  const FamilyTab({super.key});

  @override
  ConsumerState<FamilyTab> createState() => _FamilyTabState();
}

class _FamilyTabState extends ConsumerState<FamilyTab> {
  bool _isLoading = true;
  Map<String, dynamic>? _transparency;
  Map<String, dynamic>? _settings;
  Map<String, dynamic>? _summaryToday;
  List<dynamic> _summaryWeek = [];
  List<dynamic> _events = [];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);
    final role = ref.read(authProvider).role;
    final isAdmin = role == 'admin';

    try {
      final dio = await ApiClient.getInstance();

      // Transparency is available to all authenticated users
      final transRes = await dio.get('/api/family/transparency');
      if (transRes.statusCode == 200 && mounted) {
        _transparency = transRes.data as Map<String, dynamic>;
      }

      if (isAdmin) {
        final results = await Future.wait([
          dio.get('/api/family/settings'),
          dio.get('/api/family/summary?range=today'),
          dio.get('/api/family/summary?range=week'),
          dio.get('/api/family/events?limit=20'),
        ]);

        if (mounted) {
          if (results[0].statusCode == 200) {
            _settings = results[0].data['settings'] as Map<String, dynamic>?;
          }
          if (results[1].statusCode == 200) {
            _summaryToday = results[1].data['data'] as Map<String, dynamic>?;
          }
          if (results[2].statusCode == 200) {
            _summaryWeek = results[2].data['history'] as List<dynamic>? ?? [];
          }
          if (results[3].statusCode == 200) {
            _events = results[3].data['events'] as List<dynamic>? ?? [];
          }
        }
      }
    } catch (e) {
      // ignore
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _updateSetting(String key, dynamic value) async {
    if (_settings == null) return;
    setState(() {
      _settings![key] = value;
    });

    try {
      final dio = await ApiClient.getInstance();
      await dio.put('/api/family/settings', data: {key: value});
      if (mounted) {
        AppToast.show(context, 'Pengaturan disimpan');
      }
      _loadData();
    } catch (e) {
      if (mounted) {
        AppToast.show(context, 'Gagal menyimpan pengaturan');
      }
      _loadData();
    }
  }

  Future<void> _reviewEvent(String eventId) async {
    try {
      final dio = await ApiClient.getInstance();
      await dio.put('/api/family/events/$eventId/review', data: {});
      setState(() {
        _events = _events.map((ev) {
          if (ev['id'] == eventId) {
            final copy = Map<String, dynamic>.from(ev);
            copy['is_reviewed'] = true;
            return copy;
          }
          return ev;
        }).toList();
      });
      if (mounted) {
        AppToast.show(context, 'Peringatan ditandai telah dilihat');
      }
    } catch (_) {
      if (mounted) {
        AppToast.show(context, 'Gagal memperbarui status');
      }
    }
  }

  Future<void> _clearAllData() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Hapus Semua Data Keluarga?'),
        content: const Text(
          'Tindakan ini akan menghapus permanen semua catatan kejadian, statistik harian, dan ringkasan aktivitas keluarga. Pengaturan fitur tidak akan terhapus.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Batal'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(foregroundColor: AppColors.statusDanger),
            child: const Text('Ya, Hapus Semua'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      final dio = await ApiClient.getInstance();
      await dio.delete('/api/family/data?confirm=true');
      if (mounted) {
        AppToast.show(context, 'Seluruh data analitik keluarga berhasil dihapus');
      }
      _loadData();
    } catch (e) {
      if (mounted) {
        AppToast.show(context, 'Gagal menghapus data keluarga');
      }
    }
  }

  void _showTransparencySheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.transparent,
      builder: (ctx) {
        final isDark = Theme.of(ctx).brightness == Brightness.dark;
        final bg = isDark ? AppColors.darkSurface : AppColors.lightSurface;
        final text = isDark ? AppColors.darkText : AppColors.lightText;
        final textSec = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;

        final activeFeatures = _transparency?['active_features'] as Map<String, dynamic>? ?? {};
        final cameras = _transparency?['monitored_cameras'] as List<dynamic>? ?? [];
        final zones = _transparency?['monitored_zones'] as List<dynamic>? ?? [];

        return DraggableScrollableSheet(
          initialChildSize: 0.7,
          minChildSize: 0.4,
          maxChildSize: 0.9,
          builder: (_, controller) => Container(
            decoration: BoxDecoration(
              color: bg,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
            ),
            padding: const EdgeInsets.all(AppSpacing.space4),
            child: ListView(
              controller: controller,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Apa yang Dipantau',
                      style: AppTypography.body(text, size: AppTypography.textLg, weight: FontWeight.w700),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () => Navigator.pop(ctx),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.space2),
                Text(
                  'Daftar fitur sensor dan zona kamera yang aktif di sistem rumah tanpa mengidentifikasi wajah atau orang tertentu.',
                  style: AppTypography.body(textSec, size: AppTypography.textSm),
                ),
                const SizedBox(height: AppSpacing.space4),
                Text(
                  'Fitur Aktif',
                  style: AppTypography.body(text, size: AppTypography.textMd, weight: FontWeight.w600),
                ),
                const SizedBox(height: AppSpacing.space2),
                _buildTransparencyRow('Aktivitas di Zona Belajar', activeFeatures['study_zone_monitoring'] == true, text, textSec),
                _buildTransparencyRow('Aktivitas Larut Malam', activeFeatures['late_night_activity_monitoring'] == true, text, textSec),
                _buildTransparencyRow('Peringatan Kemungkinan Jatuh', activeFeatures['fall_detection_monitoring'] == true, text, textSec),
                _buildTransparencyRow('Peringatan Zona Berbahaya', activeFeatures['hazard_zone_monitoring'] == true, text, textSec),
                _buildTransparencyRow('Deteksi Diam Lama', activeFeatures['inactivity_monitoring'] == true, text, textSec),
                _buildTransparencyRow('Integrasi Asisten', activeFeatures['assistant_integration'] == true, text, textSec),
                const SizedBox(height: AppSpacing.space4),
                Text(
                  'Kamera Ruang Umum (${cameras.length})',
                  style: AppTypography.body(text, size: AppTypography.textMd, weight: FontWeight.w600),
                ),
                const SizedBox(height: AppSpacing.space2),
                if (cameras.isEmpty)
                  Text('Tidak ada kamera aktif.', style: AppTypography.body(textSec, size: AppTypography.textSm))
                else
                  ...cameras.map((c) => Padding(
                        padding: const EdgeInsets.symmetric(vertical: AppSpacing.space1),
                        child: Text('• ${c["name"] ?? c["id"]} (Ruang: ${c["room_id"] ?? "-"})',
                            style: AppTypography.body(textSec, size: AppTypography.textSm)),
                      )),
                const SizedBox(height: AppSpacing.space4),
                Text(
                  'Zona Terdaftar (${zones.length})',
                  style: AppTypography.body(text, size: AppTypography.textMd, weight: FontWeight.w600),
                ),
                const SizedBox(height: AppSpacing.space2),
                if (zones.isEmpty)
                  Text('Belum ada zona yang digambar.', style: AppTypography.body(textSec, size: AppTypography.textSm))
                else
                  ...zones.map((z) => Padding(
                        padding: const EdgeInsets.symmetric(vertical: AppSpacing.space1),
                        child: Text('• ${z["name"]} [Tipe: ${z["zone_type"]}]',
                            style: AppTypography.body(textSec, size: AppTypography.textSm)),
                      )),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildTransparencyRow(String label, bool isActive, Color text, Color textSec) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.space1),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: AppTypography.body(text, size: AppTypography.textSm)),
          AppBadge(
            label: isActive ? 'Aktif' : 'Mati',
            variant: isActive ? AppBadgeVariant.ok : AppBadgeVariant.neutral,
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final text = isDark ? AppColors.darkText : AppColors.lightText;
    final textSec = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;
    final auth = ref.watch(authProvider);
    final isAdmin = auth.role == 'admin';
    final isWorkerOffline = _transparency?['ai_worker_status'] == 'offline';

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            Icon(
              PhosphorIcons.users(),
              size: AppDimensions.iconSizeSm,
              color: text,
            ),
            const SizedBox(width: AppSpacing.space2),
            Text(isAdmin ? 'Wawasan Keluarga' : 'Pantauan Ruang'),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Apa yang dipantau',
            icon: Icon(PhosphorIcons.info(), color: text),
            onPressed: _showTransparencySheet,
          ),
        ],
      ),
      body: SafeArea(
        child: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : SingleChildScrollView(
                padding: const EdgeInsets.all(AppSpacing.space4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Status Badge & Title
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          isAdmin ? 'Wawasan Ruang Umum' : 'Transparansi Ruang',
                          style: AppTypography.body(text, size: AppTypography.textLg, weight: FontWeight.w700),
                        ),
                        AppBadge(
                          label: isWorkerOffline ? 'AI Tidak Aktif' : 'AI Aktif',
                          variant: isWorkerOffline ? AppBadgeVariant.danger : AppBadgeVariant.ok,
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.space2),
                    Text(
                      'Statistik aktivitas berbasis sensor tanpa pengenalan wajah.',
                      style: AppTypography.body(textSec, size: AppTypography.textSm),
                    ),
                    const SizedBox(height: AppSpacing.space3),

                    // Non-Medical Disclaimer Banner
                    AppCard(
                      padding: const EdgeInsets.all(AppSpacing.space3),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(PhosphorIcons.shieldCheck(), size: AppDimensions.iconSizeSm, color: AppColors.statusOk),
                          const SizedBox(width: AppSpacing.space3),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Bukan alat medis. Hanya angka dan kejadian dari kamera ruang umum, tanpa menyimpan video.',
                                  style: AppTypography.body(text, size: AppTypography.textSm, weight: FontWeight.w600),
                                ),
                                const SizedBox(height: AppSpacing.space1),
                                Text(
                                  isAdmin
                                      ? 'Pengaturan deteksi dan saklar privasi dapat dikontrol penuh oleh Pengelola.'
                                      : 'Data analitik tersimpan hanya dapat dilihat oleh Pengelola rumah.',
                                  style: AppTypography.body(textSec, size: AppTypography.textXs),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: AppSpacing.space4),

                    if (!isAdmin) ...[
                      // Non-admin view: Transparency Card
                      AppCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Fitur Pemantauan Aktif',
                              style: AppTypography.body(text, size: AppTypography.textMd, weight: FontWeight.w600),
                            ),
                            const SizedBox(height: AppSpacing.space2),
                            Text(
                              'Anggota keluarga dapat memeriksa fitur dan kamera apa saja yang sedang memantau ruang umum.',
                              style: AppTypography.body(textSec, size: AppTypography.textSm),
                            ),
                            const SizedBox(height: AppSpacing.space3),
                            AppButton(
                              label: 'Lihat Detail Apa yang Dipantau',
                              variant: AppButtonVariant.secondary,
                              onPressed: _showTransparencySheet,
                            ),
                          ],
                        ),
                      ),
                    ] else ...[
                      // Admin view: Feature Controls
                      Text(
                        'Kontrol Fitur & Saklar',
                        style: AppTypography.body(text, size: AppTypography.textMd, weight: FontWeight.w600),
                      ),
                      const SizedBox(height: AppSpacing.space2),

                      _buildFeatureCard(
                        title: 'Master Saklar Analitik',
                        description: 'Aktifkan seluruh pemrosesan analitik keluarga.',
                        value: _settings?['enabled'] == true,
                        onChanged: (v) => _updateSetting('enabled', v),
                        text: text,
                        textSec: textSec,
                      ),
                      _buildFeatureCard(
                        title: 'Aktivitas di Zona Belajar',
                        description: 'Hitung durasi duduk di meja belajar.',
                        value: _settings?['study_zone_enabled'] == true,
                        onChanged: (v) => _updateSetting('study_zone_enabled', v),
                        text: text,
                        textSec: textSec,
                      ),
                      _buildFeatureCard(
                        title: 'Aktivitas Larut Malam',
                        description: 'Peringatan aktivitas di ruang umum (23:00 - 04:30).',
                        value: _settings?['late_night_enabled'] == true,
                        onChanged: (v) => _updateSetting('late_night_enabled', v),
                        text: text,
                        textSec: textSec,
                      ),
                      _buildFeatureCard(
                        title: 'Peringatan Kemungkinan Jatuh',
                        description: 'Deteksi postur berbaring tanpa gerak >= 30 detik.',
                        value: _settings?['fall_detection_enabled'] == true,
                        onChanged: (v) => _updateSetting('fall_detection_enabled', v),
                        text: text,
                        textSec: textSec,
                      ),
                      _buildFeatureCard(
                        title: 'Tidak Bergerak Lama',
                        description: 'Peringatan lembut jika posisi hampir tetap >= 120 menit.',
                        value: _settings?['inactivity_enabled'] == true,
                        onChanged: (v) => _updateSetting('inactivity_enabled', v),
                        text: text,
                        textSec: textSec,
                      ),
                      _buildFeatureCard(
                        title: 'Orang di Zona Berbahaya',
                        description: 'Peringatan saat sensor gas aktif atau jam terlarang.',
                        value: _settings?['hazard_zone_enabled'] == true,
                        onChanged: (v) => _updateSetting('hazard_zone_enabled', v),
                        text: text,
                        textSec: textSec,
                      ),
                      _buildFeatureCard(
                        title: 'Izinkan Asisten Membaca Ringkasan',
                        description: 'Hanya angka agregat tanpa nama dan jam individual.',
                        value: _settings?['allow_assistant_family_summary'] == true,
                        onChanged: (v) => _updateSetting('allow_assistant_family_summary', v),
                        text: text,
                        textSec: textSec,
                      ),

                      const SizedBox(height: AppSpacing.space4),

                      // Weekly Activity Metrics
                      Text(
                        'Ringkasan Aktivitas (7 Hari)',
                        style: AppTypography.body(text, size: AppTypography.textMd, weight: FontWeight.w600),
                      ),
                      const SizedBox(height: AppSpacing.space2),
                      AppCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (_summaryToday != null) ...[
                              Text(
                                _summaryToday!['summary_text']?.toString() ?? '',
                                style: AppTypography.body(text, size: AppTypography.textSm, weight: FontWeight.w500),
                              ),
                              const SizedBox(height: AppSpacing.space3),
                            ],
                            // Bar chart representation using simple Containers
                            if (_summaryWeek.isEmpty)
                              Text('Belum ada data riwayat mingguan.', style: AppTypography.body(textSec, size: AppTypography.textSm))
                            else
                              SizedBox(
                                height: 80,
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                                  children: _summaryWeek.map((day) {
                                    final mins = (day['study_minutes'] as num? ?? 0).toDouble();
                                    final maxMins = 240.0; // scale against 4 hours
                                    final heightPct = (mins / maxMins).clamp(0.08, 1.0);
                                    final dateStr = day['date']?.toString().split('-').last ?? '';

                                    return Column(
                                      mainAxisAlignment: MainAxisAlignment.end,
                                      children: [
                                        Container(
                                          width: 20,
                                          height: 50 * heightPct,
                                          decoration: BoxDecoration(
                                            color: isDark ? AppColors.darkAccent : AppColors.lightAccent,
                                            borderRadius: AppRadius.borderSm,
                                          ),
                                        ),
                                        const SizedBox(height: 4),
                                        Text(dateStr, style: AppTypography.mono(textSec, size: AppTypography.textXs)),
                                      ],
                                    );
                                  }).toList(),
                                ),
                              ),
                          ],
                        ),
                      ),

                      const SizedBox(height: AppSpacing.space4),

                      // Recent Events & Alerts
                      Text(
                        'Daftar Peringatan & Kejadian',
                        style: AppTypography.body(text, size: AppTypography.textMd, weight: FontWeight.w600),
                      ),
                      const SizedBox(height: AppSpacing.space2),

                      if (isWorkerOffline)
                        AppCard(
                          child: Row(
                            children: [
                              Icon(PhosphorIcons.warning(), size: AppDimensions.iconSizeSm, color: AppColors.statusDanger),
                              const SizedBox(width: AppSpacing.space2),
                              Expanded(
                                child: Text(
                                  'AI tidak aktif. Kamera dan sensor tidak memproses kejadian saat ini.',
                                  style: AppTypography.body(AppColors.statusDanger, size: AppTypography.textSm),
                                ),
                              ),
                            ],
                          ),
                        )
                      else if (_events.isEmpty)
                        AppCard(
                          child: Text(
                            'Belum ada kejadian tercatat.',
                            style: AppTypography.body(textSec, size: AppTypography.textSm),
                          ),
                        )
                      else
                        ..._events.map((ev) {
                          final isReviewed = ev['is_reviewed'] == true;
                          final sev = ev['severity']?.toString() ?? 'info';
                          AppBadgeVariant badgeVar = AppBadgeVariant.neutral;
                          if (sev == 'critical') badgeVar = AppBadgeVariant.danger;
                          if (sev == 'warning') badgeVar = AppBadgeVariant.warn;

                          return Padding(
                            padding: const EdgeInsets.only(bottom: AppSpacing.space2),
                            child: AppCard(
                              padding: const EdgeInsets.all(AppSpacing.space3),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Expanded(
                                        child: Text(
                                          ev['title']?.toString() ?? 'Peringatan',
                                          style: AppTypography.body(text, size: AppTypography.textSm, weight: FontWeight.w600),
                                        ),
                                      ),
                                      AppBadge(label: sev.toUpperCase(), variant: badgeVar),
                                    ],
                                  ),
                                  const SizedBox(height: AppSpacing.space1),
                                  Text(
                                    ev['description']?.toString() ?? '',
                                    style: AppTypography.body(textSec, size: AppTypography.textXs),
                                  ),
                                  const SizedBox(height: AppSpacing.space2),
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Text(
                                        ev['created_at']?.toString().split('T').last.substring(0, 5) ?? '',
                                        style: AppTypography.mono(textSec, size: AppTypography.textXs),
                                      ),
                                      if (!isReviewed)
                                        SizedBox(
                                          height: 28,
                                          child: TextButton.icon(
                                            style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 8)),
                                            icon: const Icon(Icons.check, size: 14),
                                            label: Text('Tandai Dilihat', style: AppTypography.body(AppColors.lightAccent, size: AppTypography.textXs)),
                                            onPressed: () => _reviewEvent(ev['id'].toString()),
                                          ),
                                        )
                                      else
                                        Text('Sudah ditinjau', style: AppTypography.body(textSec, size: AppTypography.textXs)),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        }),

                      const SizedBox(height: AppSpacing.space4),

                      // Clear All Data Button
                      AppButton(
                        label: 'Hapus Semua Data Keluarga',
                        variant: AppButtonVariant.danger,
                        icon: const Icon(Icons.delete_outline, size: 18),
                        onPressed: _clearAllData,
                      ),
                      const SizedBox(height: AppSpacing.space4),
                    ],
                  ],
                ),
              ),
      ),
    );
  }

  Widget _buildFeatureCard({
    required String title,
    required String description,
    required bool value,
    required ValueChanged<bool> onChanged,
    required Color text,
    required Color textSec,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.space2),
      child: AppCard(
        padding: const EdgeInsets.all(AppSpacing.space3),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: AppTypography.body(text, size: AppTypography.textSm, weight: FontWeight.w600)),
                  const SizedBox(height: 2),
                  Text(description, style: AppTypography.body(textSec, size: AppTypography.textXs)),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.space3),
            AppSwitch(value: value, onChanged: onChanged),
          ],
        ),
      ),
    );
  }
}
