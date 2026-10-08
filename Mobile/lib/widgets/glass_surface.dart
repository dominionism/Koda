import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';

import 'theme.dart';

/// Visual strength presets for glass surfaces.
///
/// Use [subtle] for passive cards/sheets, [button] for tappable controls,
/// and [primary] for the main or active action.
enum GlassVariant { subtle, button, primary, dark }

/// Frosted-glass visual shell with variant-based gradient, border, and shadow config.
///
/// Renders the glass surface decoration — blur, gradient, border, and shadow —
/// but does NOT handle any interaction or tap logic. For tappable glass
/// controls, see [GlassButton]. The visual variant is configured via
/// [GlassVariant] which itself is a data-carrying enum: adding a variant
/// means editing one switch, not three.
class GlassSurface extends StatelessWidget {
  const GlassSurface({
    super.key,
    required this.child,
    this.variant = GlassVariant.subtle,
    this.borderRadius,
    this.padding = EdgeInsets.zero,
  });

  final Widget child;
  final GlassVariant variant;
  final BorderRadius? borderRadius;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final radius = borderRadius ?? BorderRadius.circular(999);

    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: radius,
        boxShadow: _outerShadows(),
      ),
      child: ClipRRect(
        borderRadius: radius,
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: GlassTheme.glassLight.blurSigma, sigmaY: GlassTheme.glassLight.blurSigma),
          child: Container(
            padding: padding,
            decoration: BoxDecoration(
              borderRadius: radius,
              gradient: _fillGradient(),
              border: Border.all(color: _borderColor()),
            ),
            child: child,
          ),
        ),
      ),
    );
  }

  LinearGradient _fillGradient() {
    return switch (variant) {
      GlassVariant.subtle => LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          Colors.white.withValues(alpha: 0.10),
          Colors.white.withValues(alpha: 0.045),
        ],
      ),
      GlassVariant.button => LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          Colors.white.withValues(alpha: 0.20),
          Colors.white.withValues(alpha: 0.075),
        ],
      ),
      GlassVariant.primary => LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [
          const Color(0xFFFF5A7A).withValues(alpha: 0.30),
          const Color(0xFFFF4570).withValues(alpha: 0.14),
        ],
      ),
      GlassVariant.dark => LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          Colors.white.withValues(alpha: 0.06),
          Colors.white.withValues(alpha: 0.02),
        ],
      ),
    };
  }

  Color _borderColor() {
    return switch (variant) {
      GlassVariant.subtle => Colors.white.withValues(alpha: 0.12),
      GlassVariant.button => Colors.white.withValues(alpha: 0.24),
      GlassVariant.primary => const Color(0xFFFF5A7A).withValues(alpha: 0.45),
      GlassVariant.dark => Colors.white.withValues(alpha: 0.05),
    };
  }

  List<BoxShadow> _outerShadows() {
    return switch (variant) {
      GlassVariant.subtle => const [],
      GlassVariant.dark => const [],
      GlassVariant.button => [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.24),
          blurRadius: 18,
          offset: const Offset(0, 8),
        ),
        BoxShadow(
          color: Colors.white.withValues(alpha: 0.05),
          blurRadius: 1,
          offset: const Offset(0, 1),
        ),
      ],
      GlassVariant.primary => [
        BoxShadow(
          color: const Color(0xFFFF4570).withValues(alpha: 0.22),
          blurRadius: 26,
          spreadRadius: 1,
        ),
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.28),
          blurRadius: 18,
          offset: const Offset(0, 8),
        ),
      ],
    };
  }
}
