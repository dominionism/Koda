import 'dart:ui' show ImageFilter;
import 'package:flutter/material.dart';

import 'theme.dart';

/// Glass pill backdrop with custom-painted border highlights.
///
/// Used by the command dock and compact header for consistent pill-shaped
/// containers. Encapsulates backdrop blur, a [CustomPainter] for the
/// top-edge highlight and bottom-edge shadow, and ambient shadows. Does
/// not handle any interaction — use [LiquidGlassButton] inside the pill
/// for tappable controls.
class GlassPill extends StatelessWidget {
  const GlassPill({
    super.key,
    required this.child,
    this.height,
    this.padding,
  });

  final Widget child;
  final double? height;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(999),
        boxShadow: const [
          BoxShadow(
            color: Color(0x3300102A), // Deep soft ambient shadow
            blurRadius: 24,
            offset: Offset(0, 12),
          ),
          BoxShadow(
            color: Color(0x1A000000), // Core shadow
            blurRadius: 8,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(999),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: GlassTheme.glassLight.blurSigma, sigmaY: GlassTheme.glassLight.blurSigma),
          child: Stack(
            alignment: Alignment.center,
            children: [
              // Background fills to match the child's size
              Positioned.fill(
                child: Container(
                  decoration: const BoxDecoration(
                    color: Color(0x1A8BA6C9), // Very subtle blue-gray tint
                  ),
                ),
              ),
              const Positioned.fill(
                child: CustomPaint(
                  painter: _GlassPillPainter(),
                ),
              ),
              // The child dictates the size of the Stack and renders on top
              padding != null
                  ? Padding(
                      padding: padding!,
                      child: child,
                    )
                  : child,
            ],
          ),
        ),
      ),
    );
  }
}

class _GlassPillPainter extends CustomPainter {
  const _GlassPillPainter();

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final rrect = RRect.fromRectAndRadius(rect, const Radius.circular(999));
    
    canvas.save();
    canvas.clipRRect(rrect);
    
    // Soft inner highlight near the top edge
    final topHighlightPaint = Paint()
      ..color = const Color(0x40FFFFFF)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;
    canvas.drawRRect(rrect.shift(const Offset(0, 1.0)), topHighlightPaint);
    
    canvas.restore();
    
    // Thin border with subtle white/blue opacity
    final borderPaint = Paint()
      ..color = const Color(0x26FFFFFF)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;
    canvas.drawRRect(rrect, borderPaint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
