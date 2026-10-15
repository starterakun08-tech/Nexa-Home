import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:app/components/app_badge.dart';
import 'package:app/components/app_button.dart';
import 'package:app/components/app_card.dart';
import 'package:app/components/app_input.dart';
import 'package:app/components/app_toast.dart';
import 'package:app/core/api_client.dart';
import 'package:app/theme/tokens.dart';

class AddDeviceScreen extends StatefulWidget {
  const AddDeviceScreen({super.key});

  @override
  State<AddDeviceScreen> createState() => _AddDeviceScreenState();
}

class _AddDeviceScreenState extends State<AddDeviceScreen> {
  int _activeTab = 0; // 0: Scan QR / Kode Pairing (Opsi B), 1: Manual Developer

  // Form Klaim via QR / Token
  final _qrInputController = TextEditingController();
  final _claimIdController = TextEditingController();
  final _claimTokenController = TextEditingController();
  final _claimNameController = TextEditingController();
  final _claimRoomController = TextEditingController(text: 'Ruang Tamu');

  // Form Manual Developer
  final _idController = TextEditingController();
  final _nameController = TextEditingController();
  final _roomController = TextEditingController();

  bool _isLoading = false;
  Map<String, dynamic>? _createdCredentials;

  @override
  void dispose() {
    _qrInputController.dispose();
    _claimIdController.dispose();
    _claimTokenController.dispose();
    _claimNameController.dispose();
    _claimRoomController.dispose();
    _idController.dispose();
    _nameController.dispose();
    _roomController.dispose();
    super.dispose();
  }

  void _parseQrPayload(String raw) {
    final text = raw.trim();
    if (text.isEmpty) return;

    // 1. Cek format JSON: {"id": "esp32_xxxx", "token": "NEXA-xxxx"}
    if (text.startsWith('{') && text.endsWith('}')) {
      try {
        final data = jsonDecode(text) as Map<String, dynamic>;
        if (data.containsKey('id')) {
          _claimIdController.text = data['id'].toString();
        }
        if (data.containsKey('token')) {
          _claimTokenController.text = data['token'].toString();
        }
        AppToast.show(context, 'Data QR berhasil dibaca.');
        return;
      } catch (_) {}
    }

    // 2. Cek format URI: rumah://claim?id=esp32_xxxx&token=NEXA-xxxx
    if (text.contains('?') && text.contains('id=')) {
      try {
        final uri = Uri.parse(text);
        final id = uri.queryParameters['id'];
        final token = uri.queryParameters['token'];
        if (id != null) _claimIdController.text = id;
        if (token != null) _claimTokenController.text = token;
        AppToast.show(context, 'Data QR URI berhasil dibaca.');
        return;
      } catch (_) {}
    }

    // 3. Cek format plain ID:TOKEN
    if (text.contains(':')) {
      final parts = text.split(':');
      _claimIdController.text = parts[0].trim();
      _claimTokenController.text = parts[1].trim();
      AppToast.show(context, 'Data pairing berhasil diurai.');
      return;
    }

    // Default jika hanya teks ID
    _claimIdController.text = text;
  }

