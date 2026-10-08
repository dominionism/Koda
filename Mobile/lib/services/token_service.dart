import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

/// Response from the Koda dev token endpoint.
///
/// Mirrors the JSON shape returned by `Server/web/serve.py`:
/// ```json
/// { "token": "<livekit-jwt>", "url": "ws://host:7880" }
/// ```
@immutable
class TokenResponse {
  final String token;
  final String url;

  const TokenResponse({required this.token, required this.url});

  /// Creates a [TokenResponse] from a parsed JSON map.
  ///
  /// Behavior: Extracts 'token' and 'url' string values from [json].
  /// Expects the shape returned by the Koda dev token endpoint.
  /// Params:
  /// - [json]: A map with 'token' and 'url' string keys
  /// Returns: A new [TokenResponse] instance.
  factory TokenResponse.fromJson(Map<String, dynamic> json) => TokenResponse(
        token: json['token'] as String,
        url: json['url'] as String,
      );
}

/// Fetches LiveKit join tokens from Koda's dev token endpoint.
///
/// The dev server (`Server/web/serve.py`) serves a `/token` endpoint that
/// mints a LiveKit JWT from the server-side API key/secret. This service
/// abstracts that fetch so [VoiceScreen] can auto-configure without the
/// user manually pasting a token.
///
/// In production this would hit a proper auth endpoint; for dev the token
/// endpoint is an unauthenticated helper running alongside the gateway.
class TokenService {
  final HttpClient Function() _clientFactory;

  TokenService({HttpClient Function()? clientFactory})
      : _clientFactory = clientFactory ?? HttpClient.new;

  /// Fetches a token from the given server URL.
  ///
  /// [serverUrl] is the base URL of the token server, e.g.
  /// `http://localhost:8800`. Returns a [TokenResponse] with the LiveKit
  /// URL and JWT, or throws on failure.
  Future<TokenResponse> fetchToken(String serverUrl) async {
    final client = _clientFactory();
    try {
      final uri = Uri.parse('$serverUrl/token');
      final request = await client.getUrl(uri);
      final response = await request.close();

      if (response.statusCode != 200) {
        final body = await response.transform(utf8.decoder).join();
        throw HttpException(
          'Token fetch failed (${response.statusCode}): $body',
        );
      }

      final json = jsonDecode(
        await response.transform(utf8.decoder).join(),
      ) as Map<String, dynamic>;
      return TokenResponse.fromJson(json);
    } finally {
      client.close();
    }
  }
}
