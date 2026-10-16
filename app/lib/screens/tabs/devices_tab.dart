import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:app/components/app_badge.dart';
import 'package:app/components/app_button.dart';
import 'package:app/components/app_card.dart';
import 'package:app/components/app_switch.dart';
import 'package:app/components/app_toast.dart';
import 'package:app/components/empty_state.dart';
import 'package:app/core/api_client.dart';
import 'package:app/screens/add_device_screen.dart';
import 'package:app/screens/device_detail_screen.dart';
import 'package:app/theme/tokens.dart';

class DevicesTab extends ConsumerStatefulWidget {
  const DevicesTab({super.key});

  @override
  ConsumerState<DevicesTab> createState() => _DevicesTabState();
}

class _DevicesTabState extends ConsumerState<DevicesTab> {
  bool _isLoading = true;
  List<dynamic> _devices = [];
  Timer? _refreshTimer;

  // Cache riwayat telemetri untuk sparkline mini per device
  final Map<String, List<double>> _telemetryHistory = {};

  @override
  void initState() {
    super.initState();
    _fetchDevices();
    _refreshTimer = Timer.periodic(const Duration(seconds: 4), (_) => _fetchDevices(silent: true));
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _fetchDevices({bool silent = false}) async {
    if (!silent) setState(() => _isLoading = true);

    try {
      final dio = await ApiClient.getInstance();
      final res = await dio.get('/api/devices');
      if (res.statusCode == 200 && mounted) {
        final list = res.data['devices'] as List<dynamic>? ?? [];
        setState(() {
          _devices = list;
          _isLoading = false;
        });

        // Update riwayat telemetri untuk tiap sensor
        for (final d in list) {
          final devId = d['id'] as String;
          _fetchSensorHistory(devId);
        }
      }
    } catch (_) {
      if (mounted && !silent) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _fetchSensorHistory(String deviceId) async {
    try {
      final dio = await ApiClient.getInstance();
      final res = await dio.get('/api/devices/$deviceId/telemetry', queryParameters: {'limit': 10});
      if (res.statusCode == 200 && mounted) {
        final logs = res.data['telemetry'] as List<dynamic>? ?? [];
        final vals = logs.map((l) => (l['value'] as num).toDouble()).toList();
        setState(() {
          _telemetryHistory[deviceId] = vals;
        });
      }
    } catch (_) {}
  }

  Future<void> _toggleChannel(String deviceId, String channelKey, bool currentVal) async {
    final newVal = !currentVal;

    // Optimistic update
    setState(() {
      for (final d in _devices) {
        if (d['id'] == deviceId) {
          final channels = d['channels'] as List<dynamic>? ?? [];
          for (final c in channels) {
            if (c['channel_key'] == channelKey) {
              c['current_value'] = newVal.toString();
            }
          }
        }
      }
    });

    try {
      final dio = await ApiClient.getInstance();
      await dio.post('/api/devices/$deviceId/cmd', data: {
        'channel': channelKey,
        'action': 'set',
        'value': newVal,
      });
    } catch (_) {
      // Revert if error
      if (mounted) {
        setState(() {
          for (final d in _devices) {
            if (d['id'] == deviceId) {
              final channels = d['channels'] as List<dynamic>? ?? [];
              for (final c in channels) {
                if (c['channel_key'] == channelKey) {
                  c['current_value'] = currentVal.toString();
                }
              }
            }
          }
        });
        AppToast.show(context, 'Gagal mengubah status saklar.', isError: true);
      }
    }
  }

  void _confirmUnbind(Map<String, dynamic> dev) {
    final devId = dev['id'].toString();
    final name = dev['name']?.toString() ?? devId;
    final isOnline = dev['is_online'] == true;
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final text = isDark ? AppColors.darkText : AppColors.lightText;
    final textSec = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: isDark ? AppColors.darkSurface : AppColors.lightSurface,
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.borderCard),
        title: Text(
          'Putuskan Sambungan Perangkat?',
          style: AppTypography.body(text, weight: FontWeight.w700, size: AppTypography.textMd),
        ),
        content: Text(
          isOnline
              ? 'Perangkat "$name" akan direset ke pengaturan pabrik dan dapat dihubungkan ke akun lain. Tindakan ini memerlukan persetujuan Pengelola.'
              : 'Perangkat sedang offline. Sambungan akun akan diputus sekarang, tetapi Anda harus menahan tombol fisik di perangkat selama 10 detik sebelum dapat menghubungkannya ke akun baru. Tindakan ini memerlukan persetujuan Pengelola.',
          style: AppTypography.body(textSec, size: AppTypography.textSm),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: Text('Batal', style: AppTypography.body(textSec, size: AppTypography.textSm)),
          ),
          AppButton(
            label: 'Putuskan & Reset',
            variant: AppButtonVariant.danger,
            isFullWidth: false,
            onPressed: () async {
              Navigator.of(ctx).pop();
              try {
                final dio = await ApiClient.getInstance();
                await dio.post('/api/devices/$devId/unbind');
                if (mounted) {
                  AppToast.show(context, 'Perangkat "$name" berhasil diputuskan.');
                  _fetchDevices();
                }
              } catch (_) {
                if (mounted) {
                  AppToast.show(context, 'Gagal memutuskan perangkat.', isError: true);
                }
              }
            },
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

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            PhosphorIcon(PhosphorIcons.cpu(), size: AppDimensions.iconSizeSm, color: text),
            const SizedBox(width: AppSpacing.space2),
            const Text('Perangkat'),
          ],
        ),
        actions: [
          IconButton(
            icon: PhosphorIcon(PhosphorIcons.plus(), size: AppDimensions.iconSizeSm, color: text),
            tooltip: 'Hubungkan Perangkat',
            onPressed: () async {
              final created = await Navigator.of(context).push<bool>(
                MaterialPageRoute(builder: (_) => const AddDeviceScreen()),
              );
              if (created == true) _fetchDevices();
            },
          ),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          color: isDark ? AppColors.darkAccent : AppColors.lightAccent,
          backgroundColor: isDark ? AppColors.darkSurface : AppColors.lightSurface,
          onRefresh: () => _fetchDevices(),
          child: _isLoading && _devices.isEmpty
              ? const Center(child: CircularProgressIndicator())
              : _devices.isEmpty
                  ? _buildEmptyState(isDark)
                  : ListView.separated(
                      padding: const EdgeInsets.all(AppSpacing.space4),
                      itemCount: _devices.length,
                      separatorBuilder: (ctx, i) => const SizedBox(height: AppSpacing.space4),
                      itemBuilder: (context, index) {
                        final dev = _devices[index] as Map<String, dynamic>;
                        return _buildDeviceCard(dev, text, textSec, isDark);
                      },
                    ),
        ),
      ),
    );
  }

  Widget _buildEmptyState(bool isDark) {
    return ListView(
      children: [
        SizedBox(height: MediaQuery.of(context).size.height * 0.15),
        EmptyState(
          icon: PhosphorIcon(
            PhosphorIcons.plugsConnected(),
            size: AppDimensions.iconSizeMd * 2,
            color: isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary,
          ),
          title: 'Belum Ada Perangkat',
          description: 'Hubungkan modul ESP32 Anda menggunakan Kode Pairing 6-digit atau scan QR.',
          action: AppButton(
            label: 'Hubungkan Perangkat',
            icon: PhosphorIcon(PhosphorIcons.plus(), size: AppDimensions.iconSizeSm),
            onPressed: () async {
              final created = await Navigator.of(context).push<bool>(
                MaterialPageRoute(builder: (_) => const AddDeviceScreen()),
              );
              if (created == true) _fetchDevices();
            },
          ),
        ),
      ],
    );
  }

  Widget _buildDeviceCard(Map<String, dynamic> dev, Color text, Color textSec, bool isDark) {
    final auth = ref.watch(authProvider);
    final isManager = auth.role?.toLowerCase() == 'admin' || auth.role?.toLowerCase() == 'pemilik';
    final devId = dev['id'] as String;
    final name = dev['name'] as String? ?? devId;
    final room = dev['room'] as String? ?? 'Umum';
    final isOnline = dev['is_online'] as bool? ?? false;
    final channels = dev['channels'] as List<dynamic>? ?? [];

    final switchChannels = channels.where((c) {
      final t = c['channel_type'] as String;
      return t == 'switch' || t == 'relay' || t == 'buzzer';
    }).toList();

    final sensorChannels = channels.where((c) {
      final t = c['channel_type'] as String;
      return t == 'gas_sensor' || t == 'light_sensor';
    }).toList();

    final history = _telemetryHistory[devId] ?? [];

    return AppCard(
      onTap: () {
        Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => DeviceDetailScreen(deviceId: devId)),
        );
      },
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header Perangkat
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      style: AppTypography.body(text, weight: FontWeight.w600, size: AppTypography.textMd),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: AppSpacing.space1),
                    Row(
                      children: [
                        PhosphorIcon(PhosphorIcons.house(), size: AppDimensions.iconSizeSm, color: textSec),
                        const SizedBox(width: AppSpacing.space1),
                        Text(room, style: AppTypography.body(textSec, size: AppTypography.textXs)),
                        const SizedBox(width: AppSpacing.space2),
                        Text('•', style: AppTypography.body(textSec, size: AppTypography.textXs)),
                        const SizedBox(width: AppSpacing.space2),
                        Flexible(
                          child: Text(
                            devId,
                            style: AppTypography.mono(textSec, size: AppTypography.textXs),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.space2),
              AppBadge(
                label: isOnline ? 'ONLINE' : 'OFFLINE',
                variant: isOnline ? AppBadgeVariant.ok : AppBadgeVariant.danger,
              ),
            ],
          ),

          // Kanal Saklar / Relay
          if (switchChannels.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.space4),
            Divider(color: isDark ? AppColors.darkBorder : AppColors.lightBorder),
            const SizedBox(height: AppSpacing.space2),
            ...switchChannels.map((c) {
              final chKey = c['channel_key'] as String;
              final chName = c['alias'] as String? ?? c['name'] as String;
              final currentValStr = c['current_value']?.toString().toLowerCase() ?? 'false';
              final isOn = currentValStr == 'true' || currentValStr == '1';

              return Padding(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.space2),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        PhosphorIcon(
                          chKey.contains('relay') || chKey.contains('fan')
                              ? PhosphorIcons.fan()
                              : chKey.contains('buzzer')
                                  ? PhosphorIcons.bellRinging()
                                  : PhosphorIcons.lightbulb(),
                          size: AppDimensions.iconSizeSm,
                          color: isOn ? (isDark ? AppColors.darkAccent : AppColors.lightAccent) : textSec,
                        ),
                        const SizedBox(width: AppSpacing.space2),
                        Text(
                          chName,
                          style: AppTypography.body(text, weight: FontWeight.w500, size: AppTypography.textSm),
                        ),
                      ],
                    ),
                    AppSwitch(
                      value: isOn,
                      onChanged: isOnline
                          ? (_) => _toggleChannel(devId, chKey, isOn)
                          : null,
                    ),
                  ],
                ),
              );
            }),
          ],

          // Kanal Sensor & Grafik Riwayat
          if (sensorChannels.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.space2),
            Divider(color: isDark ? AppColors.darkBorder : AppColors.lightBorder),
            const SizedBox(height: AppSpacing.space2),
            ...sensorChannels.map((s) {
              final sKey = s['channel_key'] as String;
              final sName = s['alias'] as String? ?? s['name'] as String;
              final valStr = s['current_value']?.toString() ?? '0';
              final isGas = sKey.contains('mq2') || sKey.contains('gas');
              final numVal = double.tryParse(valStr) ?? 0.0;
              final isDanger = isGas && numVal >= 1500;

              return Padding(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.space2),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        PhosphorIcon(
                          isGas ? PhosphorIcons.warning() : PhosphorIcons.sun(),
                          size: AppDimensions.iconSizeSm,
                          color: isDanger ? AppColors.statusDanger : textSec,
                        ),
                        const SizedBox(width: AppSpacing.space2),
                        Text(
                          sName,
                          style: AppTypography.body(text, size: AppTypography.textSm),
                        ),
                      ],
                    ),
                    Row(
                      children: [
                        if (isDanger) ...[
                          const AppBadge(label: 'BAHAYA GAS', variant: AppBadgeVariant.danger),
                          const SizedBox(width: AppSpacing.space2),
                        ],
                        Text(
                          isGas ? '$valStr PPM' : (numVal < 500 ? 'GELAP ($valStr)' : 'TERANG ($valStr)'),
                          style: AppTypography.mono(
                            isDanger ? AppColors.statusDanger : text,
                            weight: FontWeight.w600,
                            size: AppTypography.textSm,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              );
            }),

            // Grafik Sparkline Riwayat
            if (history.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.space3),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Riwayat Sensor (10 Titik Terakhir):',
                    style: AppTypography.body(textSec, size: AppTypography.textXs),
                  ),
                  Text(
                    '${history.last.toStringAsFixed(0)} raw',
                    style: AppTypography.mono(textSec, size: AppTypography.textXs),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.space2),
              _buildSimpleSparkline(history, isDark),
            ],
          ],

          const SizedBox(height: AppSpacing.space3),
          Divider(color: isDark ? AppColors.darkBorder : AppColors.lightBorder),
          const SizedBox(height: AppSpacing.space2),

          // Tombol Aksi Bawah: Detail & Putuskan / Reset
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              TextButton.icon(
                onPressed: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => DeviceDetailScreen(deviceId: devId)),
                  );
                },
                icon: PhosphorIcon(PhosphorIcons.arrowSquareOut(), size: AppDimensions.iconSizeSm),
                label: Text(
                  'Detail Lengkap',
                  style: AppTypography.body(
                    isDark ? AppColors.darkAccent : AppColors.lightAccent,
                    size: AppTypography.textXs,
                    weight: FontWeight.w600,
                  ),
                ),
              ),
              if (isManager)
                TextButton.icon(
                  onPressed: () => _confirmUnbind(dev),
                  icon: PhosphorIcon(PhosphorIcons.trash(), size: AppDimensions.iconSizeSm, color: AppColors.statusDanger),
                  label: Text(
                    'Putuskan & Reset',
                    style: AppTypography.body(
                      AppColors.statusDanger,
                      size: AppTypography.textXs,
                      weight: FontWeight.w600,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSimpleSparkline(List<double> values, bool isDark) {
    if (values.isEmpty) return const SizedBox.shrink();

    final maxVal = values.reduce((a, b) => a > b ? a : b);
    final minVal = values.reduce((a, b) => a < b ? a : b);
    final range = (maxVal - minVal) == 0 ? 1.0 : (maxVal - minVal);

    return Container(
      height: AppDimensions.controlHeight,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.space2,
        vertical: AppSpacing.space1,
      ),
      decoration: BoxDecoration(
        color: isDark ? AppColors.darkSurface : AppColors.lightSurface,
        borderRadius: AppRadius.borderSm,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: values.map((val) {
          final normalized = ((val - minVal) / range).clamp(0.15, 1.0);
          final isHigh = val >= 1500;
          final barColor = isHigh
              ? AppColors.statusDanger
              : (isDark ? AppColors.darkAccent : AppColors.lightAccent);

          return Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.space1 / 2),
              child: Container(
                height: (AppDimensions.controlHeight - AppSpacing.space2) * normalized,
                decoration: BoxDecoration(
                  color: barColor,
                  borderRadius: AppRadius.borderSm,
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}