  Future<void> _submitClaim() async {
    var devId = _claimIdController.text.trim();
    var token = _claimTokenController.text.trim();
    final name = _claimNameController.text.trim();
    final room = _claimRoomController.text.trim();

    // Dukung input hanya 6-digit Kode Pairing pada salah satu kolom
    if (devId.isEmpty && token.isNotEmpty) {
      devId = token;
    } else if (token.isEmpty && devId.isNotEmpty) {
      token = devId;
    }

    if (devId.isEmpty && token.isEmpty) {
      AppToast.show(context, 'Device ID atau Kode Pairing 6-Digit wajib diisi.');
      return;
    }

    setState(() => _isLoading = true);

    try {
      final dio = await ApiClient.getInstance();
      final res = await dio.post(
        '/api/devices/claim',
        data: {
          'device_id': devId,
          'claim_token': token,
          'pair_code': token,
          'name': name.isEmpty ? 'Perangkat $devId' : name,
          'room': room.isEmpty ? 'Ruang Tamu' : room,
        },
      );

      setState(() => _isLoading = false);

      if (res.statusCode == 200 && mounted) {
        // Tampilkan pop-up dialog sukses
        await showDialog(
          context: context,
          barrierDismissible: false,
          builder: (ctx) {
            final isDark = Theme.of(ctx).brightness == Brightness.dark;
            final text = isDark ? AppColors.darkText : AppColors.lightText;
            final textSec = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;

            return AlertDialog(
              shape: RoundedRectangleBorder(borderRadius: AppRadius.borderMd),
              title: Row(
                children: [
                  Icon(PhosphorIcons.checkCircle(), color: AppColors.statusOk, size: AppDimensions.iconSizeMd),
                  const SizedBox(width: AppSpacing.space2),
                  Text('Sambungan Telah Berhasil!', style: AppTypography.body(text, weight: FontWeight.w700, size: AppTypography.textMd)),
                ],
              ),
              content: Text(
                'Perangkat "${name.isEmpty ? devId : name}" berhasil dihubungkan ke akun Anda dan kini siap dikontrol langsung.',
                style: AppTypography.body(textSec, size: AppTypography.textSm),
              ),
              actions: [
                AppButton(
                  label: 'Mulai Kontrol Perangkat',
                  variant: AppButtonVariant.primary,
                  onPressed: () {
                    Navigator.of(ctx).pop();
                    Navigator.of(context).pop(true);
                  },
                ),
              ],
            );
          },
        );
      }
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
        AppToast.show(context, 'Gagal menghubungkan perangkat. Pastikan kode pairing benar.');
      }
    }
  }

  Future<void> _submitManual() async {
    final devId = _idController.text.trim();
    final name = _nameController.text.trim();
    final room = _roomController.text.trim();

    if (devId.isEmpty || name.isEmpty) {
      AppToast.show(context, 'ID dan nama perangkat wajib diisi.');
      return;
    }

    setState(() => _isLoading = true);

    try {
      final dio = await ApiClient.getInstance();
      final res = await dio.post(
        '/api/devices',
        data: {
          'id': devId,
          'name': name,
          'room': room.isEmpty ? 'Umum' : room,
          'device_type': 'esp32',
        },
      );

      if (res.statusCode == 201) {
        setState(() {
          _createdCredentials = res.data['mqtt_credentials'] as Map<String, dynamic>?;
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() => _isLoading = false);
      if (mounted) {
        AppToast.show(context, 'Gagal menambah perangkat. Pastikan ID belum digunakan.');
      }
    }
  }

  void _copyToClipboard(String label, String value) {
    Clipboard.setData(ClipboardData(text: value));
    AppToast.show(context, '$label disalin ke papan klip.');
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final text = isDark ? AppColors.darkText : AppColors.lightText;
    final textSec = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          _createdCredentials == null ? 'Tambah Perangkat' : 'Kredensial MQTT',
          style: AppTypography.body(text, weight: FontWeight.w600, size: AppTypography.textMd),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.space4),
          child: _createdCredentials == null
              ? Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Tab Selector
                    Row(
                      children: [
                        Expanded(
                          child: GestureDetector(
                            onTap: () => setState(() => _activeTab = 0),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: AppSpacing.space2),
                              decoration: BoxDecoration(
                                border: Border(
                                  bottom: BorderSide(
                                    color: _activeTab == 0 ? (isDark ? AppColors.darkAccent : AppColors.lightAccent) : AppColors.transparent,
                                    width: 2,
                                  ),
                                ),
                              ),
                              alignment: Alignment.center,
                              child: Text(
                                'Scan QR / Kode Stiker',
                                style: AppTypography.body(
                                  _activeTab == 0 ? text : textSec,
                                  weight: _activeTab == 0 ? FontWeight.w600 : FontWeight.w400,
                                  size: AppTypography.textSm,
                                ),
                              ),
                            ),
                          ),
                        ),
                        Expanded(
                          child: GestureDetector(
                            onTap: () => setState(() => _activeTab = 1),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: AppSpacing.space2),
                              decoration: BoxDecoration(
                                border: Border(
                                  bottom: BorderSide(
                                    color: _activeTab == 1 ? (isDark ? AppColors.darkAccent : AppColors.lightAccent) : AppColors.transparent,
                                    width: 2,
                                  ),
                                ),
                              ),
                              alignment: Alignment.center,
                              child: Text(
                                'Daftar Manual',
                                style: AppTypography.body(
                                  _activeTab == 1 ? text : textSec,
                                  weight: _activeTab == 1 ? FontWeight.w600 : FontWeight.w400,
                                  size: AppTypography.textSm,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.space4),

                    if (_activeTab == 0) _buildClaimForm(text, textSec) else _buildManualForm(text, textSec),
                  ],
                )
              : _buildCredentialsView(text, textSec),
        ),
      ),
    );
  }

  Widget _buildClaimForm(Color text, Color textSec) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Panduan 3 Langkah
        AppCard(
          padding: const EdgeInsets.all(AppSpacing.space3),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(PhosphorIcons.info(), size: AppDimensions.iconSizeSm, color: AppColors.statusOk),
                  const SizedBox(width: AppSpacing.space2),
                  Text('Langkah Mudah Sambung Alat:', style: AppTypography.body(text, weight: FontWeight.w600, size: AppTypography.textSm)),
                ],
              ),
              const SizedBox(height: AppSpacing.space2),
              Text(
                '1. Sambungkan HP ke WiFi alat (nama tertera di stiker, misal: Rumah-Smart-XXXX).\n'
                '2. Buka jendela pengaturan yang muncul otomatis, pilih WiFi rumah & masukkan sandinya.\n'
                '3. Scan atau masukkan kode stiker di bawah ini, lalu klik "Hubungkan ke Akun".',
                style: AppTypography.body(textSec, size: AppTypography.textXs),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.space4),

        // Parser Input QR
        AppInput(
          controller: _qrInputController,
          label: 'Scan / Tempel Data QR Stiker Perangkat',
          hint: 'Scan atau tempel payload teks QR di sini...',
          prefixIcon: Icon(PhosphorIcons.qrCode(), size: AppDimensions.iconSizeSm),
          onChanged: _parseQrPayload,
        ),
        const SizedBox(height: AppSpacing.space3),

        Row(
          children: [
            Expanded(
              child: AppInput(
                controller: _claimIdController,
                label: 'Device ID',
                hint: 'contoh: esp32_A4F2',
                prefixIcon: Icon(PhosphorIcons.fingerprint(), size: AppDimensions.iconSizeSm),
              ),
            ),
            const SizedBox(width: AppSpacing.space2),
            Expanded(
              child: AppInput(
                controller: _claimTokenController,
                label: 'Kode Pairing',
                hint: 'contoh: NEXA-8A4F-92C1',
                prefixIcon: Icon(PhosphorIcons.key(), size: AppDimensions.iconSizeSm),
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.space3),

        AppInput(
          controller: _claimNameController,
          label: 'Nama Perangkat (Bebas)',
          hint: 'contoh: Lampu Ruang Tamu',
          prefixIcon: Icon(PhosphorIcons.tag(), size: AppDimensions.iconSizeSm),
        ),
        const SizedBox(height: AppSpacing.space3),

        AppInput(
          controller: _claimRoomController,
          label: 'Ruangan',
          hint: 'contoh: Ruang Tamu',
          prefixIcon: Icon(PhosphorIcons.house(), size: AppDimensions.iconSizeSm),
        ),
        const SizedBox(height: AppSpacing.space6),

        AppButton(
          label: 'Daftarkan Perangkat',
          onPressed: _submitClaim,
          isLoading: _isLoading,
          icon: Icon(PhosphorIcons.link(), size: AppDimensions.iconSizeSm),
        ),
      ],
    );
  }

  Widget _buildManualForm(Color text, Color textSec) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Daftarkan modul ESP32 secara manual (kredensial MQTT akan digenerate server untuk dimasukkan ke secrets.h).',
          style: AppTypography.body(textSec, size: AppTypography.textSm),
        ),
        const SizedBox(height: AppSpacing.space4),
        AppInput(
          controller: _idController,
          label: 'ID Perangkat (Alfanumerik)',
          hint: 'contoh: esp32_tamu',
          prefixIcon: Icon(PhosphorIcons.fingerprint(), size: AppDimensions.iconSizeSm),
        ),
        const SizedBox(height: AppSpacing.space3),
        AppInput(
          controller: _nameController,
          label: 'Nama Perangkat',
          hint: 'contoh: ESP32 Ruang Tamu',
          prefixIcon: Icon(PhosphorIcons.tag(), size: AppDimensions.iconSizeSm),
        ),
        const SizedBox(height: AppSpacing.space3),
        AppInput(
          controller: _roomController,
          label: 'Lokasi / Ruangan',
          hint: 'contoh: Ruang Tamu',
          prefixIcon: Icon(PhosphorIcons.house(), size: AppDimensions.iconSizeSm),
        ),
        const SizedBox(height: AppSpacing.space6),
        AppButton(
          label: 'Daftarkan Manual',
          onPressed: _submitManual,
          isLoading: _isLoading,
          icon: Icon(PhosphorIcons.plusCircle(), size: AppDimensions.iconSizeSm),
        ),
      ],
    );
  }

  Widget _buildCredentialsView(Color text, Color textSec) {
    final c = _createdCredentials!;
    final user = c['username']?.toString() ?? '';
    final pass = c['password']?.toString() ?? '';
    final prefix = c['topic_prefix']?.toString() ?? '';
    final host = c['broker_host']?.toString() ?? '127.0.0.1';
    final port = c['broker_port']?.toString() ?? '1883';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const AppBadge(
          label: 'SIMPAN KREDENSIAL INI',
          variant: AppBadgeVariant.warn,
        ),
        const SizedBox(height: AppSpacing.space2),
        Text(
          'Kredensial MQTT berikut hanya ditampilkan satu kali. Salin ke secrets.h pada firmware ESP32:',
          style: AppTypography.body(textSec, size: AppTypography.textSm),
        ),
        const SizedBox(height: AppSpacing.space4),
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildCredRow('Broker Host', host, text, textSec),
              const SizedBox(height: AppSpacing.space2),
              _buildCredRow('Port', port, text, textSec),
              const SizedBox(height: AppSpacing.space2),
              _buildCredRow('Topic Prefix', prefix, text, textSec),
              const SizedBox(height: AppSpacing.space2),
              _buildCredRow('Username', user, text, textSec),
              const SizedBox(height: AppSpacing.space2),
              _buildCredRow('Password', pass, text, textSec),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.space6),
        AppButton(
          label: 'Salin Seluruh Konfigurasi',
          variant: AppButtonVariant.secondary,
          icon: Icon(PhosphorIcons.copy(), size: AppDimensions.iconSizeSm),
          onPressed: () {
            final dump =
                '#define MQTT_HOST "$host"\n#define MQTT_PORT $port\n#define MQTT_USER "$user"\n#define MQTT_PASS "$pass"\n#define DEVICE_ID "$user"';
            _copyToClipboard('Konfigurasi C++', dump);
          },
        ),
        const SizedBox(height: AppSpacing.space3),
        AppButton(
          label: 'Selesai',
          onPressed: () => Navigator.of(context).pop(true),
        ),
      ],
    );
  }

  Widget _buildCredRow(String label, String value, Color text, Color textSec) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: AppTypography.body(textSec, size: AppTypography.textXs)),
        Row(
          children: [
            Text(value, style: AppTypography.mono(text, size: AppTypography.textXs, weight: FontWeight.w600)),
            const SizedBox(width: AppSpacing.space2),
            GestureDetector(
              onTap: () => _copyToClipboard(label, value),
              child: Icon(PhosphorIcons.copy(), size: AppDimensions.iconSizeSm, color: textSec),
            ),
          ],
        ),
      ],
    );
  }
}
