import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:phosphor_flutter/phosphor_flutter.dart';
import 'package:app/components/app_card.dart';
import 'package:app/components/app_top_bar.dart';
import 'package:app/core/api_client.dart';
import 'package:app/screens/family_event_detail_screen.dart';
import 'package:app/theme/tokens.dart';

class FamilySummaryScreen extends ConsumerStatefulWidget {
  const FamilySummaryScreen({super.key});

  @override
  ConsumerState<FamilySummaryScreen> createState() => _FamilySummaryScreenState();
}

class _FamilySummaryScreenState extends ConsumerState<FamilySummaryScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _summaryData;
  List<dynamic> _events = [];

  @override
  void initState() {
    super.initState();
    _fetchFamilyData();
  }

  Future<void> _fetchFamilyData() async {
    setState(() => _isLoading = true);
    try {
      final dio = await ApiClient.getInstance();
      
      final sumRes = await dio.get('/api/family/summary');
      if (sumRes.statusCode == 200 && mounted) {
        _summaryData = sumRes.data['data'] as Map<String, dynamic>?;
      }

      final evRes = await dio.get('/api/family/events?limit=20');
      if (evRes.statusCode == 200 && mounted) {
        _events = evRes.data['events'] as List<dynamic>? ?? [];
      }

      if (mounted) setState(() => _isLoading = false);
    } catch (_) {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final bg = isDark ? AppColors.darkBg : AppColors.lightBg;
    final text = isDark ? AppColors.darkText : AppColors.lightText;
    final textSec = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;
    final accent = isDark ? AppColors.darkAccent : AppColors.lightAccent;

    final studyMinutes = _summaryData?['study_minutes'] ?? 0;
    final lateNightCount = _summaryData?['late_night_count'] ?? 0;
    final fallCount = _summaryData?['fall_incident_count'] ?? 0;

    return Scaffold(
      backgroundColor: bg,
      appBar: AppTopBar(
        title: 'Keluarga',
        actions: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: isDark ? AppColors.darkAccentLight : AppColors.lightAccentLight,
              borderRadius: AppRadius.borderChip,
            ),
            child: Text(
              'Hanya Pengelola',
              style: AppTypography.body(
                accent,
                size: AppTypography.textXs,
                weight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _fetchFamilyData,
          color: accent,
          child: _isLoading
              ? Center(
                  child: CircularProgressIndicator(
                    color: accent,
                    strokeWidth: 2.0,
                  ),
                )
              : SingleChildScrollView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.symmetric(horizontal: AppDimensions.screenMargin),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const SizedBox(height: AppSpacing.space3),

                      // Ringkasan Hari Ini
                      Text(
                        'Ringkasan Hari Ini',
                        style: AppTypography.body(
                          textSec,
                          size: AppTypography.textXs,
                          weight: FontWeight.w600,
                        ),
                      ),
                const SizedBox(height: AppSpacing.space3),

                // Metrik 3 Kolom
                Row(
                  children: [
                    // Waktu Belajar
                    Expanded(
                      child: AppCard(
                        padding: const EdgeInsets.all(AppSpacing.space4),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Waktu Belajar', style: AppTypography.body(textSec, size: AppTypography.textXs)),
                            const SizedBox(height: AppSpacing.space2),
                            Text(
                              '$studyMinutes',
                              style: AppTypography.mono(text, size: AppTypography.textLg, weight: FontWeight.w600),
                            ),
                            Text('menit', style: AppTypography.body(textSec, size: 11)),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: AppDimensions.cardGap),

                    // Aktif Lewat Tengah Malam
                    Expanded(
                      child: AppCard(
                        padding: const EdgeInsets.all(AppSpacing.space4),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Lewat Malam', style: AppTypography.body(textSec, size: AppTypography.textXs)),
                            const SizedBox(height: AppSpacing.space2),
                            Text(
                              '$lateNightCount',
                              style: AppTypography.mono(text, size: AppTypography.textLg, weight: FontWeight.w600),
                            ),
                            Text('kali', style: AppTypography.body(textSec, size: 11)),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: AppDimensions.cardGap),

                    // Kejadian Jatuh
                    Expanded(
                      child: AppCard(
                        padding: const EdgeInsets.all(AppSpacing.space4),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Kejadian Jatuh', style: AppTypography.body(textSec, size: AppTypography.textXs)),
                            const SizedBox(height: AppSpacing.space2),
                            Text(
                              '$fallCount',
                              style: AppTypography.mono(
                                fallCount > 0 ? AppColors.statusDanger : AppColors.statusOk,
                                size: AppTypography.textLg,
                                weight: FontWeight.w600,
                              ),
                            ),
                            Text('kejadian', style: AppTypography.body(textSec, size: 11)),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: AppDimensions.sectionGap),

                // Linimasa Kejadian
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Linimasa Kejadian',
                      style: AppTypography.body(
                        textSec,
                        size: AppTypography.textXs,
                        weight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      'Hari ini',
                      style: AppTypography.mono(textSec, size: AppTypography.textXs),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.space3),

                AppCard(
                  padding: EdgeInsets.zero,
                  child: _events.isEmpty
                      ? Padding(
                          padding: const EdgeInsets.all(AppSpacing.space5),
                          child: Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                PhosphorIcon(PhosphorIcons.users(), size: 36, color: textSec),
                                const SizedBox(height: AppSpacing.space2),
                                Text(
                                  'Belum ada kejadian keluarga tercatat hari ini.',
                                  style: AppTypography.body(textSec, size: AppTypography.textSm),
                                  textAlign: TextAlign.center,
                                ),
                              ],
                            ),
                          ),
                        )
                      : Column(
                          children: _events.asMap().entries.map((entry) {
                            final idx = entry.key;
                            final ev = entry.value;
                            final isLast = idx == _events.length - 1;

                            final rawTime = ev['created_at']?.toString() ?? '';
                            String timeOnly = '08:42';
                            if (rawTime.contains('T')) {
                              final parts = rawTime.split('T')[1].split(':');
                              if (parts.length >= 2) timeOnly = '${parts[0]}:${parts[1]}';
                            }

                            final title = ev['title']?.toString() ?? 'Gerakan terdeteksi';
                            final desc = ev['description']?.toString() ?? '';

                            return InkWell(
                              onTap: () {
                                Navigator.push(
                                  context,
                                  MaterialPageRoute(
                                    builder: (_) => FamilyEventDetailScreen(event: ev),
                                  ),
                                );
                              },
                              child: Container(
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
                                    Text(
                                      timeOnly,
                                      style: AppTypography.mono(textSec, size: AppTypography.textXs),
                                    ),
                                    const SizedBox(width: AppSpacing.space3),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            title,
                                            style: AppTypography.body(
                                              text,
                                              size: AppTypography.textSm,
                                              weight: FontWeight.w600,
                                            ),
                                          ),
                                          if (desc.isNotEmpty) ...[
                                            const SizedBox(height: 2),
                                            Text(
                                              desc,
                                              style: AppTypography.body(textSec, size: AppTypography.textXs),
                                            ),
                                          ],
                                        ],
                                      ),
                                    ),
                                    PhosphorIcon(PhosphorIcons.caretRight(), size: AppDimensions.iconSizeSm, color: textSec),
                                  ],
                                ),
                              ),
                            );
                          }).toList(),
                        ),
                ),

                const SizedBox(height: AppDimensions.sectionGap),

                // Catatan Kaki Wajib: Data dihitung dari kehadiran dan posisi tubuh, bukan identitas wajah
                Center(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: AppSpacing.space4),
                    child: Text(
                      'Data dihitung dari kehadiran dan posisi tubuh, bukan identitas wajah.',
                      style: AppTypography.body(textSec, size: 11),
                      textAlign: TextAlign.center,
                    ),
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
