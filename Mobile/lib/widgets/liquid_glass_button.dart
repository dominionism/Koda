import 'dart:ui';
import 'package:flutter/material.dart';

import 'theme.dart';

/// Predefined size presets for [LiquidGlassButton].
///
/// Behavior: Data-carrying enum mapping names to concrete (height, width, padding)
/// tuples via the [layout] extension. Adding a new size means editing one switch
/// expression (Strategy pattern).
///
/// Params:
///   [small] — 32px height, horizontal 16px padding.
///   [medium] — 40px height, horizontal 20px padding.
///   [large] — 48px height, horizontal 24px padding.
///   [extraLarge] — 56px height, horizontal 32px padding.
///   [huge] — 64px height, horizontal 40px padding.
///   [icon] — 44x44 square, no padding (minimum comfotable touch target).
enum LiquidGlassButtonSize { small, medium, large, extraLarge, huge, icon }
// Strategy pattern: each size carries its own (height, width, padding) tuple.
// Adding a new size needs one switch arm here — no other sites to update.
extension on LiquidGlassButtonSize {
  (double? height, double? width, EdgeInsets padding) get layout =>
      switch (this) {
        LiquidGlassButtonSize.small => (
          32,
          null,
          const EdgeInsets.symmetric(horizontal: 16),
        ),
        LiquidGlassButtonSize.medium => (
          40,
          null,
          const EdgeInsets.symmetric(horizontal: 20),
        ),
        LiquidGlassButtonSize.large => (
          48,
          null,
          const EdgeInsets.symmetric(horizontal: 24),
        ),
        LiquidGlassButtonSize.extraLarge => (
          56,
          null,
          const EdgeInsets.symmetric(horizontal: 32),
        ),
        LiquidGlassButtonSize.huge => (
          64,
          null,
          const EdgeInsets.symmetric(horizontal: 40),
        ),
        // 44 is the minimum comfortable touch target on mobile.
        LiquidGlassButtonSize.icon => (44, 44, EdgeInsets.zero),
      };
}

/// Visual variants for [LiquidGlassButton] — controls base color and border
/// highlight intensities.
///
/// Behavior: Data-carrying enum mapping variants to (baseColor, borderTop,
/// borderBottom) tuples via the [variantConfig] extension. Adding a new variant
/// means editing one switch expression (Strategy pattern).
///
/// Params:
///   [primary] — blue-tinted (#0A84FF) for the main action.
///   [secondary] — white-toned for secondary controls.
///   [ghost] — transparent fill with subtle borders for low-emphasis actions.
///   [destructive] — red-toned (#FF453A) for destructive actions.
enum LiquidGlassButtonVariant { primary, secondary, ghost, destructive }
// Strategy pattern: each variant carries (baseColor, borderTop, borderBottom).
// Adding a variant needs one switch arm here — all consumers get it free.
extension on LiquidGlassButtonVariant {
  (Color baseColor, Color borderTop, Color borderBottom) get variantConfig =>
      switch (this) {
        LiquidGlassButtonVariant.primary => (
          const Color(0xFF0A84FF),
          const Color(0x66FFFFFF),
          const Color(0x1AFFFFFF),
        ),
        LiquidGlassButtonVariant.secondary => (
          const Color(0xFFFFFFFF),
          const Color(0x4DFFFFFF),
          const Color(0x0DFFFFFF),
        ),
        LiquidGlassButtonVariant.ghost => (
          const Color(0x00FFFFFF),
          const Color(0x26FFFFFF),
          const Color(0x05FFFFFF),
        ),
        LiquidGlassButtonVariant.destructive => (
          const Color(0xFFFF453A),
          const Color(0x66FFFFFF),
          const Color(0x1AFFFFFF),
        ),
      };
}

/// Premium liquid-glass button with animated scale, blur, gradient fill, and layered border.
///
/// Variant and size config are carried by data-carrying enums (Strategy
/// pattern) so adding a new variant means editing one switch expression
/// instead of five. The build method composes smaller extracted widgets:
/// [_GlassButtonFill] for the gradient+shadow and [_GlassButtonBorder]
/// for the 4-sided highlight layer.
class LiquidGlassButton extends StatefulWidget {
  const LiquidGlassButton({
    super.key,
    required this.child,
    required this.onPressed,
    this.size = LiquidGlassButtonSize.huge,
    this.variant = LiquidGlassButtonVariant.primary,
    this.enabled = true,
  });

  final Widget child;
  final VoidCallback? onPressed;
  final LiquidGlassButtonSize size;
  final LiquidGlassButtonVariant variant;
  final bool enabled;

  @override
  State<LiquidGlassButton> createState() => _LiquidGlassButtonState();
}

class _LiquidGlassButtonState extends State<LiquidGlassButton> {
  bool _isHovered = false;
  bool _isPressed = false;

  void _onEnter(PointerEvent details) {
    if (widget.enabled) setState(() => _isHovered = true);
  }

  void _onExit(PointerEvent details) {
    if (widget.enabled) setState(() => _isHovered = false);
  }

  void _onTapDown(TapDownDetails details) {
    if (widget.enabled) setState(() => _isPressed = true);
  }

  void _onTapUp(TapUpDetails details) {
    if (widget.enabled) setState(() => _isPressed = false);
  }

  void _onTapCancel() {
    if (widget.enabled) setState(() => _isPressed = false);
  }

