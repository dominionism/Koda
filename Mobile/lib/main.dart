import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'screens/voice_screen.dart';

/// App entry point — creates and runs the [KodaApp] widget.
///
/// Behavior: Initializes the Flutter binding and mounts the root
/// [MaterialApp] widget with a dark glassmorphism theme, a color
/// scheme seeded from Koda's coral identity (#FF4570), and the Inter
/// text theme.
void main() {
  runApp(const KodaApp());
}

class KodaApp extends StatelessWidget {
  const KodaApp({super.key});

  @override
  /// Builds the root [MaterialApp] with a dark glassmorphism theme.
  ///
  /// Behavior: Returns a [MaterialApp] configured with Material 3, dark
  /// color scheme, custom scaffold background, and Inter text theme.
  /// Returns: The root [MaterialApp] widget.
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Koda',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        // Seeded from Koda's coral identity — the orb is the only saturated
        // colour in the product; everything else is neutral glass on near-black.
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFFFF4570),
          brightness: Brightness.dark,
        ),
        scaffoldBackgroundColor: const Color(0xFF07070C),
        textTheme: GoogleFonts.interTextTheme(ThemeData.dark().textTheme),
      ),
      home: const VoiceScreen(),
    );
  }
}
