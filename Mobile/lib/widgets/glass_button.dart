import 'package:flutter/material.dart';

import 'glass_surface.dart';

/// Tappable glass button with press-feedback animation.
///
/// Wraps [GlassSurface] with gesture detection, scale animation on press,
/// and accessibility semantics. Does not own the surface styling itself —
/// that is delegated to [GlassSurface]. For buttons with liquid-glass
/// effects (blur, gradient fill, border layering), see [LiquidGlassButton].
class GlassButton extends StatefulWidget {
  const GlassButton({
    super.key,
    required this.child,
    required this.semanticLabel,
    this.onTap,
    this.variant = GlassVariant.button,
    this.borderRadius,
    this.padding = EdgeInsets.zero,
    this.size,
  });

  final Widget child;
  final String semanticLabel;
  final VoidCallback? onTap;
  final GlassVariant variant;
  final BorderRadius? borderRadius;
  final EdgeInsets padding;
  final Size? size;

  @override
  State<GlassButton> createState() => _GlassButtonState();
}

class _GlassButtonState extends State<GlassButton> {
  bool _pressed = false;

  void _setPressed(bool value) {
    if (_pressed == value) return;
    setState(() => _pressed = value);
  }

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null;
    final child = widget.size == null
        ? widget.child
        : SizedBox.fromSize(
            size: widget.size,
            child: Center(child: widget.child),
          );

    return Semantics(
      button: true,
      enabled: enabled,
      label: widget.semanticLabel,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: enabled ? (_) => _setPressed(true) : null,
        onTapCancel: enabled ? () => _setPressed(false) : null,
        onTapUp: enabled ? (_) => _setPressed(false) : null,
        onTap: widget.onTap,
        child: AnimatedOpacity(
          duration: const Duration(milliseconds: 140),
          opacity: enabled ? 1 : 0.45,
          child: AnimatedScale(
            duration: const Duration(milliseconds: 140),
            curve: Curves.easeOutCubic,
            scale: _pressed ? 0.96 : 1,
            child: GlassSurface(
              variant: widget.variant,
              borderRadius: widget.borderRadius,
              padding: widget.padding,
              child: child,
            ),
          ),
        ),
      ),
    );
  }
}
