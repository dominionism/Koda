import 'dart:ui' show ImageFilter;
import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart';
import 'package:google_fonts/google_fonts.dart';

import '../services/voice_service.dart';
import '../services/livekit_service.dart';
import '../services/token_service.dart';
import '../widgets/compact_header.dart';
import '../widgets/glass_pill.dart';
import '../widgets/koda_orb.dart';
import '../widgets/settings_sheet.dart';
import 'history/history_view.dart';
import 'voice/backdrop.dart';
import 'voice/voice_view.dart';

// Drawer layout constants
const _drawerBlurSigma = 24.0;
const _newChatButtonHeight = 56.0;


/// Orchestrates the voice home screen — tab layout, service lifecycle, and settings sheet.
///
/// Owns the two-tab layout (voice / history), the LiveKit service lifecycle,
/// and the settings sheet trigger. Delegates all visual rendering to child
/// widgets in [screens/voice/] and [screens/history/]. The state derivation
/// helpers [_orbState], [_orbLevel], and [_statusLabel] are pure functions
/// of [_service.state], keeping business logic out of the build method.
class VoiceScreen extends StatefulWidget {
  const VoiceScreen({super.key});

  @override
  /// Creates the mutable state for this screen.
  ///
  /// Behavior: Returns a new [_VoiceScreenState] that owns the service
  /// lifecycle (LiveKit connection), tab routing (voice / history),
  /// settings sheet trigger, and keyboard state management.
  /// Returns: The state object managing this screen's logic.
  State<VoiceScreen> createState() => _VoiceScreenState();
}

/// Manages the voice screen state — service lifecycle, tab routing,
/// text input, keyboard state, and drawer navigation.
///
/// Behavior: Owns the [VoiceService] singleton, [TokenService] for
/// auto-fetching dev tokens, and all text input controllers. Derives
/// orb state, audio level, and status label as pure functions of
/// [_service.state]. Builds the two-tab layout (voice / history) with
/// an [AnimatedSwitcher], a drawer for navigation, and a modal bottom
/// sheet for settings.
class _VoiceScreenState extends State<VoiceScreen> {
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();
  final VoiceService _service = LiveKitService();
  final TokenService _tokenService = TokenService();
  final TextEditingController _url = TextEditingController(
    text: const String.fromEnvironment(
      'LIVEKIT_URL',
      defaultValue: 'ws://localhost:7880',
    ),
  );
  final TextEditingController _token = TextEditingController(
    text: const String.fromEnvironment('LIVEKIT_TOKEN'),
  );
  final TextEditingController _serverUrl = TextEditingController(
    text: const String.fromEnvironment(
      'TOKEN_SERVER_URL',
      defaultValue: 'http://localhost:8800',
    ),
  );

  final TextEditingController _text = TextEditingController();
  final FocusNode _textFocus = FocusNode();
  bool _keyboardOpen = false;
  bool _sendingText = false;

  int _tab = 0; // 0 = Voice, 1 = History

  @override
  void initState() {
    super.initState();
    _service.addListener(_rebuild);
    _text.addListener(_rebuild);
  }

  @override
  void dispose() {
    _service
      ..removeListener(_rebuild)
      ..dispose();
    _url.dispose();
    _token.dispose();
    _serverUrl.dispose();
    _text.removeListener(_rebuild);
    _text.dispose();
    _textFocus.dispose();
    super.dispose();
  }

  /// Triggers a widget rebuild when the service state changes.
  ///
  /// Behavior: Calls [setState] if the widget is still mounted.
  /// Registered as a listener on [_service] and [_text] in [initState].
  void _rebuild() {
    if (mounted) setState(() {});
  }

  /// Toggles the LiveKit connection state.
  ///
  /// Behavior: If connected or connecting, disconnects. If disconnected
  /// or failed, attempts to connect (auto-fetching a token if needed).
  Future<void> _toggle() async {
    switch (_service.state) {
      case KodaConnectionState.connected:
      case KodaConnectionState.connecting:
        await _service.disconnect();
      case KodaConnectionState.disconnected:
      case KodaConnectionState.failed:
        if (!await _connectIfNeeded()) return;
    }
  }

  /// Ensures a LiveKit connection, auto-fetching a token if needed.
  ///
  /// Behavior: No-op if already connected. If [_token] is empty, tries
  /// [_tokenService.fetchToken] to auto-configure from the dev token
  /// server. On token fetch failure, opens the settings sheet for manual
  /// entry. Otherwise connects via [_service.connect].
  /// Returns: True if connected after the attempt, false otherwise.
  Future<bool> _connectIfNeeded() async {
    if (_service.state == KodaConnectionState.connected) return true;

    // No token configured yet — try auto-fetching from the dev token server,
    // then fall back to the settings sheet for manual entry.
    if (_token.text.trim().isEmpty) {
      try {
        final tk = await _tokenService.fetchToken(_serverUrl.text.trim());
        _url.text = tk.url;
        _token.text = tk.token;
      } catch (error) {
        // Token server not reachable — guide the user to settings
        debugPrint('Token fetch failed: $error');
        _openSettings();
        return false;
      }
    }

    await _service.connect(url: _url.text.trim(), token: _token.text.trim());
    return _service.state == KodaConnectionState.connected;
  }

