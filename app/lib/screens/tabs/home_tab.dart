import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:app/components/app_badge.dart';
import 'package:app/components/app_button.dart';
import 'package:app/components/app_card.dart';
import 'package:app/components/danger_banner.dart';
import 'package:app/components/device_tile.dart';
import 'package:app/components/empty_state.dart';
import 'package:app/core/api_client.dart';
import 'package:app/screens/add_device_screen.dart';
import 'package:app/screens/device_detail_screen.dart';
import 'package:app/screens/notifications_screen.dart';
import 'package:app/theme/tokens.dart';

class HomeTab extends ConsumerStatefulWidget {
  final bool forceDanger; // Untuk keperluan testing / golden preview Layar 4

  const HomeTab({super.key, this.forceDanger = false});

  @override
  ConsumerState<HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends ConsumerState<HomeTab> {
  bool _isLoading = true;
  List<dynamic> _devices = [];
  List<dynamic> _recentEvents = [];
  Timer? _refreshTimer;

  // Real-time metric states
  int? _gasValue;
  final int _gasThreshold = 1500;
  bool _isGasAlert = false;
  String _gasRoom = 'Dapur';
  int? _lightRawValue;

  int _activeActuators = 0;
  final int _totalActuators = 4;
  int _activeCamerasCount = 0;
  bool _hasOnlineDevice = false;

  final List<Map<String, dynamic>> _switchChannels = [];

  @override
  void initState() {
    super.initState();
    if (widget.forceDanger) {
      _isGasAlert = true;
      _gasValue = 1820;
    }
    _loadData();
    _refreshTimer = Timer.periodic(const Duration(seconds: 4), (_) => _loadData(silent: true));
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadData({bool silent = false}) async {
    if (!silent) setState(() => _isLoading = true);

    try {
      final dio = await ApiClient.getInstance();

      // 1. Ambil data perangkat
      final devRes = await dio.get('/api/devices');
      if (devRes.statusCode == 200 && mounted) {
        final list = devRes.data['devices'] as List<dynamic>? ?? [];
        _devices = list;
        final onlineDevs = list.where((d) => d['is_online'] == true).toList();
        _hasOnlineDevice = onlineDevs.isNotEmpty;

        _switchChannels.clear();
        _activeActuators = 0;
        int? resolvedGas;
        int? resolvedLight;

        if (_hasOnlineDevice) {
          // Hanya 4 saklar fisik hardware yang didukung (GPIO 21, 17, 16, 32)
          final physicalKeys = {'lamp_tengah', 'lamp_dapur_tamu', 'lamp_kamar', 'relay', 'relay_fan'};
          final seenKeys = <String>{};

          for (final d in onlineDevs) {
            final channels = d['channels'] as List<dynamic>? ?? [];
            for (final c in channels) {
              final key = c['channel_key']?.toString() ?? '';
              final type = c['channel_type']?.toString() ?? '';
              final val = c['current_value'];

              if (physicalKeys.contains(key)) {
                final normalizedKey = (key == 'relay_fan') ? 'relay' : key;
                if (!seenKeys.contains(normalizedKey)) {
                  seenKeys.add(normalizedKey);
                  final isOn = val?.toString().toLowerCase() == 'true' || val?.toString() == '1';
                  if (isOn) _activeActuators++;
                  _switchChannels.add({
                    'device': d,
                    'channel': c,
                  });
                }
              } else if (type == 'gas_sensor' || key == 'mq2') {
                if (val != null && val.toString().isNotEmpty) {
                  final parsed = double.tryParse(val.toString())?.round();
                  if (parsed != null) {
                    resolvedGas = parsed;
                    _gasRoom = d['room']?.toString() ?? 'Dapur';
                  }
                }
              } else if (type == 'light_sensor' || key == 'ldr') {
                if (val != null && val.toString().isNotEmpty) {
                  final parsed = double.tryParse(val.toString())?.round();
                  if (parsed != null) {
                    resolvedLight = parsed;
                  }
                }
              }
            }
          }
        }

        if (!widget.forceDanger) {
          _gasValue = resolvedGas;
          _isGasAlert = (_gasValue != null && _gasValue! >= _gasThreshold);
        }
        _lightRawValue = resolvedLight;
      }

      // 2. Ambil data kamera
      try {
        final camRes = await dio.get('/api/cameras');
        if (camRes.statusCode == 200 && mounted) {
          final cams = camRes.data as List<dynamic>? ?? [];
          _activeCamerasCount = cams.where((c) => c['status'] == 'online' && c['privacy_mode'] != true).length;
        }
      } catch (_) {}

      // 3. Ambil aktivitas audit logs
      try {
        final auditRes = await dio.get('/api/audit-logs', queryParameters: {'limit': 5});
        if (auditRes.statusCode == 200 && mounted) {
          _recentEvents = auditRes.data['logs'] as List<dynamic>? ?? [];
        }
      } catch (_) {
        try {
          final auditRes2 = await dio.get('/api/audit/logs', queryParameters: {'limit': 5});
          if (auditRes2.statusCode == 200 && mounted) {
            _recentEvents = auditRes2.data['logs'] as List<dynamic>? ?? [];
          }
        } catch (_) {}
      }

      if (mounted) setState(() => _isLoading = false);
    } catch (_) {
      if (mounted && !silent) setState(() => _isLoading = false);
    }
  }

  Future<void> _toggleDevice(Map<String, dynamic> device, Map<String, dynamic> channel) async {
    final devId = device['id'] as String;
    final chKey = channel['channel_key'] as String;
    final currentStr = channel['current_value']?.toString() ?? 'false';
    final currentBool = currentStr.toLowerCase() == 'true' || currentStr == '1';
    final nextVal = !currentBool;

    // Optimistic UI update
    setState(() {
      channel['current_value'] = nextVal.toString();
      if (nextVal) {
        _activeActuators++;
      } else {
        if (_activeActuators > 0) _activeActuators--;
      }
    });

    try {
      final dio = await ApiClient.getInstance();
      await dio.post('/api/devices/$devId/cmd', data: {
        'channel': chKey,
        'action': 'set',
        'value': nextVal,
      });
    } catch (_) {
      // Revert if error
      if (mounted) {
        setState(() {
          channel['current_value'] = currentBool.toString();
          if (currentBool) {
            _activeActuators++;
          } else {
            if (_activeActuators > 0) _activeActuators--;
          }
        });
      }
    }
  }

  Future<void> _turnOffAllDevices() async {
    try {
      final dio = await ApiClient.getInstance();
      for (final item in _switchChannels) {
        final dev = item['device'] as Map<String, dynamic>;
        final ch = item['channel'] as Map<String, dynamic>;
        final val = ch['current_value']?.toString().toLowerCase() ?? 'false';
        if (val == 'true' || val == '1') {
          await dio.post('/api/devices/${dev['id']}/cmd', data: {
            'channel': ch['channel_key'],
            'action': 'set',
            'value': false,
          });
        }
      }
      _loadData(silent: true);
    } catch (_) {}
  }

  Future<void> _openAddDevice() async {
    final res = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => const AddDeviceScreen()),
    );
    if (res == true && mounted) {
      _loadData();
    }
  }

