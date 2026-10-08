import 'package:flutter/material.dart';

// ── Backdrop color palette ──
// Top glow is deliberately weaker than the bottom one: the orb must stay the
// brightest element on screen, while the bottom glow anchors the talk button.
const _baseNavy = Color(0xFF030816);
const _hazeBlue = Color(0x66103478);
const _hazeBlueTransparent = Color(0x00103478);
const _topGlow = Color(0x383273D1);
const _topGlowMid = Color(0x1C184082);
const _bottomGlow = Color(0x4D3273D1);
const _bottomGlowMid = Color(0x26184082);
const _glowFade = Color(0x00030816);

/// Near-black background with a soft blue halo behind the orb.
///
/// Composes three stacked gradient layers: a deep navy base, a radial blue
/// haze centered behind the orb position, and a bottom-up blue glow. Owns
/// only the background decoration — does not contain any interactive
/// elements or foreground content.
class VoiceBackdrop extends StatelessWidget {
  const VoiceBackdrop({super.key});

  @override
  /// Builds the voice backdrop with layered gradient glows.
  ///
  /// Behavior: Stacks four full-screen gradient layers: a deep navy base,
  /// a radial blue haze centered behind the orb, a top-down blue glow, and
  /// a bottom-up blue glow. The bottom glow is intentionally stronger to
  /// anchor the talk button while keeping the orb as the brightest element.
  /// Returns: The backdrop widget (non-interactive decoration).
  Widget build(BuildContext context) {
    return Stack(
      children: [
        // 1. Deep cinematic base (near-black / deep navy)
        const DecoratedBox(
          decoration: BoxDecoration(color: _baseNavy),
          child: SizedBox.expand(),
        ),
        // Middle radial blue haze behind orb
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: RadialGradient(
              center: Alignment(0.0, -0.2), // Roughly behind the orb
              radius: 0.8,
              colors: [
                _hazeBlue,
                _hazeBlueTransparent,
                Color(0x00103478),
              ],
            ),
          ),
          child: SizedBox.expand(),
        ),
        // Top soft blue glow falling downward
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                _topGlow,
                _topGlowMid,
                _glowFade,
              ],
              stops: [0.0, 0.12, 0.35],
            ),
          ),
          child: SizedBox.expand(),
        ),
        // Bottom soft blue glow rising upward, behind the talk button
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.bottomCenter,
              end: Alignment.topCenter,
              colors: [
                _bottomGlow,
                _bottomGlowMid,
                _glowFade,
              ],
              stops: [0.0, 0.18, 0.45],
            ),
          ),
          child: SizedBox.expand(),
        ),
      ],
    );
  }
}
