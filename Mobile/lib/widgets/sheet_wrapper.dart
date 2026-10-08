import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';

import 'theme.dart';

/// Reusable glass bottom-sheet wrapper with grabber and blur backdrop.
///
/// Provides the shared chrome for all bottom sheets in the app: a grabber
/// handle, blurred glass background, and consistent padding. Currently
/// used by [SettingsSheet] but designed for reuse by future sheets
/// (settings panels, confirmation dialogs, etc.).
class GlassSheet extends StatelessWidget {
  const GlassSheet({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottomInset),
      child: ClipRRect(
        borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: GlassTheme.glassLight.blurSigma, sigmaY: GlassTheme.glassLight.blurSigma),
          child: Container(
            decoration: BoxDecoration(
              color: const Color(0xFF101018).withValues(alpha: 0.86),
              border: Border(
                top: BorderSide(color: Colors.white.withValues(alpha: 0.10)),
              ),
            ),
            padding: const EdgeInsets.fromLTRB(24, 14, 24, 28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.18),
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                ),
                const SizedBox(height: 20),
                child,
              ],
            ),
          ),
        ),
      ),
    );
  }
}
