import 'package:flutter/material.dart';

// ── Backward-compat top-level constants ──
const kCoral = Color(0xFFFF4570);
const kCoralWarm = Color(0xFFFF5A7A);
const kTextHi = Color(0xF2FFFFFF); // ~0.95 white
const kTextMid = Color(0x8CFFFFFF); // ~0.55 white
const kTextLow = Color(0x59FFFFFF); // ~0.35 white

// ── AppColors ThemeExtension ──
/// AppColors ThemeExtension, GlassTheme value object, and backward-compat color constants.
///
/// Centralizes all color tokens into a single [ThemeExtension] so consumers
/// use context.appColors instead of importing hex literals. [GlassTheme]
/// consolidates the previously-inconsistent blur sigmas (18 vs 24) into a
/// single configurable value (default 20). Top-level constants (kCoral,
/// kTextHi, etc.) are preserved as backward-compat aliases during migration.
class AppColors extends ThemeExtension<AppColors> {
  final Color coral;
  final Color coralWarm;
  final Color textHighEmphasis;
  final Color textMidEmphasis;
  final Color textLowEmphasis;
  final Color surfaceGlassFill;
  final Color surfaceGlassBorder;
  final Color surfaceGlassHighlight;
  final Color orbSpill;
  final Color orbHaze;
  final Color orbMid;
  final Color orbCore;

  const AppColors({
    required this.coral,
    required this.coralWarm,
    required this.textHighEmphasis,
    required this.textMidEmphasis,
    required this.textLowEmphasis,
    required this.surfaceGlassFill,
    required this.surfaceGlassBorder,
    required this.surfaceGlassHighlight,
    required this.orbSpill,
    required this.orbHaze,
    required this.orbMid,
    required this.orbCore,
  });

  static const light = AppColors(
    coral: kCoral,
    coralWarm: kCoralWarm,
    textHighEmphasis: kTextHi,
    textMidEmphasis: kTextMid,
    textLowEmphasis: kTextLow,
    surfaceGlassFill: Color(0x29FFFFFF),
    surfaceGlassBorder: Color(0x33FFFFFF),
    surfaceGlassHighlight: Color(0x0DFFFFFF),
    orbSpill: Color(0xFF000D4C),
    orbHaze: Color(0xFF0033CC),
    orbMid: Color(0xFF0099FF),
    orbCore: Color(0xFFB2F2FF),
  );

  static const dark = AppColors(
    coral: kCoral,
    coralWarm: kCoralWarm,
    textHighEmphasis: kTextHi,
    textMidEmphasis: kTextMid,
    textLowEmphasis: kTextLow,
    surfaceGlassFill: Color(0x29FFFFFF),
    surfaceGlassBorder: Color(0x33FFFFFF),
    surfaceGlassHighlight: Color(0x0DFFFFFF),
    orbSpill: Color(0xFF000D4C),
    orbHaze: Color(0xFF0033CC),
    orbMid: Color(0xFF0099FF),
    orbCore: Color(0xFFB2F2FF),
  );

  @override
  AppColors copyWith({
    Color? coral,
    Color? coralWarm,
    Color? textHighEmphasis,
    Color? textMidEmphasis,
    Color? textLowEmphasis,
    Color? surfaceGlassFill,
    Color? surfaceGlassBorder,
    Color? surfaceGlassHighlight,
    Color? orbSpill,
    Color? orbHaze,
    Color? orbMid,
    Color? orbCore,
  }) {
    return AppColors(
      coral: coral ?? this.coral,
      coralWarm: coralWarm ?? this.coralWarm,
      textHighEmphasis: textHighEmphasis ?? this.textHighEmphasis,
      textMidEmphasis: textMidEmphasis ?? this.textMidEmphasis,
      textLowEmphasis: textLowEmphasis ?? this.textLowEmphasis,
      surfaceGlassFill: surfaceGlassFill ?? this.surfaceGlassFill,
      surfaceGlassBorder: surfaceGlassBorder ?? this.surfaceGlassBorder,
      surfaceGlassHighlight: surfaceGlassHighlight ?? this.surfaceGlassHighlight,
      orbSpill: orbSpill ?? this.orbSpill,
      orbHaze: orbHaze ?? this.orbHaze,
      orbMid: orbMid ?? this.orbMid,
      orbCore: orbCore ?? this.orbCore,
    );
  }

  @override
  AppColors lerp(ThemeExtension<AppColors>? other, double t) {
    if (other is! AppColors) return this;
    return AppColors(
      coral: Color.lerp(coral, other.coral, t)!,
      coralWarm: Color.lerp(coralWarm, other.coralWarm, t)!,
      textHighEmphasis: Color.lerp(textHighEmphasis, other.textHighEmphasis, t)!,
      textMidEmphasis: Color.lerp(textMidEmphasis, other.textMidEmphasis, t)!,
      textLowEmphasis: Color.lerp(textLowEmphasis, other.textLowEmphasis, t)!,
      surfaceGlassFill: Color.lerp(surfaceGlassFill, other.surfaceGlassFill, t)!,
      surfaceGlassBorder: Color.lerp(surfaceGlassBorder, other.surfaceGlassBorder, t)!,
      surfaceGlassHighlight: Color.lerp(surfaceGlassHighlight, other.surfaceGlassHighlight, t)!,
      orbSpill: Color.lerp(orbSpill, other.orbSpill, t)!,
      orbHaze: Color.lerp(orbHaze, other.orbHaze, t)!,
      orbMid: Color.lerp(orbMid, other.orbMid, t)!,
      orbCore: Color.lerp(orbCore, other.orbCore, t)!,
    );
  }
}

// ── GlassTheme (blur sigma consolidation) ──

/// Frozen-glass visual parameters — blur, fill, border, and shadow config.
///
/// Consolidates the previously-inconsistent blur sigmas (18 vs 24) into a
/// single configurable value (default 20) so all glass widgets share one
/// blur intensity. Provides preset configurations via [glassLight].
///
/// Behavior: Value object holding all visual parameters for glass surfaces.
/// Does not own widget-tree logic or rendering — those are in [GlassSurface]
/// and [GlassPill].
class GlassTheme {
  final double blurSigma;
  final Color fillColor;
  final Color borderColor;
  final Color highlightColor;
  final List<BoxShadow> outerShadows;

  const GlassTheme({
    this.blurSigma = 20.0,
    this.fillColor = const Color(0x29FFFFFF),
    this.borderColor = const Color(0x33FFFFFF),
    this.highlightColor = const Color(0x0DFFFFFF),
    this.outerShadows = _defaultShadows,
  });

  static const _defaultShadows = [
    BoxShadow(
      color: Color(0x1A000000),
      blurRadius: 10,
      offset: Offset(0, 4),
    ),
  ];

  static const glassLight = GlassTheme(blurSigma: 20.0);
}

// ── Extension getter ──

/// Convenience getter for [AppColors] from the current [BuildContext].
///
/// Behavior: Looks up the [AppColors] ThemeExtension from the nearest
/// [Theme]. Returns [AppColors.dark] as a safe fallback if no extension
/// is registered (avoids null crashes during theme transitions).
///
/// Returns: [AppColors] — the resolved color tokens for the current theme.
extension AppColorsContext on BuildContext {
  AppColors get appColors => Theme.of(this).extension<AppColors>() ?? AppColors.dark;
}
