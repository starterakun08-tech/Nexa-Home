import 'package:flutter/material.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:app/components/app_card.dart';
import 'package:app/components/app_top_bar.dart';
import 'package:app/screens/add_camera_screen.dart';
import 'package:app/screens/add_device_screen.dart';
import 'package:app/theme/tokens.dart';

class ChooseDeviceTypeScreen extends StatelessWidget {
  const ChooseDeviceTypeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? AppColors.darkBg : AppColors.lightBg;
    final text = isDark ? AppColors.darkText : AppColors.lightText;
    final textSec = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;
    final subtle = isDark ? AppColors.darkSubtle : AppColors.lightSubtle;

    return Scaffold(
      backgroundColor: bg,
      appBar: const AppTopBar(title: 'Tambah perangkat'),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppDimensions.screenMargin),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: AppSpacing.space2),
              Text(
                'Pilih jenis perangkat yang ingin ditambahkan ke rumah.',
                style: AppTypography.body(textSec, size: AppTypography.textSm),
              ),
              const SizedBox(height: AppDimensions.sectionGap),

              // Opsi 1: Modul Rumah (ESP32)
              AppCard(
                onTap: () async {
                  final res = await Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const AddDeviceScreen()),
                  );
                  if (res == true && context.mounted) {
                    Navigator.pop(context, true);
                  }
                },
                child: Row(
                  children: [
                    Container(
                      width: 48.0,
                      height: 48.0,
                      decoration: BoxDecoration(
                        color: subtle,
                        shape: BoxShape.circle,
                      ),
                      alignment: Alignment.center,
                      child: PhosphorIcon(
                        PhosphorIcons.cpu(),
                        size: AppDimensions.iconSizeMd,
                        color: text,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.space4),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Modul Rumah (ESP32)',
                            style: AppTypography.body(
                              text,
                              size: AppTypography.textSm,
                              weight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 2.0),
                          Text(
                            'Lampu, kipas, sensor, alarm',
                            style: AppTypography.body(
                              textSec,
                              size: AppTypography.textXs,
                            ),
                          ),
                        ],
                      ),
                    ),
                    PhosphorIcon(
                      PhosphorIcons.caretRight(),
                      size: AppDimensions.iconSizeSm,
                      color: textSec,
                    ),
                  ],
                ),
              ),

              const SizedBox(height: AppDimensions.cardGap),

              // Opsi 2: Kamera dari HP bekas
              AppCard(
                onTap: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const AddCameraScreen()),
                  );
                },
                child: Row(
                  children: [
                    Container(
                      width: 48.0,
                      height: 48.0,
                      decoration: BoxDecoration(
                        color: subtle,
                        shape: BoxShape.circle,
                      ),
                      alignment: Alignment.center,
                      child: PhosphorIcon(
                        PhosphorIcons.videoCamera(),
                        size: AppDimensions.iconSizeMd,
                        color: text,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.space4),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Kamera dari HP bekas',
                            style: AppTypography.body(
                              text,
                              size: AppTypography.textSm,
                              weight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 2.0),
                          Text(
                            'Pakai HP lama sebagai kamera',
                            style: AppTypography.body(
                              textSec,
                              size: AppTypography.textXs,
                            ),
                          ),
                        ],
                      ),
                    ),
                    PhosphorIcon(
                      PhosphorIcons.caretRight(),
                      size: AppDimensions.iconSizeSm,
                      color: textSec,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
