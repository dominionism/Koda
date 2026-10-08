import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import 'glass_pill.dart';

/// Diameter of the hero circle. Exposed so layouts can reserve its height.
const kVoiceHeroButtonSize = 80.0;

/// The voice-first hero control: a clean frosted-glass circle.
///
/// Built on [GlassPill] — a circle is simply a pill whose width equals its
/// height — so the talk button shares the exact glass recipe of the command
/// dock: neutral blue-gray tint, backdrop blur, hairline border, top-edge
/// highlight, and soft ambient shadows. No colored gradients or glows; the
/// button earns its hierarchy through size alone. Press feedback is a scale
/// dip; [live] flips the icon to a stop affordance.
class VoiceHeroButton extends StatefulWidget {
  const VoiceHeroButton({
    super.key,
    required this.onPressed,
    required this.live,
  });

  final VoidCallback onPressed;

  /// Whether a voice session is active (shows the stop affordance).
  final bool live;

  @override
  State<VoiceHeroButton> createState() => _VoiceHeroButtonState();
}

class _VoiceHeroButtonState extends State<VoiceHeroButton> {
  bool _pressed = false;

  void _setPressed(bool value) {
    if (_pressed == value) return;
    setState(() => _pressed = value);
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: widget.live ? 'Stop voice session' : 'Talk to Koda',
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: (_) => _setPressed(true),
        onTapUp: (_) => _setPressed(false),
        onTapCancel: () => _setPressed(false),
        onTap: widget.onPressed,
        child: AnimatedScale(
          scale: _pressed ? 0.95 : 1.0,
          duration: const Duration(milliseconds: 160),
          curve: Curves.easeOutCubic,
          child: GlassPill(
            height: kVoiceHeroButtonSize,
            child: SizedBox(
              width: kVoiceHeroButtonSize,
              height: kVoiceHeroButtonSize,
              child: Center(
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 200),
                  switchInCurve: Curves.easeOutCubic,
                  switchOutCurve: Curves.easeOutCubic,
                  child: Icon(
                    widget.live
                        ? CupertinoIcons.stop_fill
                        : CupertinoIcons.waveform,
                    key: ValueKey(widget.live),
                    size: 30,
                    color: Colors.white,
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
