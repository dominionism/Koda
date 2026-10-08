import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../services/voice_service.dart';
import 'glass_pill.dart';
import 'koda_orb.dart';
import 'liquid_glass_button.dart';

/// Floating glass command dock with action buttons and text composer.
///
/// Located at the bottom of the voice screen. Renders a leading
/// voice-return button (back to the voice-first layout), a text input
/// field, and a connection-aware trailing action inside a [GlassPill]
/// container. Does not handle the voice service lifecycle — receives
/// state via [KodaConnectionState] parameter.
class PillCommandDock extends StatelessWidget {
  const PillCommandDock({
    super.key,
    required this.state,
    required this.orbState,
    required this.onTalk,
    required this.onVoice,
    required this.textController,
    required this.textFocus,
    required this.sendingText,
    required this.onSubmit,
    required this.hintText,
  });

  final KodaConnectionState state;
  final KodaOrbState orbState;
  final VoidCallback onTalk;

  /// Exits text mode back to the voice-first layout.
  final VoidCallback onVoice;
  final TextEditingController textController;
  final FocusNode textFocus;
  final bool sendingText;
  final VoidCallback onSubmit;
  final String hintText;

  @override
  Widget build(BuildContext context) {
    final processing = orbState == KodaOrbState.processing;
    final connected = state == KodaConnectionState.connected;
    final hasText = textController.text.trim().isNotEmpty;

    IconData actionIcon;
    VoidCallback? actionCallback;

    if (sendingText) {
      actionIcon = CupertinoIcons.arrow_up;
      actionCallback = null;
    } else if (hasText) {
      actionIcon = CupertinoIcons.arrow_up;
      actionCallback = onSubmit;
    } else if (connected) {
      actionIcon = CupertinoIcons.stop_fill;
      actionCallback = onTalk;
    } else {
      // Empty composer: send stays visible but disabled until text exists.
      actionIcon = CupertinoIcons.arrow_up;
      actionCallback = null;
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: GlassPill(
        height: 56, // Reduced height for elegance
        padding: const EdgeInsets.only(left: 10, right: 10),
        child: Row(
          children: [
            LiquidGlassButton(
              onPressed: onVoice,
              size: LiquidGlassButtonSize.icon,
              variant: LiquidGlassButtonVariant.ghost,
              child: Icon(
                CupertinoIcons.waveform,
                size: 20,
                color: Colors.white.withValues(alpha: 0.7),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: textController,
                focusNode: textFocus,
                enabled: !processing && !sendingText,
                minLines: 1,
                maxLines: 1,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => (hasText && !sendingText) ? onSubmit() : null,
                style: const TextStyle(
                  color: Color(0xE6FFFFFF), // White with slight opacity
                  fontSize: 16,
                  fontWeight: FontWeight.w400, // Clean, modern
                ),
                decoration: InputDecoration(
                  border: InputBorder.none,
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(vertical: 18), // Centered
                  hintText: hintText,
                  hintStyle: const TextStyle(
                    color: Color(0x80FFFFFF),
                    fontSize: 16,
                    fontWeight: FontWeight.w400,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            // Action Icon Button
            LiquidGlassButton(
              onPressed: processing ? null : actionCallback,
              size: LiquidGlassButtonSize.icon,
              variant: LiquidGlassButtonVariant.secondary,
              enabled: !processing && actionCallback != null,
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 200),
                switchInCurve: Curves.easeOutCubic,
                switchOutCurve: Curves.easeOutCubic,
                child: sendingText
                    ? const SizedBox(
                        key: ValueKey('sending'),
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : Icon(
                        actionIcon,
                        key: ValueKey(actionIcon),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

