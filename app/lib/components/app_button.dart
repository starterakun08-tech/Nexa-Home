import 'package:flutter/material.dart';
import 'package:app/theme/tokens.dart';

enum AppButtonVariant { primary, secondary, danger, ghost }

class AppButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final AppButtonVariant variant;
  final bool isLoading;
  final Widget? icon;
  final bool isFullWidth;
  final double height;

  const AppButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.variant = AppButtonVariant.primary,
    this.isLoading = false,
    this.icon,
    this.isFullWidth = true,
    this.height = AppDimensions.controlHeight,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    Color bg;
    Color textColor;

    switch (variant) {
      case AppButtonVariant.primary:
        bg = isDark ? AppColors.darkAccent : AppColors.lightAccent;
        textColor = isDark ? AppColors.darkAccentText : AppColors.lightAccentText;
        break;
      case AppButtonVariant.secondary:
        bg = isDark ? AppColors.darkSubtle : AppColors.lightSubtle;
        textColor = isDark ? AppColors.darkText : AppColors.lightText;
        break;
      case AppButtonVariant.danger:
        bg = AppColors.statusDanger;
        textColor = AppColors.lightSurface;
        break;
      case AppButtonVariant.ghost:
        bg = AppColors.transparent;
        textColor = isDark ? AppColors.darkAccent : AppColors.lightAccent;
        break;
    }

    Widget content;
    if (isLoading) {
      content = SizedBox(
        width: AppDimensions.iconSizeSm,
        height: AppDimensions.iconSizeSm,
        child: CircularProgressIndicator(
          strokeWidth: AppDimensions.borderWidth * 2,
          valueColor: AlwaysStoppedAnimation<Color>(textColor),
        ),
      );
    } else {
      content = Row(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (icon != null) ...[
            icon!,
            const SizedBox(width: AppSpacing.space2),
          ],
          Flexible(
            child: Text(
              label,
              style: AppTypography.body(
                textColor,
                size: AppTypography.textSm,
                weight: FontWeight.w600,
              ),
              overflow: TextOverflow.ellipsis,
              maxLines: 1,
            ),
          ),
        ],
      );
    }

    final buttonWidget = Container(
      height: height,
      decoration: BoxDecoration(
        color: bg,
        borderRadius: AppRadius.borderSm,
      ),
      alignment: Alignment.center,
      child: content,
    );

    return Material(
      color: AppColors.transparent,
      borderRadius: AppRadius.borderSm,
      child: InkWell(
        onTap: isLoading ? null : onPressed,
        borderRadius: AppRadius.borderSm,
        child: isFullWidth ? SizedBox(width: double.infinity, child: buttonWidget) : buttonWidget,
      ),
    );
  }
}
