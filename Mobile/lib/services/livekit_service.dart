import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:livekit_client/livekit_client.dart';

import 'voice_service.dart';

/// LiveKit room lifecycle manager implementing [VoiceService].
///
/// Owns the Room connection, participant tracking, audio level sampling,
/// and text transport over LiveKit data channels. The only concrete
/// [VoiceService] implementation in the app. Audio levels are polled via
/// room.addListener — a future optimization would debounce participant
/// changes instead of iterating every frame.
class LiveKitService extends ChangeNotifier implements VoiceService {
  Room? _room;
  EventsListener<RoomEvent>? _events;
  KodaConnectionState _state = KodaConnectionState.disconnected;
  String? _error;
  double _localAudioLevel = 0.0;
  double _agentAudioLevel = 0.0;
  bool _agentSpeaking = false;

  @override
  KodaConnectionState get state => _state;
  @override
  String? get error => _error;
  @override
  double get localAudioLevel => _localAudioLevel;
  @override
  double get agentAudioLevel => _agentAudioLevel;
  @override
  bool get agentSpeaking => _agentSpeaking;

  @override
  /// Connects to a LiveKit room with the given [url] and [token].
  ///
  /// Behavior: Creates a [Room] with speech-optimized audio options,
  /// connects to the LiveKit server, wires room event listeners, enables
  /// the local microphone and speaker output.
  /// Params:
  /// - [url]: LiveKit server WebSocket URL (e.g. ws://localhost:7880)
  /// - [token]: LiveKit JWT access token
  /// Throws: Catches connection errors internally and sets state to
  /// [KodaConnectionState.failed] with the error message.
  Future<void> connect({required String url, required String token}) async {
    if (_state == KodaConnectionState.connecting) return;
    _state = KodaConnectionState.connecting;
    _error = null;
    notifyListeners();

    try {
      final room = Room(
        roomOptions: const RoomOptions(
          adaptiveStream: true,
          dynacast: true,
          defaultAudioPublishOptions: AudioPublishOptions(
            encoding: AudioEncoding.presetSpeech,
            dtx: true,
          ),
          defaultAudioCaptureOptions: AudioCaptureOptions(
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          ),
        ),
      );
      await room.connect(url, token);

      _room = room;
      _events = room.createListener();
      _wireListeners();

      await room.localParticipant?.setMicrophoneEnabled(true);

      await room.setSpeakerOn(true, forceSpeakerOutput: true);

      _state = KodaConnectionState.connected;
      notifyListeners();
    } catch (e) {
      _state = KodaConnectionState.failed;
      _error = e.toString();
      notifyListeners();
    }
  }

  /// Wires room event listeners for audio level updates and disconnect.
  ///
  /// Behavior: Registers [_pumpAudioLevels] as a listener on the room
  /// for continuous audio level sampling. Subscribes to
  /// [RoomDisconnectedEvent] to reset all state fields when the
  /// connection drops.
  void _wireListeners() {
    final room = _room;
    final events = _events;
    if (room == null || events == null) return;

    room.addListener(_pumpAudioLevels);

    events.on<RoomDisconnectedEvent>((_) {
      _state = KodaConnectionState.disconnected;
      _localAudioLevel = 0.0;
      _agentAudioLevel = 0.0;
      _agentSpeaking = false;
      notifyListeners();
    });
  }

  /// Polls and updates local and remote audio levels each frame.
  ///
  /// Behavior: Reads the local participant's audio level and iterates
  /// all remote participants to find the highest audio level and
  /// aggregate speaking state. Called every frame via room.addListener
  /// — a future optimization would debounce participant changes.
  void _pumpAudioLevels() {
    final room = _room;
    if (room == null) return;

    _localAudioLevel = room.localParticipant?.audioLevel ?? 0.0;

    // Track the highest remote audio level and speaking state across all
    // remote participants. In a Koda room there is typically one agent
    // participant, but the loop handles multiple participants gracefully.
    var agentLevel = 0.0;
    var speaking = false;
    for (final remote in room.remoteParticipants.values) {
      if (remote.audioLevel > agentLevel) agentLevel = remote.audioLevel;
      if (remote.isSpeaking) speaking = true;
    }
    _agentAudioLevel = agentLevel;
    _agentSpeaking = speaking;
    notifyListeners();
  }

  /// Sends a typed fallback message through LiveKit's reliable data channel.
  ///
  /// Voice remains the primary path; this supports the secondary keyboard layer
  /// without introducing a separate transport.
  @override
  Future<void> sendText(String text) async {
    final room = _room;
    final participant = room?.localParticipant;
    if (_state != KodaConnectionState.connected || participant == null) {
      throw StateError('Cannot send text before joining a LiveKit room.');
    }

    final payload = jsonEncode({
      'type': 'user_message',
      'text': text,
      'sentAt': DateTime.now().toUtc().toIso8601String(),
    });

    await participant.publishData(
      utf8.encode(payload),
      reliable: true,
      topic: 'koda.text',
    );
  }

  @override
  /// Disconnects from the current LiveKit room and resets state.
  ///
  /// Behavior: Removes the audio level listener, disposes the event
  /// stream, disconnects the room, and resets all state fields to
  /// defaults. Safe to call when no room is connected (no-op).
  Future<void> disconnect() async {
    final room = _room;
    if (room == null) return;
    room.removeListener(_pumpAudioLevels);
    await _events?.dispose();
    _events = null;
    await room.disconnect();
    _room = null;
    _state = KodaConnectionState.disconnected;
    _localAudioLevel = 0.0;
    _agentAudioLevel = 0.0;
    _agentSpeaking = false;
    notifyListeners();
  }

  @override
  /// Tears down the service, disconnecting and releasing resources.
  ///
  /// Behavior: Removes listeners, disposes events, disconnects the
  /// room, and calls [super.dispose]. Idempotent — safe to call
  /// multiple times.
  void dispose() {
    final room = _room;
    if (room != null) {
      room.removeListener(_pumpAudioLevels);
      _events?.dispose();
      room.disconnect();
    }
    super.dispose();
  }
}
