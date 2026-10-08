import 'package:flutter/material.dart';

import '../../widgets/glass_surface.dart';
import '../../widgets/theme.dart';

/// Empty placeholder for the history tab.
///
/// Displays a centered icon and instructional text when no past sessions
/// exist. Currently a stub — will be wired to session storage when the
/// history feature is implemented.
class HistoryView extends StatelessWidget {
  const HistoryView({super.key});

  @override
  /// Builds the history placeholder view.
  ///
  /// Behavior: Renders a centered column with a history icon inside a
  /// [GlassSurface], a 'No conversations yet' heading, and instructional
  /// subtext. Displayed when no past sessions exist.
  /// Returns: The history placeholder widget.
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 48),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            GlassSurface(
              borderRadius: BorderRadius.circular(22),
              padding: const EdgeInsets.all(20),
              child: Icon(
                Icons.history_rounded,
                size: 28,
                color: context.appColors.textMidEmphasis,
              ),
            ),
            const SizedBox(height: 22),
            Text(
              'No conversations yet',
              style: TextStyle(
                color: context.appColors.textHighEmphasis,
                fontSize: 17,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Your voice sessions with Koda will\nappear here.',
              textAlign: TextAlign.center,
              style: TextStyle(color: context.appColors.textLowEmphasis, fontSize: 14, height: 1.5),
            ),
          ],
        ),
      ),
    );
  }
}
