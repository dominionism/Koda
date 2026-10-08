import 'package:flutter/foundation.dart';

/// VoiceService abstraction and KodaConnectionState enum.
///
/// Transport-agnostic interface for voice communication. [VoiceScreen]
/// depends on this abstraction, not the concrete [LiveKitService], so the
/// transport can be swapped (WebSocket, mock for tests) without touching
/// UI code. The [KodaConnectionState] enum is defined here (not in
/// LiveKitService) because it is part of the interface contract. The Koda
/// prefix is intentional — it avoids collision with Flutter's [ConnectionState].
enum KodaConnectionState { disconnected, connecting, connected, failed }

abstract class VoiceService {
  /// The current connection state ([disconnected], [connecting],
  /// [connected], or [failed]).
  KodaConnectionState get state;
  /// Human-readable error description when [state] is [failed], or null.
  String? get error;
  /// Local microphone audio level (0.0–1.0).
  double get localAudioLevel;
  /// Remote agent audio level (0.0–1.0).
  double get agentAudioLevel;
  /// Whether the remote agent participant is currently speaking.
  bool get agentSpeaking;

  /// Joins a LiveKit (or compatible) voice room.
  ///
  /// [url] is the server WebSocket URL, [token] is the JWT access token.
  Future<void> connect({required String url, required String token});
  /// Sends a text message through the data channel as a fallback
  /// for the keyboard input layer.
  Future<void> sendText(String text);
  /// Disconnects from the current room and resets state.
  Future<void> disconnect();
  /// Releases all resources and disconnects. Idempotent.
  void dispose();
  /// Registers a callback invoked on state changes.
  void addListener(VoidCallback listener);
  /// Unregisters a previously-added callback.
  void removeListener(VoidCallback listener);
}
