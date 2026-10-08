import 'package:flutter/material.dart';

import 'theme.dart';

import 'labeled_field.dart';
import 'sheet_wrapper.dart';

/// LiveKit connection settings sheet — URL and token form.
///
/// Contains form fields for the LiveKit endpoint and access token inside a
/// [GlassSheet] wrapper. Owns the connection form state but delegates the
/// actual connection lifecycle to [LiveKitService]. Uses [LabeledField]
/// for the form inputs and [GlassSheet] for the bottom-sheet chrome.
class SettingsSheet extends StatefulWidget {
  const SettingsSheet({
    super.key,
    required this.serverUrl,
    required this.url,
    required this.token,
    required this.connected,
  });

  final TextEditingController serverUrl;
  final TextEditingController url;
  final TextEditingController token;
  final bool connected;
  @override
  State<SettingsSheet> createState() => _SettingsSheetState();
}

class _SettingsSheetState extends State<SettingsSheet> {
  @override
  Widget build(BuildContext context) {
    return GlassSheet(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Connection',
            style: TextStyle(
              color: context.appColors.textHighEmphasis,
              fontSize: 18,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'LiveKit endpoint and access token.',
            style: TextStyle(color: context.appColors.textLowEmphasis, fontSize: 13),
          ),
          const SizedBox(height: 20),
          LabeledField(
            label: 'Token Server',
            controller: widget.serverUrl,
            hint: 'http://localhost:8800',
            enabled: !widget.connected,
          ),
          const SizedBox(height: 16),
          LabeledField(
            label: 'LiveKit URL',
            controller: widget.url,
            hint: 'ws://localhost:7880',
            enabled: !widget.connected,
          ),
          const SizedBox(height: 16),
          LabeledField(
            label: 'Access token',
            controller: widget.token,
            hint: 'auto-fetched if blank',
            enabled: !widget.connected,
            maxLines: 3,
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: () => Navigator.of(context).maybePop(),
            style: FilledButton.styleFrom(
              backgroundColor: context.appColors.coral,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: const StadiumBorder(),
              textStyle: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.3,
              ),
            ),
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }
}
