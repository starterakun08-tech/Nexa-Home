import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:app/components/app_button.dart';
import 'package:app/components/app_card.dart';
import 'package:app/components/empty_state.dart';
import 'package:app/core/api_client.dart';
import 'package:app/screens/add_camera_screen.dart';
import 'package:app/screens/camera_live_screen.dart';
import 'package:app/theme/tokens.dart';

class CamerasTab extends ConsumerStatefulWidget {
  const CamerasTab({super.key});

  @override
  ConsumerState<CamerasTab> createState() => _CamerasTabState();
}

class _CamerasTabState extends ConsumerState<CamerasTab> {
  bool _isLoading = true;
  List<dynamic> _cameras = [];
  Timer? _refreshTimer;

  @override
  void initState() {
    super.initState();
    _fetchCameras();
    _refreshTimer = Timer.periodic(const Duration(seconds: 5), (_) => _fetchCameras(silent: true));
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _fetchCameras({bool silent = false}) async {
    if (!silent) setState(() => _isLoading = true);

    try {
      final dio = await ApiClient.getInstance();
      final res = await dio.get('/api/cameras');
      if (res.statusCode == 200 && mounted) {
        final list = res.data as List<dynamic>? ?? [];
        setState(() {
          _cameras = list;
          _isLoading = false;
        });
      }
    } catch (_) {
      if (mounted && !silent) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? AppColors.darkBg : AppColors.lightBg;
    final text = isDark ? AppColors.darkText : AppColors.lightText;
    final textSec = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;
    final subtle = isDark ? AppColors.darkSubtle : AppColors.lightSubtle;

    // Cek apakah ada kamera dengan mode privasi aktif
    final privacyCamera = _cameras.firstWhere(
      (c) => c['privacy_mode'] == true,
      orElse: () => null,
    );
    final isPrivacyActive = privacyCamera != null;
    final privacyCamName = privacyCamera?['name']?.toString() ?? 'Kamar';

    return Scaffold(
      backgroundColor: bg,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _fetchCameras,
          color: isDark ? AppColors.darkAccent : AppColors.lightAccent,
          backgroundColor: isDark ? AppColors.darkSurface : AppColors.lightSurface,
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.symmetric(horizontal: AppDimensions.screenMargin),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: AppSpacing.space3),

                // Top Bar: Kamera (32/600) + Add Camera button
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Text(
                      'Kamera',
                      style: AppTypography.body(
                        text,
                        size: AppTypography.textXl, // 32px
                        weight: FontWeight.w600,
                      ),
                    ),
                    InkWell(
                      onTap: () {
                        Navigator.push(
                          context,
                          MaterialPageRoute(builder: (_) => const AddCameraScreen()),
                        );
                      },
                      borderRadius: BorderRadius.circular(AppRadius.full),
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

                const SizedBox(height: AppSpacing.space4),

                // Banner Privasi jika ada kamera yang mode privasinya aktif
                if (isPrivacyActive) ...[
                  AppCard(
                    backgroundColor: subtle,
                    padding: const EdgeInsets.all(AppSpacing.space3),
                    child: Row(
                      children: [
                        PhosphorIcon(
                          PhosphorIcons.eyeSlash(),
                          size: AppDimensions.iconSizeSm,
                          color: textSec,
                        ),
                        const SizedBox(width: AppSpacing.space2),
                        Expanded(
                          child: Text(
                            'Mode privasi aktif, kamera $privacyCamName dimatikan',
                            style: AppTypography.body(textSec, size: AppTypography.textXs),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.space3),
                ],

                if (_isLoading && _cameras.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(AppSpacing.space8),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (_cameras.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: AppSpacing.space8),
                    child: EmptyState(
                      icon: PhosphorIcon(
                        PhosphorIcons.videoCamera(),
                        size: 48,
                        color: textSec,
                      ),
                      title: 'Belum ada perangkat yang terhubung',
                      description: 'Tekan tombol "+" di kanan atas untuk menyambungkan kamera dari HP bekas.',
                      action: AppButton(
                        label: 'Tambah Kamera',
                        onPressed: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(builder: (_) => const AddCameraScreen()),
                          );
                        },
                      ),
                    ),
                  )
                else
                  // Grid 2 Kolom Kamera
                  GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      mainAxisSpacing: AppDimensions.cardGap,
                      crossAxisSpacing: AppDimensions.cardGap,
                      childAspectRatio: 0.95,
                    ),
                    itemCount: _cameras.length,
                    itemBuilder: (context, index) {
                      final cam = _cameras[index] as Map<String, dynamic>;
                      final camId = cam['id']?.toString() ?? '';
                      final camName = cam['name']?.toString() ?? 'Kamera';
                      final status = cam['status']?.toString() ?? 'offline';
                      final isPrivacy = cam['privacy_mode'] == true;
                      final isOnline = status == 'online';

                      Color statusDotColor;
                      String statusText;
                      if (isPrivacy) {
                        statusDotColor = textSec;
                        statusText = 'Privasi aktif';
                      } else if (isOnline) {
                        statusDotColor = AppColors.statusOk;
                        statusText = 'Live';
                      } else {
                        statusDotColor = AppColors.statusDanger;
                        statusText = 'Offline';
                      }

                      final metaText = isOnline ? '720p 15fps' : 'Terakhir 08:15';

                      return AppCard(
                        padding: const EdgeInsets.all(AppSpacing.space3),
                        onTap: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(
                              builder: (_) => CameraLiveScreen(
                                cameraId: camId,
                                cameraName: camName,
                              ),
                            ),
                          );
                        },
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Thumbnail Preview Placeholder datar
                            Expanded(
                              child: Container(
                                width: double.infinity,
                                decoration: BoxDecoration(
                                  color: subtle,
                                  borderRadius: AppRadius.borderButton,
                                ),
                                alignment: Alignment.center,
                                child: PhosphorIcon(
                                  isPrivacy
                                      ? PhosphorIcons.eyeSlash()
                                      : PhosphorIcons.videoCamera(),
                                  size: 32,
                                  color: textSec,
                                ),
                              ),
                            ),
                            const SizedBox(height: AppSpacing.space2),
                            // Nama Kamera
                            Text(
                              camName,
                              style: AppTypography.body(
                                text,
                                size: AppTypography.textSm,
                                weight: FontWeight.w600,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 2),
                            // Status Dot + Text
                            Row(
                              children: [
                                Container(
                                  width: 6,
                                  height: 6,
                                  decoration: BoxDecoration(
                                    color: statusDotColor,
                                    shape: BoxShape.circle,
                                  ),
                                ),
                                const SizedBox(width: 6),
                                Text(
                                  statusText,
                                  style: AppTypography.body(
                                    textSec,
                                    size: AppTypography.textXs,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 2),
                            // Metadata mono
                            Text(
                              metaText,
                              style: AppTypography.mono(
                                textSec,
                                size: 11,
                              ),
                            ),
                          ],
                        ),
                      );
                    },
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
