import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:app/components/app_bottom_sheet.dart';
import 'package:app/components/app_button.dart';
import 'package:app/components/app_card.dart';
import 'package:app/components/app_switch.dart';
import 'package:app/components/app_toast.dart';
import 'package:app/components/app_top_bar.dart';
import 'package:app/core/api_client.dart';
import 'package:app/theme/tokens.dart';

class DeviceDetailScreen extends ConsumerStatefulWidget {
  final String deviceId;

  const DeviceDetailScreen({super.key, required this.deviceId});

  @override
  ConsumerState<DeviceDetailScreen> createState() => _DeviceDetailScreenState();
}

class _DeviceDetailScreenState extends ConsumerState<DeviceDetailScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _device;
  bool _isOn = false;
  bool _isOnline = false;

  @override
  void initState() {
    super.initState();
    _fetchDetail();
  }

  Future<void> _fetchDetail() async {
    setState(() => _isLoading = true);
    try {
      final dio = await ApiClient.getInstance();
      final res = await dio.get('/api/devices');
      if (res.statusCode == 200 && mounted) {
        final list = res.data['devices'] as List<dynamic>? ?? [];
        final found = list.firstWhere(
          (d) => d['id'] == widget.deviceId,
          orElse: () => null,
        );
        if (found != null) {
          final channels = found['channels'] as List<dynamic>? ?? [];
          bool on = false;
          for (final c in channels) {
            final val = c['current_value']?.toString() ?? 'false';
            if (val.toLowerCase() == 'true' || val == '1') {
              on = true;
              break;
            }
          }
          setState(() {
            _device = found as Map<String, dynamic>;
            _isOnline = found['is_online'] == true;
            _isOn = on;
            _isLoading = false;
          });
        } else {
          setState(() => _isLoading = false);
        }
      }
    } catch (_) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _toggleState() async {
    final nextVal = !_isOn;
    setState(() => _isOn = nextVal);

    try {
      final dio = await ApiClient.getInstance();
      final channels = _device?['channels'] as List<dynamic>? ?? [];
      for (final c in channels) {
        final type = c['channel_type']?.toString();
        if (type == 'switch' || type == 'relay') {
          await dio.post('/api/devices/${widget.deviceId}/cmd', data: {
            'channel': c['channel_key'],
            'action': 'set',
            'value': nextVal,
          });
        }
      }
    } catch (_) {
      if (mounted) setState(() => _isOn = !nextVal);
    }
  }

  void _confirmDelete() {
    final isOnline = _isOnline;
    final devName = _device?['name'] ?? widget.deviceId;
    showAppBottomSheet(
      context: context,
      title: 'Putuskan Sambungan Perangkat?',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            isOnline
                ? 'Perangkat "$devName" akan direset ke pengaturan pabrik dan dapat dihubungkan ke akun lain. Tindakan ini memerlukan persetujuan Pengelola.'
                : 'Perangkat sedang offline. Sambungan akun akan diputus sekarang, tetapi Anda harus menahan tombol fisik di perangkat selama 10 detik sebelum dapat menghubungkannya ke akun baru. Tindakan ini memerlukan persetujuan Pengelola.',
            style: AppTypography.body(
              Theme.of(context).brightness == Brightness.dark
                  ? AppColors.darkTextSecondary
                  : AppColors.lightTextSecondary,
              size: AppTypography.textSm,
            ),
          ),
          const SizedBox(height: AppSpacing.space6),
          Row(
            children: [
              Expanded(
                child: AppButton(
                  label: 'Batal',
                  variant: AppButtonVariant.secondary,
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ),
              const SizedBox(width: AppSpacing.space3),
              Expanded(
                child: AppButton(
                  label: 'Putuskan & Reset',
                  variant: AppButtonVariant.danger,
                  onPressed: () async {
                    Navigator.of(context).pop();
                    try {
                      final dio = await ApiClient.getInstance();
                      await dio.post('/api/devices/${widget.deviceId}/unbind');
                      if (mounted) {
                        AppToast.show(context, 'Perangkat berhasil diputuskan & direset ke mode awal.');
                        Navigator.of(context).pop();
                      }
                    } catch (_) {
                      if (mounted) {
                        AppToast.show(context, 'Gagal memutuskan perangkat.', isError: true);
                      }
                    }
                  },
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? AppColors.darkBg : AppColors.lightBg;
    final text = isDark ? AppColors.darkText : AppColors.lightText;
    final textSec = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;
    final subtle = isDark ? AppColors.darkSubtle : AppColors.lightSubtle;
    final accent = isDark ? AppColors.darkAccent : AppColors.lightAccent;

    final devName = _device?['name']?.toString() ?? widget.deviceId;
    final roomName = _device?['room']?.toString() ?? 'Ruangan';
    final ipAddress = _device?['ip_address']?.toString() ?? '—';

    return Scaffold(
      backgroundColor: bg,
      appBar: AppTopBar(
        title: devName,
        actions: [
          IconButton(
            tooltip: 'Menu',
            icon: PhosphorIcon(
              PhosphorIcons.dotsThreeVertical(),
              size: AppDimensions.iconSizeSm,
              color: text,
            ),
            onPressed: () {},
          ),
        ],
      ),
      body: SafeArea(
        child: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: AppDimensions.screenMargin),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    const SizedBox(height: AppSpacing.space6),

                    // Big Phosphor Icon circle (perbaikan teks "lightbulb" di Stitch)
                    Container(
                      width: 80.0,
                      height: 80.0,
                      decoration: BoxDecoration(
                        color: _isOn && _isOnline
                            ? (isDark ? AppColors.darkAccentLight : AppColors.lightAccentLight)
                            : subtle,
                        shape: BoxShape.circle,
                      ),
                      alignment: Alignment.center,
                      child: PhosphorIcon(
                        PhosphorIcons.lightbulb(),
                        size: 40.0,
                        color: _isOn && _isOnline ? accent : textSec,
                      ),
                    ),

                    const SizedBox(height: AppSpacing.space3),

                    // Device Title 24/600
                    Text(
                      devName,
                      style: AppTypography.body(
                        text,
                        size: AppTypography.textLg, // 24px
                        weight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2.0),
                    Text(
                      roomName,
                      style: AppTypography.body(
                        textSec,
                        size: AppTypography.textSm,
                      ),
                    ),

                    const SizedBox(height: AppSpacing.space4),

                    // Big Toggle Pill 56x32 with thumb 26
                    AppSwitch(
                      value: _isOn,
                      onChanged: _isOnline ? (_) => _toggleState() : null,
                      semanticLabel: 'Saklar $devName',
                    ),

                    const SizedBox(height: AppDimensions.sectionGap),

                    // Kartu Info Perangkat
                    AppCard(
                      padding: const EdgeInsets.all(AppSpacing.space4),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              PhosphorIcon(
                                PhosphorIcons.info(),
                                size: AppDimensions.iconSizeSm,
                                color: text,
                              ),
                              const SizedBox(width: AppSpacing.space2),
                              Text(
                                'Info Perangkat',
                                style: AppTypography.body(
                                  text,
                                  size: AppTypography.textSm,
                                  weight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.space4),

                          // ID Perangkat (mono)
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text('ID perangkat', style: AppTypography.body(textSec, size: AppTypography.textSm)),
                              const SizedBox(width: AppSpacing.space2),
                              Flexible(
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(color: subtle, borderRadius: AppRadius.borderChip),
                                  child: Text(
                                    widget.deviceId,
                                    style: AppTypography.mono(text, size: AppTypography.textXs),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.space3),
                          Divider(color: isDark ? AppColors.darkBorder : AppColors.lightBorder),
                          const SizedBox(height: AppSpacing.space3),

                          // Tipe Perangkat
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text('Tipe perangkat', style: AppTypography.body(textSec, size: AppTypography.textSm)),
                              const SizedBox(width: AppSpacing.space2),
                              Flexible(
                                child: Text(
                                  (_device?['device_type'] ?? 'ESP32 IoT').toString().toUpperCase(),
                                  style: AppTypography.mono(text, size: AppTypography.textSm),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.space3),
                          Divider(color: isDark ? AppColors.darkBorder : AppColors.lightBorder),
                          const SizedBox(height: AppSpacing.space3),

                          // Status Koneksi LWT
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text('Status koneksi', style: AppTypography.body(textSec, size: AppTypography.textSm)),
                              const SizedBox(width: AppSpacing.space2),
                              Flexible(
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Container(
                                      width: 8.0,
                                      height: 8.0,
                                      decoration: BoxDecoration(
                                        color: _isOnline ? AppColors.statusOk : AppColors.statusDanger,
                                        shape: BoxShape.circle,
                                      ),
                                    ),
                                    const SizedBox(width: 6.0),
                                    Flexible(
                                      child: Text(
                                        _isOnline ? 'LWT: Terhubung (Online)' : 'LWT: Terputus (Offline)',
                                        style: AppTypography.mono(
                                          _isOnline ? AppColors.statusOk : AppColors.statusDanger,
                                          size: AppTypography.textXs,
                                        ),
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: AppSpacing.space3),
                          Divider(color: isDark ? AppColors.darkBorder : AppColors.lightBorder),
                          const SizedBox(height: AppSpacing.space3),

                          // IP Lokal
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text('IP lokal', style: AppTypography.body(textSec, size: AppTypography.textSm)),
                              const SizedBox(width: AppSpacing.space2),
                              Flexible(
                                child: Text(
                                  ipAddress,
                                  style: AppTypography.mono(text, size: AppTypography.textSm),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),

                    Builder(
                      builder: (ctx) {
                        final auth = ref.watch(authProvider);
                        final isManager = auth.role?.toLowerCase() == 'admin' || auth.role?.toLowerCase() == 'pemilik';
                        if (!isManager) return const SizedBox.shrink();

                        return Column(
                          children: [
                            // Tombol Putuskan / Reset Perangkat (Hanya Pengelola)
                            AppButton(
                              label: 'Putuskan Sambungan',
                              variant: AppButtonVariant.danger,
                              icon: PhosphorIcon(PhosphorIcons.power()),
                              isFullWidth: true,
                              onPressed: _confirmDelete,
                            ),
                            const SizedBox(height: AppSpacing.space6),
                          ],
                        );
                      },
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}
