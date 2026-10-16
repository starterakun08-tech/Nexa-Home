import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
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
  final _tokenOrCodeController = TextEditingController();
  final _claimIdController = TextEditingController();
  final _claimNameController = TextEditingController(text: 'Lampu Ruang Tamu');
  final _claimRoomController = TextEditingController(text: 'Ruang Tamu');

  bool _isLoading = false;
  String? _errorMessage;

  @override
  void dispose() {
    _tokenOrCodeController.dispose();
    _claimIdController.dispose();
    _claimNameController.dispose();
    _claimRoomController.dispose();
    super.dispose();
  }

  void _parsePayload(String raw) {
    final text = raw.trim();
    if (text.isEmpty) return;

    setState(() => _errorMessage = null);

    // 1. Cek format JSON: {"id": "esp32_xxxx", "token": "466923"} atau {"pair_code": "..."}
    if (text.startsWith('{') && text.endsWith('}')) {
      try {
        final data = jsonDecode(text) as Map<String, dynamic>;
        if (data.containsKey('id')) {
          _claimIdController.text = data['id'].toString().trim();
        }
        if (data.containsKey('token')) {
          _tokenOrCodeController.text = data['token'].toString().trim();
        } else if (data.containsKey('pair_code')) {
          _tokenOrCodeController.text = data['pair_code'].toString().trim();
        }
        if (data.containsKey('name') && data['name'] != null && data['name'].toString().isNotEmpty) {
          _claimNameController.text = data['name'].toString().trim();
        }
        AppToast.show(context, 'Data QR berhasil dibaca.');
        return;
      } catch (_) {}
    }

    // 2. Cek format URI: rumah://claim?id=esp32_xxxx&token=466923
    if (text.contains('?') && (text.contains('id=') || text.contains('token='))) {
      try {
        final uri = Uri.parse(text);
        final id = uri.queryParameters['id'];
        final token = uri.queryParameters['token'] ?? uri.queryParameters['pair_code'];
        if (id != null) _claimIdController.text = id;
        if (token != null) _tokenOrCodeController.text = token;
        AppToast.show(context, 'Data URI berhasil dibaca.');
        return;
      } catch (_) {}
    }

    // 3. Cek format plain ID:TOKEN (contoh: esp32_559ed8:466923)
    if (text.contains(':')) {
      final parts = text.split(':');
      _claimIdController.text = parts[0].trim();
      _tokenOrCodeController.text = parts[1].trim();
      AppToast.show(context, 'Format ID:Token berhasil diurai.');
      return;
    }

    // 4. Jika plain text / 6-digit kode
    _tokenOrCodeController.text = text;
  }

  Future<void> _pasteFromClipboard() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    final text = data?.text?.trim() ?? '';
    if (text.isEmpty) {
      if (mounted) AppToast.show(context, 'Papan klip kosong.');
      return;
    }
    _parsePayload(text);
  }

  Future<void> _submitClaim() async {
    var token = _tokenOrCodeController.text.trim();
    var devId = _claimIdController.text.trim();
    final name = _claimNameController.text.trim();
    final room = _claimRoomController.text.trim();

    if (token.isEmpty && devId.isEmpty) {
      setState(() => _errorMessage = 'Masukkan Kode Pairing 6-Digit atau Token.');
      return;
    }

    // Jika salah satu kosong dan yang lain 6 digit, sinkronkan
    if (devId.isEmpty && token.isNotEmpty) {
      if (token.startsWith('esp32_')) {
        devId = token;
      }
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final dio = await ApiClient.getInstance();
      final res = await dio.post(
        '/api/devices/claim',
        data: {
          'device_id': devId,
          'claim_token': token,
          'pair_code': token,
          'name': name.isEmpty ? (devId.isNotEmpty ? 'Perangkat $devId' : 'Lampu Ruang Tamu') : name,
          'room': room.isEmpty ? 'Ruang Tamu' : room,
        },
      );

      setState(() => _isLoading = false);

      if (res.statusCode == 200 && mounted) {
        // Tampilkan dialog konfirmasi "Sambungan Telah Berhasil!"
        await showDialog(
          context: context,
          barrierDismissible: false,
          builder: (ctx) {
            final isDark = Theme.of(ctx).brightness == Brightness.dark;
            final text = isDark ? AppColors.darkText : AppColors.lightText;
            final textSec = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;

            final finalName = name.isEmpty ? 'Lampu Ruang Tamu' : name;

            return AlertDialog(
              backgroundColor: isDark ? AppColors.darkSurface : AppColors.lightSurface,
              shape: const RoundedRectangleBorder(borderRadius: AppRadius.borderCard),
              title: Row(
                children: [
                  PhosphorIcon(
                    PhosphorIcons.checkCircle(PhosphorIconsStyle.fill),
                    color: AppColors.statusOk,
                    size: AppDimensions.iconSizeMd,
                  ),
                  const SizedBox(width: AppSpacing.space2),
                  Expanded(
                    child: Text(
                      'Sambungan Telah Berhasil!',
                      style: AppTypography.body(
                        text,
                        weight: FontWeight.w700,
                        size: AppTypography.textMd,
                      ),
                    ),
                  ),
                ],
              ),
              content: Text(
                'Perangkat "$finalName" telah berhasil dihubungkan ke akun Anda dan kini siap dikontrol langsung dari dashboard.',
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
      setState(() {
        _isLoading = false;
        String msg = 'Gagal menghubungkan perangkat. Pastikan kode pairing benar dan alat terhubung WiFi.';
        if (e is DioException && e.response?.data != null) {
          final data = e.response!.data;
          if (data is Map && data['detail'] != null) {
            msg = data['detail'].toString();
          }
        }
        _errorMessage = _formatClaimErrorMessage(msg);
      });
      if (mounted) {
        AppToast.show(context, _errorMessage!, isError: true);
      }
    }
  }

  String _formatClaimErrorMessage(String rawError) {
    final err = rawError.toLowerCase();
    if (err.contains('terpakai') || err.contains('used')) {
      return 'Kode pairing sudah terpakai';
    }
    if (err.contains('kedaluwarsa') || err.contains('expired')) {
      return 'Kode pairing kedaluwarsa. Silakan tekan tombol pairing di perangkat untuk kode baru';
    }
    if (err.contains('terlalu banyak') || err.contains('rate limit') || err.contains('429')) {
      return 'Terlalu banyak percobaan. Tunggu 10 menit';
    }
    if (err.contains('sudah terdaftar') || err.contains('already bound') || err.contains('409') || err.contains('lain') || err.contains('terhubung')) {
      return 'Perangkat ini sudah terdaftar di akun lain. Hubungi pemiliknya untuk melepaskan';
    }
    if (err.contains('pengelola') || err.contains('403') || err.contains('forbidden')) {
      return 'Hanya Pengelola yang dapat menambahkan perangkat';
    }
    return rawError.isNotEmpty ? rawError : 'Gagal menghubungkan perangkat.';
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? AppColors.darkBg : AppColors.lightBg;
    final text = isDark ? AppColors.darkText : AppColors.lightText;
    final textSec = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;

    return Scaffold(
      backgroundColor: bg,
      appBar: AppBar(
        title: Text(
          'Hubungkan Perangkat',
          style: AppTypography.body(text, weight: FontWeight.w600, size: AppTypography.textMd),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.space4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Kartu Panduan Singkat 3 Langkah
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
                          color: isDark ? AppColors.darkAccent : AppColors.lightAccent,
                        ),
                        const SizedBox(width: AppSpacing.space2),
                        Text(
                          'Panduan Mudah 3 Langkah:',
                          style: AppTypography.body(
                            text,
                            weight: FontWeight.w600,
                            size: AppTypography.textSm,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.space3),
                    _buildStepRow('1', 'Sambungkan HP ke WiFi Rumah-Smart-XXXX dan atur WiFi rumah di popup 192.168.4.1.', text, textSec),
                    const SizedBox(height: AppSpacing.space2),
                    _buildStepRow('2', 'Salin Kode Pairing 6-Digit / Token atau scan QR yang tampil di layar setup ESP32.', text, textSec),
                    const SizedBox(height: AppSpacing.space2),
                    _buildStepRow('3', 'Masukkan Kode Pairing / Token di bawah ini untuk mengikat alat ke akun Anda.', text, textSec),
                  ],
                ),
              ),

              // Catatan Sesi 120 Detik (S3/S5)
              Container(
                padding: const EdgeInsets.all(AppSpacing.space3),
                decoration: BoxDecoration(
                  color: isDark ? AppColors.darkSubtle : AppColors.lightSubtle,
                  borderRadius: AppRadius.borderSm,
                  border: Border.all(color: isDark ? AppColors.darkBorder : AppColors.lightBorder),
                ),
                child: Row(
                  children: [
                    PhosphorIcon(PhosphorIcons.timer(), size: AppDimensions.iconSizeSm, color: isDark ? AppColors.darkAccent : AppColors.lightAccent),
                    const SizedBox(width: AppSpacing.space2),
                    Expanded(
                      child: Text(
                        'Sesi pairing berputar setiap 120 detik. Pastikan kode di layar atau portal perangkat masih aktif.',
                        style: AppTypography.body(textSec, size: AppTypography.textXs),
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: AppDimensions.sectionGap),

              // Form Input Kode Pairing / Token
              AppInput(
                controller: _tokenOrCodeController,
                label: 'Kode Pairing 6-Digit / Token / Data QR',
                hint: 'Contoh: 123-456 atau scan QR',
                isMono: true,
                prefixIcon: PhosphorIcon(PhosphorIcons.key(), size: AppDimensions.iconSizeSm),
                suffixIcon: IconButton(
                  tooltip: 'Tempel dari Clipboard',
                  icon: PhosphorIcon(PhosphorIcons.clipboardText(), size: AppDimensions.iconSizeSm),
                  onPressed: _pasteFromClipboard,
                ),
                onChanged: (val) {
                  if (val.startsWith('{') || val.contains(':')) {
                    _parsePayload(val);
                    return;
                  }
                  final clean = val.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');
                  if (clean.length <= 6 && !val.contains(' ') && !val.contains('_')) {
                    final formatted = clean.length > 3 ? '${clean.substring(0, 3)}-${clean.substring(3)}' : clean;
                    if (formatted != val) {
                      _tokenOrCodeController.value = TextEditingValue(
                        text: formatted,
                        selection: TextSelection.collapsed(offset: formatted.length),
                      );
                    }
                  }
                },
              ),

              const SizedBox(height: AppSpacing.space3),

              // Input ID Perangkat (Opsional / Terisi Otomatis)
              AppInput(
                controller: _claimIdController,
                label: 'ID Perangkat (Opsional)',
                hint: 'Otomatis terisi jika scan QR (contoh: esp32_559ed8)',
                isMono: true,
                prefixIcon: PhosphorIcon(PhosphorIcons.cpu(), size: AppDimensions.iconSizeSm),
              ),

              const SizedBox(height: AppSpacing.space3),

              // Input Nama Perangkat
              AppInput(
                controller: _claimNameController,
                label: 'Nama Perangkat',
                hint: 'contoh: Lampu Ruang Tamu',
                prefixIcon: PhosphorIcon(PhosphorIcons.tag(), size: AppDimensions.iconSizeSm),
              ),

              const SizedBox(height: AppSpacing.space3),

              // Input Ruangan
              AppInput(
                controller: _claimRoomController,
                label: 'Ruangan',
                hint: 'contoh: Ruang Tamu',
                prefixIcon: PhosphorIcon(PhosphorIcons.house(), size: AppDimensions.iconSizeSm),
              ),

              if (_errorMessage != null) ...[
                const SizedBox(height: AppSpacing.space3),
                Text(
                  _errorMessage!,
                  style: AppTypography.body(AppColors.statusDanger, size: AppTypography.textXs),
                ),
              ],

              const SizedBox(height: AppDimensions.sectionGap),

              // Tombol Submit
              AppButton(
                label: 'Hubungkan ke Akun',
                variant: AppButtonVariant.primary,
                isLoading: _isLoading,
                icon: PhosphorIcon(PhosphorIcons.link(), size: AppDimensions.iconSizeSm),
                onPressed: _isLoading ? null : _submitClaim,
              ),

              const SizedBox(height: AppSpacing.space4),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStepRow(String number, String textContent, Color text, Color textSec) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 20,
          height: 20,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: Theme.of(context).brightness == Brightness.dark ? AppColors.darkSubtle : AppColors.lightSubtle,
            shape: BoxShape.circle,
          ),
          child: Text(
            number,
            style: AppTypography.mono(text, size: AppTypography.textXs, weight: FontWeight.w600),
          ),
        ),
        const SizedBox(width: AppSpacing.space2),
        Expanded(
          child: Text(
            textContent,
            style: AppTypography.body(textSec, size: AppTypography.textXs),
          ),
        ),
      ],
    );
  }
}