  Future<void> _triggerAlarm(bool turnOn) async {
    try {
      final dio = await ApiClient.getInstance();
      for (final d in _devices) {
        final channels = d['channels'] as List<dynamic>? ?? [];
        for (final c in channels) {
          if (c['channel_type'] == 'buzzer' || c['channel_key'] == 'buzzer') {
            await dio.post('/api/devices/${d['id']}/cmd', data: {
              'channel': c['channel_key'],
              'action': 'set',
              'value': turnOn,
            });
          }
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
    final subtle = isDark ? AppColors.darkSubtle : AppColors.lightSubtle;
    final accent = isDark ? AppColors.darkAccent : AppColors.lightAccent;

    return Scaffold(
      backgroundColor: bg,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () => _loadData(),
          color: accent,
          backgroundColor: isDark ? AppColors.darkSurface : AppColors.lightSurface,
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.symmetric(horizontal: AppDimensions.screenMargin),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: AppSpacing.space3),

                // Top Bar: Beranda Title + Notifikasi & Tambah Perangkat
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(
                      child: Text(
                        'Beranda',
                        style: AppTypography.body(
                          text,
                          size: AppTypography.textXl, // 32px
                          weight: FontWeight.w600,
                        ),
                      ),
                    ),
                    Row(
                      children: [
                        IconButton(
                          tooltip: 'Notifikasi',
                          icon: PhosphorIcon(
                            PhosphorIcons.bell(),
                            size: AppDimensions.iconSizeMd,
                            color: text,
                          ),
                          onPressed: () {
                            Navigator.push(
                              context,
                              MaterialPageRoute(builder: (_) => const NotificationsScreen()),
                            );
                          },
                        ),
                        const SizedBox(width: AppSpacing.space1),
                        InkWell(
                          onTap: _openAddDevice,
                          borderRadius: const BorderRadius.all(Radius.circular(AppRadius.tile)),
                          child: Container(
                            width: 40.0,
                            height: 40.0,
                            decoration: BoxDecoration(
                              color: subtle,
                              shape: BoxShape.circle,
                            ),
                            alignment: Alignment.center,
                            child: PhosphorIcon(
                              PhosphorIcons.plus(),
                              size: AppDimensions.iconSizeSm,
                              color: text,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),

                const SizedBox(height: AppSpacing.space4),

                // Banner Bahaya Gas jika kondisi gas >= ambang batas
                if (_isGasAlert && _gasValue != null) ...[
                  DangerBanner(
                    title: 'Gas terdeteksi di $_gasRoom',
                    currentValue: _gasValue!,
                    threshold: _gasThreshold,
                    onTriggerAlarm: () => _triggerAlarm(true),
                    onMuteAlarm: () => _triggerAlarm(false),
                  ),
                  const SizedBox(height: AppSpacing.space3),
                ],

                // 4 Summary Cards (Sama Persis seperti Web BerandaPage)
                GridView.count(
                  crossAxisCount: 2,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  crossAxisSpacing: AppDimensions.cardGap,
                  mainAxisSpacing: AppDimensions.cardGap,
                  childAspectRatio: 1.25,
                  children: [
                    // Card 1: Perangkat Menyala
                    AppCard(
                      padding: const EdgeInsets.all(AppSpacing.space3),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text(
                                  'Perangkat menyala',
                                  style: AppTypography.body(textSec, size: AppTypography.textXs),
                                  overflow: TextOverflow.ellipsis,
                                  maxLines: 1,
                                ),
                              ),
                              const SizedBox(width: AppSpacing.space1),
                              PhosphorIcon(PhosphorIcons.power(), size: AppDimensions.iconSizeSm, color: textSec),
                            ],
                          ),
                          Text(
                            _hasOnlineDevice ? '$_activeActuators dari $_totalActuators' : '—',
                            style: AppTypography.mono(
                              text,
                              size: AppTypography.textMd,
                              weight: FontWeight.w600,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          AppBadge(
                            label: _hasOnlineDevice
                                ? (_activeActuators > 0 ? 'Aktif' : 'Semua Mati')
                                : 'Tidak terhubung',
                            variant: _hasOnlineDevice
                                ? (_activeActuators > 0 ? AppBadgeVariant.ok : AppBadgeVariant.neutral)
                                : AppBadgeVariant.neutral,
                          ),
                        ],
                      ),
                    ),

                    // Card 2: Sensor Gas
                    AppCard(
                      padding: const EdgeInsets.all(AppSpacing.space3),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text(
                                  'Sensor gas',
                                  style: AppTypography.body(textSec, size: AppTypography.textXs),
                                  overflow: TextOverflow.ellipsis,
                                  maxLines: 1,
                                ),
                              ),
                              const SizedBox(width: AppSpacing.space1),
                              PhosphorIcon(PhosphorIcons.flame(), size: AppDimensions.iconSizeSm, color: textSec),
                            ],
                          ),
                          Text(
                            !_hasOnlineDevice
                                ? '—'
                                : (_gasValue == null
                                    ? 'Kalibrasi...'
                                    : 'Gas $_gasValue (ambang $_gasThreshold)'),
                            style: AppTypography.mono(
                              text,
                              size: AppTypography.textXs,
                              weight: FontWeight.w600,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          AppBadge(
                            label: !_hasOnlineDevice
                                ? 'Tidak terhubung'
                                : (_gasValue == null
                                    ? 'Kalibrasi'
                                    : (_gasValue! >= _gasThreshold
                                        ? 'Bahaya'
                                        : (_gasValue! >= _gasThreshold * 0.7 ? 'Waspada' : 'Aman'))),
                            variant: !_hasOnlineDevice
                                ? AppBadgeVariant.neutral
                                : (_gasValue == null
                                    ? AppBadgeVariant.warn
                                    : (_gasValue! >= _gasThreshold
                                        ? AppBadgeVariant.danger
                                        : (_gasValue! >= _gasThreshold * 0.7 ? AppBadgeVariant.warn : AppBadgeVariant.ok))),
                          ),
                        ],
                      ),
                    ),

                    // Card 3: Cahaya Ruangan
                    AppCard(
                      padding: const EdgeInsets.all(AppSpacing.space3),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text(
                                  'Cahaya ruangan',
                                  style: AppTypography.body(textSec, size: AppTypography.textXs),
                                  overflow: TextOverflow.ellipsis,
                                  maxLines: 1,
                                ),
                              ),
                              const SizedBox(width: AppSpacing.space1),
                              PhosphorIcon(PhosphorIcons.sun(), size: AppDimensions.iconSizeSm, color: textSec),
                            ],
                          ),
                          Text(
                            !_hasOnlineDevice
                                ? '—'
                                : (_lightRawValue == null
                                    ? 'Kalibrasi...'
                                    : '${_lightRawValue! < 500 ? "Gelap" : "Terang"} · $_lightRawValue'),
                            style: AppTypography.mono(
                              text,
                              size: AppTypography.textSm,
                              weight: FontWeight.w600,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          AppBadge(
                            label: !_hasOnlineDevice
                                ? 'Tidak terhubung'
                                : (_lightRawValue == null
                                    ? 'Kalibrasi'
                                    : (_lightRawValue! < 500 ? 'Malam' : 'Siang')),
                            variant: !_hasOnlineDevice ? AppBadgeVariant.neutral : AppBadgeVariant.ok,
                          ),
                        ],
                      ),
                    ),

                    // Card 4: Kamera Aktif
                    AppCard(
                      padding: const EdgeInsets.all(AppSpacing.space3),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Expanded(
                                child: Text(
                                  'Kamera aktif',
                                  style: AppTypography.body(textSec, size: AppTypography.textXs),
                                  overflow: TextOverflow.ellipsis,
                                  maxLines: 1,
                                ),
                              ),
                              const SizedBox(width: AppSpacing.space1),
                              PhosphorIcon(PhosphorIcons.videoCamera(), size: AppDimensions.iconSizeSm, color: textSec),
                            ],
                          ),
                          Text(
                            _activeCamerasCount > 0 ? '$_activeCamerasCount kamera' : '—',
                            style: AppTypography.mono(
                              text,
                              size: AppTypography.textMd,
                              weight: FontWeight.w600,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          AppBadge(
                            label: _activeCamerasCount > 0 ? 'Siaga' : 'Tidak terhubung',
                            variant: _activeCamerasCount > 0 ? AppBadgeVariant.ok : AppBadgeVariant.neutral,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: AppDimensions.sectionGap),

                // Section Kontrol Saklar (Lampu & Kipas)
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Kontrol Saklar',
                            style: AppTypography.body(
                              text,
                              size: AppTypography.textMd,
                              weight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 2.0),
                          Text(
                            'Kanal lampu dan kipas yang terhubung langsung ke relai',
                            style: AppTypography.body(textSec, size: AppTypography.textXs),
                          ),
                        ],
                      ),
                    ),
                    if (_activeActuators > 0)
                      TextButton(
                        onPressed: _turnOffAllDevices,
                        style: TextButton.styleFrom(
                          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.space2),
                          minimumSize: Size.zero,
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        ),
                        child: Text(
                          'Matikan Semua',
                          style: AppTypography.body(
                            isDark ? AppColors.darkAccent : AppColors.lightAccent,
                            size: AppTypography.textXs,
                            weight: FontWeight.w600,
                          ),
                        ),
                      ),
                  ],
                ),

                const SizedBox(height: AppSpacing.space3),

                // Grid Saklar atau Empty State (Tanpa Data Palsu)
                if (_isLoading && _devices.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: AppSpacing.space6),
                    child: Center(child: CircularProgressIndicator(color: accent, strokeWidth: 2.0)),
                  )
                else if (_switchChannels.isEmpty)
                  AppCard(
                    padding: const EdgeInsets.symmetric(vertical: AppSpacing.space6, horizontal: AppSpacing.space4),
                    child: EmptyState(
                      icon: PhosphorIcon(
                        PhosphorIcons.lightbulb(),
                        size: 40.0,
                        color: textSec,
                      ),
                      title: 'Belum ada perangkat yang terhubung',
                      description: 'Nyalakan ESP32 atau hubungkan modul perangkat ke sistem untuk mengontrol saklar fisik.',
                      action: AppButton(
                        label: 'Hubungkan Perangkat',
                        variant: AppButtonVariant.primary,
                        icon: PhosphorIcon(PhosphorIcons.plus(), size: AppDimensions.iconSizeSm),
                        onPressed: _openAddDevice,
                      ),
                    ),
                  )
                else
                  GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      mainAxisSpacing: AppDimensions.cardGap,
                      crossAxisSpacing: AppDimensions.cardGap,
                      childAspectRatio: 1.15,
                    ),
                    itemCount: _switchChannels.length,
                    itemBuilder: (context, index) {
                      final item = _switchChannels[index];
                      final dev = item['device'] as Map<String, dynamic>;
                      final ch = item['channel'] as Map<String, dynamic>;

                      final chKey = ch['channel_key']?.toString() ?? '';
                      final chName = ch['alias']?.toString() ?? ch['name']?.toString() ?? 'Saklar';
                      final room = dev['room']?.toString() ?? 'Umum';
                      final isOnline = dev['is_online'] == true;
                      final valStr = ch['current_value']?.toString() ?? 'false';
                      final isOn = valStr.toLowerCase() == 'true' || valStr == '1';

                      final isFan = chKey.contains('fan') || chKey.contains('relay');
                      final iconData = isFan ? PhosphorIcons.fan() : PhosphorIcons.lightbulb();

                      final subtitle = !isOnline
                          ? '$room • Offline'
                          : (isOn ? '$room • Menyala' : '$room • Mati');

                      return DeviceTile(
                        name: chName,
                        subtitle: subtitle,
                        isOn: isOn,
                        isOnline: isOnline,
                        icon: iconData,
                        onToggle: isOnline ? (_) => _toggleDevice(dev, ch) : null,
                        onTap: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => DeviceDetailScreen(deviceId: dev['id'].toString()),
                            ),
                          );
                        },
                      );
                    },
                  ),

                const SizedBox(height: AppDimensions.sectionGap),

                // Bagian Aktivitas Terakhir
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(
                        'Aktivitas Terakhir',
                        style: AppTypography.body(
                          text,
                          size: AppTypography.textMd,
                          weight: FontWeight.w600,
                        ),
                      ),
                    ),
                    InkWell(
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const NotificationsScreen()),
                        );
                      },
                      child: Text(
                        'Lihat semua',
                        style: AppTypography.body(
                          accent,
                          size: AppTypography.textXs,
                          weight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: AppSpacing.space3),

                AppCard(
                  padding: EdgeInsets.zero,
                  child: _recentEvents.isEmpty
                      ? Padding(
                          padding: const EdgeInsets.all(AppSpacing.space4),
                          child: Center(
                            child: Text(
                              'Belum ada aktivitas tercatat.',
                              style: AppTypography.body(textSec, size: AppTypography.textSm),
                            ),
                          ),
                        )
                      : Column(
                          children: _recentEvents.asMap().entries.map((entry) {
                            final idx = entry.key;
                            final ev = entry.value;
                            final isLast = idx == _recentEvents.length - 1;

                            final rawTime = ev['timestamp']?.toString() ?? ev['created_at']?.toString() ?? '';
                            String timeOnly = '--:--';
                            if (rawTime.contains('T')) {
                              final parts = rawTime.split('T')[1].split(':');
                              if (parts.length >= 2) timeOnly = '${parts[0]}:${parts[1]}';
                            }

                            final desc = ev['description']?.toString() ?? ev['action']?.toString() ?? 'Aktivitas sistem';

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
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    timeOnly,
                                    style: AppTypography.mono(
                                      textSec,
                                      size: AppTypography.textXs,
                                    ),
                                  ),
                                  const SizedBox(width: AppSpacing.space3),
                                  Expanded(
                                    child: Text(
                                      desc,
                                      style: AppTypography.body(
                                        text,
                                        size: AppTypography.textSm,
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
      ),
    );
  }
}
