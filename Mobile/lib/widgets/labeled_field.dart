import 'package:flutter/material.dart';

import 'theme.dart';

/// Reusable labeled form field with uppercase label and hint.
///
/// Combines an uppercase-styled label above a TextField with configurable
/// hint text, enabled state, max lines, and focused border color.
/// Extracted from [SettingsSheet] because the same field pattern would
/// be needed for future auth, profile, or configuration forms.
class LabeledField extends StatelessWidget {
  const LabeledField({
    super.key,
    required this.label,
    required this.controller,
    required this.hint,
    required this.enabled,
    this.maxLines = 1,
  });

  final String label;
  final TextEditingController controller;
  final String hint;
  final bool enabled;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label.toUpperCase(),
          style: TextStyle(
            color: context.appColors.textLowEmphasis,
            fontSize: 11,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.8,
          ),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: controller,
          enabled: enabled,
          maxLines: maxLines,
          style: TextStyle(color: context.appColors.textHighEmphasis, fontSize: 14),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: TextStyle(color: context.appColors.textLowEmphasis),
            isDense: true,
            filled: true,
            fillColor: Colors.white.withValues(alpha: 0.05),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 14,
              vertical: 12,
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide(
                color: Colors.white.withValues(alpha: 0.10),
              ),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide(color: context.appColors.coral.withValues(alpha: 0.6)),
            ),
            disabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide(
                color: Colors.white.withValues(alpha: 0.05),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
