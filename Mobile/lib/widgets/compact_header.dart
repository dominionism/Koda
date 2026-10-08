import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart';

/// Top-left circular hamburger menu button.
///
/// Triggers the app drawer which now houses navigation and settings,
/// replacing the previous tabbed layout to save space on mobile.
class CompactHeader extends StatelessWidget {
  const CompactHeader({
    super.key,
    required this.onMenu,
  });

  final VoidCallback onMenu;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.start,
        children: [
          IconButton(
            onPressed: onMenu,
            icon: const Icon(CupertinoIcons.sidebar_left, color: Colors.white, size: 24),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(),
            splashRadius: 24,
          ),
        ],
      ),
    );
  }
}
