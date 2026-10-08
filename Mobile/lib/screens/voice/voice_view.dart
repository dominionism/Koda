import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart';

import '../../services/voice_service.dart';
import '../../widgets/koda_orb.dart';
import '../../widgets/liquid_glass_button.dart';
import '../../widgets/pill_command_dock.dart';
import '../../widgets/voice_hero_button.dart';
import 'context_area.dart';

/// Value object that bundles all presentation parameters for [VoiceView].
///
/// A Config Object pattern replacing a 15-parameter constructor. Aggregates
/// orb state, connection state, level, status label, callbacks, text input
/// controllers, and keyboard state into one immutable value.
class VoiceViewConfig {
  final KodaOrbState orbState;
  final KodaConnectionState connectionState;
  final double level;
  final String statusLabel;
  final VoidCallback onTalk;
  final VoidCallback onTextSubmit;
  final bool keyboardOpen;
  final VoidCallback onToggleKeyboard;
  final TextEditingController textController;
  final FocusNode textFocus;
  final bool sendingText;

  /// Creates a [VoiceViewConfig] with all presentation parameters.
  ///
  /// All fields are required — the Config Object pattern replaces a
  /// 15-parameter positional constructor at the call site.
  /// Params: Each named parameter corresponds to a presentation value.
  const VoiceViewConfig({
    required this.orbState,
    required this.connectionState,
    required this.level,
    required this.statusLabel,
    required this.onTalk,
    required this.onTextSubmit,
    required this.keyboardOpen,
    required this.onToggleKeyboard,
    required this.textController,
    required this.textFocus,
    required this.sendingText,
  });
}

/// Main voice view — assembles the orb, command dock, status label, and context area.
///
/// Receives all presentation parameters via [VoiceViewConfig]. Owns the
/// vertical layout of the orb hero, status caption, and the pill command
/// dock. Does not handle any service lifecycle or state derivation —
/// those live in [VoiceScreen].
class VoiceView extends StatelessWidget {
  const VoiceView({super.key, required this.config});

  final VoiceViewConfig config;

  @override
  /// Builds the voice view layout.
  ///
  /// Behavior: Assembles the orb hero, status caption, action prompt,
  /// context area, and voice/text input section into a centered [Column]
  /// layout. When the keyboard opens, the surrounding [Spacer] flex values
  /// reflow while the orb size stays constant. The text input uses a
  /// [PillCommandDock]; the voice mode uses a [VoiceHeroButton].
  /// Returns: The voice view widget tree.
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    final isTextMode = config.keyboardOpen || bottomInset > 0;

    return Column(
      children: [
        Spacer(flex: isTextMode ? 1 : 2),
        // The orb is the hero element and holds a constant size across voice
        // and text modes — only the surrounding Spacers reflow to make room
        // for the keyboard, never the orb itself.
        SizedBox(
          width: 220,
          height: 220,
          child: KodaOrb(state: config.orbState, level: config.level),
        ),
        const SizedBox(height: 40),
        AnimatedDefaultTextStyle(
          duration: const Duration(milliseconds: 220),
          style: const TextStyle(
            color: Color(0xFF8FA9C8), // Muted gray-blue
            fontSize: 14,
            fontWeight: FontWeight.w500,
          ),
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 250),
            switchInCurve: Curves.easeOutCubic,
            switchOutCurve: Curves.easeOutCubic,
            child: Text(
              config.statusLabel,
              key: ValueKey(config.statusLabel),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ),
        const SizedBox(height: 12),
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 24),
          child: Text(
            'What should we work on?',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Colors.white,
              fontSize: 28,
              fontWeight: FontWeight.w600,
              height: 1.2,
            ),
          ),
        ),
        const SizedBox(height: 24),
        ContextArea(orbState: config.orbState),
        Spacer(flex: isTextMode ? 1 : 3),
        if (isTextMode)
          PillCommandDock(
            state: config.connectionState,
            orbState: config.orbState,
            onTalk: config.onTalk,
            onVoice: config.onToggleKeyboard,
            textController: config.textController,
            textFocus: config.textFocus,
            sendingText: config.sendingText,
            onSubmit: config.onTextSubmit,
            hintText: 'Message Koda…',
          )
        else
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            // The SizedBox forces the Stack to claim the full row width;
            // without it the Stack shrink-wraps to the talk circle and the
            // Positioned keyboard lands on top of it.
            child: SizedBox(
              width: double.infinity,
              height: kVoiceHeroButtonSize,
              child: Stack(
                alignment: Alignment.center,
                clipBehavior: Clip.none,
                children: [
                  // Voice is the hero control: a breathing glass orb button.
                  VoiceHeroButton(
                    onPressed: config.onTalk,
                    live:
                        config.connectionState == KodaConnectionState.connected,
                  ),
                  // Keyboard is a quiet satellite — present, never competing.
                  Positioned(
                    right: 0,
                    child: LiquidGlassButton(
                      onPressed: config.onToggleKeyboard,
                      size: LiquidGlassButtonSize.icon,
                      variant: LiquidGlassButtonVariant.ghost,
                      child: Icon(
                        CupertinoIcons.keyboard,
                        size: 20,
                        color: Colors.white.withValues(alpha: 0.8),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        const SizedBox(height: 24),
      ],
    );
  }
}