  @override
  Widget build(BuildContext context) {
    final bool isActive = widget.enabled && widget.onPressed != null;
    final double scale = _isPressed ? 0.96 : 1.0;
    final double opacity = widget.enabled ? 1.0 : 0.5;
    final (height, width, padding) = widget.size.layout;
    final (baseColor, borderTop, borderBottom) = widget.variant.variantConfig;

    return Semantics(
      button: true,
      enabled: isActive,
      child: Opacity(
        opacity: opacity,
        child: MouseRegion(
          onEnter: _onEnter,
          onExit: _onExit,
          cursor: isActive
              ? SystemMouseCursors.click
              : SystemMouseCursors.basic,
          child: GestureDetector(
            onTapDown: _onTapDown,
            onTapUp: _onTapUp,
            onTapCancel: _onTapCancel,
            onTap: isActive ? widget.onPressed : null,
            behavior: HitTestBehavior.opaque,
            child: AnimatedScale(
              scale: scale,
              duration: const Duration(milliseconds: 200),
              curve: Curves.easeOutCubic,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(height! / 2),
                child: BackdropFilter(
                  filter: ImageFilter.blur(
                    sigmaX: GlassTheme.glassLight.blurSigma,
                    sigmaY: GlassTheme.glassLight.blurSigma,
                  ),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 250),
                    curve: Curves.easeOutCubic,
                    height: height,
                    width: width,
                    padding: padding,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        _GlassButtonFill(
                          baseColor: baseColor,
                          variant: widget.variant,
                          isHovered: _isHovered,
                          height: height,
                        ),
                        _GlassButtonBorder(
                          borderTop: borderTop,
                          borderBottom: borderBottom,
                          height: height,
                        ),
                        AnimatedDefaultTextStyle(
                          duration: const Duration(milliseconds: 250),
                          style: TextStyle(
                            color: Colors.white.withValues(
                              alpha: _isHovered ? 1.0 : 0.9,
                            ),
                            fontSize: widget.size == LiquidGlassButtonSize.small
                                ? 14
                                : 16,
                            fontWeight: FontWeight.w600,
                            letterSpacing: 0.5,
                          ),
                          child: IconTheme(
                            data: IconThemeData(
                              color: Colors.white.withValues(
                                alpha: _isHovered ? 1.0 : 0.9,
                              ),
                              size: widget.size == LiquidGlassButtonSize.small
                                  ? 18
                                  : 20,
                            ),
                            child: widget.child,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _GlassButtonFill extends StatelessWidget {
  const _GlassButtonFill({
    required this.baseColor,
    required this.variant,
    required this.isHovered,
    required this.height,
  });

  final Color baseColor;
  final LiquidGlassButtonVariant variant;
  final bool isHovered;
  final double height;

  @override
  Widget build(BuildContext context) {
    final double fillOpacityTop = variant == LiquidGlassButtonVariant.ghost
        ? (isHovered ? 0.15 : 0.05)
        : (isHovered ? 0.35 : 0.25);

    final double fillOpacityMiddle = variant == LiquidGlassButtonVariant.ghost
        ? (isHovered ? 0.05 : 0.0)
        : (isHovered ? 0.15 : 0.05);

    final double fillOpacityBottom = variant == LiquidGlassButtonVariant.ghost
        ? (isHovered ? 0.1 : 0.02)
        : (isHovered ? 0.25 : 0.15);

    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(height / 2),
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          stops: const [0.0, 0.5, 1.0],
          colors: [
            baseColor.withValues(alpha: fillOpacityTop),
            baseColor.withValues(alpha: fillOpacityMiddle),
            baseColor.withValues(alpha: fillOpacityBottom),
          ],
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1A000000),
            blurRadius: 10,
            offset: Offset(0, 4),
          ),
        ],
      ),
    );
  }
}

class _GlassButtonBorder extends StatelessWidget {
  const _GlassButtonBorder({
    required this.borderTop,
    required this.borderBottom,
    required this.height,
  });

  final Color borderTop;
  final Color borderBottom;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: CustomPaint(
        painter: _GlassBorderPainter(
          top: borderTop,
          bottom: borderBottom,
          radius: height / 2,
        ),
      ),
    );
  }
}

/// Strokes the pill outline with a vertical gradient: bright at the top edge,
/// faint along the sides, and [bottom] at the bottom edge.
///
/// Flutter asserts on a non-uniform [Border] combined with a [BorderRadius]
/// ("A borderRadius can only be given on borders with uniform colors"), so the
/// glass edge is painted directly instead of built from border sides.
class _GlassBorderPainter extends CustomPainter {
  const _GlassBorderPainter({
    required this.top,
    required this.bottom,
    required this.radius,
  });

  final Color top;
  final Color bottom;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final rrect = RRect.fromRectAndRadius(
      rect.deflate(0.5),
      Radius.circular(radius),
    );
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 0.75
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        stops: const [0.0, 0.5, 1.0],
        colors: [top, top.withValues(alpha: 0.1), bottom],
      ).createShader(rect);
    canvas.drawRRect(rrect, paint);
  }

  @override
  bool shouldRepaint(_GlassBorderPainter oldDelegate) =>
      oldDelegate.top != top ||
      oldDelegate.bottom != bottom ||
      oldDelegate.radius != radius;
}