  /// Sends a text message through the connected service.
  ///
  /// Behavior: Ensures a connection first, then delegates to
  /// [_service.sendText].
  /// Params:
  /// - [text]: The message string to send.
  /// Returns: True if the message was sent, false if connection failed.
  Future<bool> _sendText(String text) async {
    if (!await _connectIfNeeded()) return false;
    await _service.sendText(text);
    return true;
  }

  /// Submits the current text input as a message and clears the field.
  ///
  /// Behavior: Guards against empty messages and concurrent sends. Calls
  /// [_sendText], clears the text controller, and hides the keyboard on
  /// success. Resets [_sendingText] in a finally block regardless of
  /// outcome.
  Future<void> _submitText() async {
    final message = _text.text.trim();
    if (message.isEmpty || _sendingText) return;

    setState(() => _sendingText = true);
    try {
      final sent = await _sendText(message);
      if (!mounted || !sent) return;
      _text.clear();
      _textFocus.unfocus();
      setState(() => _keyboardOpen = false);
    } finally {
      if (mounted) setState(() => _sendingText = false);
    }
  }

  /// Toggles the keyboard visibility for text input.
  ///
  /// Behavior: Flips [_keyboardOpen]. When closing, unfocuses the text
  /// field immediately. When opening, requests focus after the current
  /// frame completes via post-frame callback to ensure the widget tree
  /// is laid out before the keyboard animation.
  void _toggleKeyboard() {
    setState(() => _keyboardOpen = !_keyboardOpen);
    if (!_keyboardOpen) {
      _textFocus.unfocus();
    } else {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _textFocus.requestFocus();
      });
    }
  }

  @override
  /// Builds the main voice screen layout.
  ///
  /// Behavior: Renders a [Scaffold] with a full-screen [VoiceBackdrop],
  /// a [CompactHeader], and an [AnimatedSwitcher] that toggles between
  /// [VoiceView] (tab 0) and [HistoryView] (tab 1). The drawer provides
  /// tab navigation and access to the settings sheet. Animations respect
  /// [MediaQuery.disableAnimations].
  /// Returns: The voice screen widget tree.
  Widget build(BuildContext context) {
    final reduced = MediaQuery.of(context).disableAnimations;
    return Scaffold(
      key: _scaffoldKey,
      drawer: _buildDrawer(),
      body: Stack(
        children: [
          const VoiceBackdrop(),
          SafeArea(
            child: Column(
              children: [
                const SizedBox(height: 24),
                CompactHeader(
                  onMenu: () => _scaffoldKey.currentState?.openDrawer(),
                ),
                Expanded(
                  child: AnimatedSwitcher(
                    duration: Duration(milliseconds: reduced ? 0 : 350),
                    switchInCurve: Curves.easeOutCubic,
                    switchOutCurve: Curves.easeInCubic,
                    child: _tab == 0
                        ? VoiceView(
                            key: const ValueKey('voice'),
                            config: VoiceViewConfig(
                              orbState: _orbState(),
                              connectionState: _service.state,
                              level: _orbLevel(),
                              statusLabel: _statusLabel(),
                              onTalk: _toggle,
                              onTextSubmit: _submitText,
                              keyboardOpen: _keyboardOpen,
                              onToggleKeyboard: _toggleKeyboard,
                              textController: _text,
                              textFocus: _textFocus,
                              sendingText: _sendingText,
                            ),
                          )
                        : const HistoryView(key: ValueKey('history')),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ---- state derivation ---------------------------------------------------

  /// Derives the visual orb state from the current connection state.
  ///
  /// Behavior: Maps [_service.state] to [KodaOrbState]. When connected,
  /// further distinguishes speaking vs listening via
  /// [_service.agentSpeaking].
  /// Returns: The [KodaOrbState] for the current connection.
  KodaOrbState _orbState() {
    switch (_service.state) {
      case KodaConnectionState.connected:
        return _service.agentSpeaking
            ? KodaOrbState.speaking
            : KodaOrbState.listening;
      case KodaConnectionState.connecting:
        return KodaOrbState.processing;
      case KodaConnectionState.disconnected:
        return KodaOrbState.idle;
      case KodaConnectionState.failed:
        return KodaOrbState.error;
    }
  }

  /// Derives the orb audio level from the current orb state.
  ///
  /// Behavior: Returns [_service.agentAudioLevel] when the agent is
  /// speaking, [_service.localAudioLevel] when listening, and 0.0 for
  /// idle/processing/error states.
  /// Returns: An audio level between 0.0 and 1.0.
  double _orbLevel() => switch (_orbState()) {
    KodaOrbState.speaking => _service.agentAudioLevel,
    KodaOrbState.listening => _service.localAudioLevel,
    KodaOrbState.idle || KodaOrbState.processing || KodaOrbState.error => 0.0,
  };

  /// Derives the human-readable status label from the current connection.
  ///
  /// Behavior: Maps each [KodaConnectionState] to a user-facing string.
  /// Uses [_service.error] when in the failed state for a more descriptive
  /// message, with a fallback hint to retry.
  /// Returns: The status label string for display.
  String _statusLabel() {
    switch (_service.state) {
      case KodaConnectionState.connected:
        return _service.agentSpeaking ? 'Koda is speaking' : 'Koda is listening';
      case KodaConnectionState.connecting:
        return 'Connecting to Koda...';
      case KodaConnectionState.failed:
        return _service.error ?? 'Connection failed — tap to retry';
      case KodaConnectionState.disconnected:
        return 'Ready when you are';
    }
  }

  /// Opens the settings sheet as a modal bottom sheet.
  ///
  /// Behavior: Shows a [SettingsSheet] with the server URL, LiveKit URL,
  /// token text controllers, and the current connection state. The sheet
  /// has a transparent background and is scroll-controlled.
  void _openSettings() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (_) => SettingsSheet(
        serverUrl: _serverUrl,
        url: _url,
        token: _token,
        connected: _service.state == KodaConnectionState.connected,
      ),
    );
  }

  /// Builds the drawer with navigation tabs and a new-chat button.
  ///
  /// Behavior: Renders a full-width glassmorphism drawer with a
  /// [BackdropFilter] blur, Voice/History navigation tabs via
  /// [_buildMenuTile], a settings button at the bottom, and a
  /// [GlassPill] new-chat button positioned at the bottom right.
  /// Returns: The drawer widget.
  Widget _buildDrawer() {
    return Drawer(
      width: MediaQuery.of(context).size.width,
      backgroundColor: const Color(0xFF0F172A).withValues(alpha: 0.8), // Slate 900 with opacity
      child: ClipRect(
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: _drawerBlurSigma, sigmaY: _drawerBlurSigma),
          child: SafeArea(
            child: Stack(
              fit: StackFit.expand,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Top header: Close toggle
                    Padding(
                      padding: const EdgeInsets.only(left: 24, top: 24, bottom: 32),
                      child: IconButton(
                        onPressed: () => Navigator.pop(context),
                        icon: const Icon(CupertinoIcons.sidebar_left, color: Colors.white, size: 24),
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(),
                        splashRadius: 24,
                      ),
                    ),
                    
                    // Main Navigation
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: Column(
                        children: [
                          _buildMenuTile(
                            icon: CupertinoIcons.mic,
                            title: 'Voice',
                            selected: _tab == 0,
                            onTap: () {
                              setState(() => _tab = 0);
                              Navigator.pop(context);
                            },
                          ),
                          const SizedBox(height: 8),
                          _buildMenuTile(
                            icon: CupertinoIcons.clock,
                            title: 'History',
                            selected: _tab == 1,
                            onTap: () {
                              setState(() => _tab = 1);
                              Navigator.pop(context);
                            },
                          ),
                        ],
                      ),
                    ),
                    
                    const Spacer(),
                    const Divider(color: Colors.white24, height: 1),
                    
                    // Settings at the bottom
                    Padding(
                      padding: const EdgeInsets.only(left: 12, right: 12, top: 16, bottom: 24),
                      child: _buildMenuTile(
                        icon: CupertinoIcons.settings,
                        title: 'Settings',
                        selected: false,
                        fontSize: 16, // slightly smaller for settings
                        onTap: () {
                          Navigator.pop(context);
                          _openSettings();
                        },
                      ),
                    ),
                  ],
                ),
                
                // Bottom Right "New Chat" Button
                Positioned(
                  bottom: 24,
                  right: 24,
                  child: GestureDetector(
                    onTap: () {
                      setState(() => _tab = 0);
                      Navigator.pop(context);
                    },
                    child: GlassPill(
                      height: _newChatButtonHeight, // matches PillCommandDock height
                      padding: const EdgeInsets.symmetric(horizontal: 24),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(CupertinoIcons.add, color: Colors.white, size: 20),
                          const SizedBox(width: 8),
                          Text(
                            'New Chat',
                            style: GoogleFonts.inter(
                              color: Colors.white,
                              fontSize: 16,
                              fontWeight: FontWeight.w500,
                              letterSpacing: 0.2,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// Builds a single navigation menu tile for the drawer.
  ///
  /// Behavior: Renders a [ListTile] with an icon, title text styled with
  /// Inter font, rounded shape, and a semi-transparent selection highlight.
  /// Params:
  /// - [icon]: The icon to display.
  /// - [title]: The label text.
  /// - [selected]: Whether this tile is currently selected.
  /// - [onTap]: Callback when the tile is tapped.
  /// - [fontSize]: Font size for the title (default 22).
  /// Returns: The menu tile widget.
  Widget _buildMenuTile({
    required IconData icon,
    required String title,
    required bool selected,
    required VoidCallback onTap,
    double fontSize = 22,
  }) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      leading: Icon(icon, color: Colors.white, size: 24),
      title: Text(
        title,
        style: GoogleFonts.inter(
          color: Colors.white,
          fontSize: fontSize,
          fontWeight: FontWeight.w300,
          letterSpacing: 0.5,
        ),
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      selected: selected,
      selectedTileColor: Colors.white.withValues(alpha: 0.1),
      onTap: onTap,
    );
  }
}
