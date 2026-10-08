import 'package:flutter/material.dart';

import '../../widgets/koda_orb.dart';

const _transitionDuration = Duration(milliseconds: 280);

/// State-driven content switcher under the orb.
///
/// Uses [AnimatedSwitcher] to cross-fade between content and empty state
/// based on [orbState]. Owns the transition animation and content routing.
class ContextArea extends StatelessWidget {
  const ContextArea({super.key, required this.orbState});

  final KodaOrbState orbState;

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: _transitionDuration,
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeInCubic,
      transitionBuilder: (child, anim) => FadeTransition(
        opacity: anim,
        child: SizeTransition(
          axisAlignment: -1.0,
          sizeFactor: anim,
          child: child,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: const SizedBox.shrink(key: ValueKey('empty')),
      ),
    );
  }
}
