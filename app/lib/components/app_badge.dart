import 'package:flutter/material.dart';
import 'package:app/theme/tokens.dart';

enum AppBadgeVariant { ok, warn, danger, neutral }

class AppStatusDot extends StatelessWidget {
  final String label;
  final AppBadgeVariant variant;
  final bool isBold;

  const AppStatusDot({
    super.key,
    required this.label,
    this.variant = AppBadgeVariant.neutral,
    this.isBold = false,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    Color dotColor;
    switch (variant) {
      case AppBadgeVariant.ok:
        dotColor = AppColors.statusOk;
        break;
      case AppBadgeVariant.warn:
        dotColor = AppColors.statusWarn;
        break;
      case AppBadgeVariant.danger:
        dotColor = AppColors.statusDanger;
        break;
      case AppBadgeVariant.neutral:
        dotColor = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;
        break;
    }

    final textColor = isDark ? AppColors.darkText : AppColors.lightText;

    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Container(
          width: 8.0,
          height: 8.0,
          decoration: BoxDecoration(
            color: dotColor,
            shape: BoxShape.circle,
          ),
        ),
        const SizedBox(width: AppSpacing.space2),
        Flexible(
          child: Text(
            label,
            style: AppTypography.body(
              textColor,
              size: AppTypography.textSm,
              weight: isBold ? FontWeight.w600 : FontWeight.w400,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

class AppChip extends StatelessWidget {
  final String label;
  final bool isSelected;
  final VoidCallback? onTap;
  final Widget? icon;

  const AppChip({
    super.key,
    required this.label,
    this.isSelected = false,
    this.onTap,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final activeBg = isDark ? AppColors.darkAccent : AppColors.lightAccent;
    final activeText = isDark ? AppColors.darkAccentText : AppColors.lightAccentText;
    final inactiveBg = isDark ? AppColors.darkSubtle : AppColors.lightSubtle;
    final inactiveText = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;

    final bg = isSelected ? activeBg : inactiveBg;
    final textColor = isSelected ? activeText : inactiveText;

    final widget = Container(
      height: 32.0, // Chip height 32
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.space3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: AppRadius.borderChip, // Radius 8
      ),
      alignment: Alignment.center,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            icon!,
            const SizedBox(width: AppSpacing.space1),
          ],
          Text(
            label,
            style: AppTypography.body(
              textColor,
              size: AppTypography.textXs,
              weight: isSelected ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
        ],
      ),
    );

    if (onTap != null) {
      return Material(
        color: AppColors.transparent,
        borderRadius: AppRadius.borderChip,
        child: InkWell(
          onTap: onTap,
          borderRadius: AppRadius.borderChip,
          child: widget,
        ),
      );
    }

    return widget;
  }
}

class AppBadge extends StatelessWidget {
  final String label;
  final AppBadgeVariant variant;
  final Widget? icon;

  const AppBadge({
    super.key,
    required this.label,
    this.variant = AppBadgeVariant.neutral,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    Color bg;
    Color textColor;

    switch (variant) {
      case AppBadgeVariant.ok:
        bg = isDark ? AppColors.darkAccentLight : AppColors.lightAccentLight;
        textColor = AppColors.statusOk;
        break;
      case AppBadgeVariant.warn:
        bg = isDark ? AppColors.darkSubtle : AppColors.lightSubtle;
        textColor = AppColors.statusWarn;
        break;
      case AppBadgeVariant.danger:
        bg = isDark ? AppColors.darkSubtle : AppColors.lightSubtle;
        textColor = AppColors.statusDanger;
        break;
      case AppBadgeVariant.neutral:
        bg = isDark ? AppColors.darkSubtle : AppColors.lightSubtle;
        textColor = isDark ? AppColors.darkTextSecondary : AppColors.lightTextSecondary;
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.space2,
        vertical: AppSpacing.space1,
      ),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: AppRadius.borderChip,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            icon!,
            const SizedBox(width: AppSpacing.space1),
          ],
          Flexible(
            child: Text(
              label,
              style: AppTypography.body(
                textColor,
                size: AppTypography.textXs,
                weight: FontWeight.w600,
              ),
              overflow: TextOverflow.ellipsis,
              maxLines: 1,
            ),
          ),
        ],
      ),
    );
  }
}
