import 'dart:math' as math;
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'theme.dart';

/// Visual states for the GPU-shaded voice orb.
///
/// Behavior: Controls the visual mode of [KodaOrb] — each state drives a
/// different animation pattern in the GLSL fragment shader.
///
/// Params:
///   [idle] — resting state, slow ambient pulse.
///   [listening] — active recording, responsive to audio level.
///   [speaking] — Koda is responding, outward energy.
///   [processing] — intermediate state, waiting for response.
///   [error] — red-toned override, indicates connection failure.
enum KodaOrbState { idle, listening, speaking, processing, error }

/// GLSL fragment shader orb with animated plasma flow and orbital energy mesh.
///
/// Replaced the original CustomPainter with a GPU-side FragmentShader for
/// smoother and more complex animations. The shader program is loaded from
/// an asset file (shaders/orb.frag) with uniforms driven by Dart state.
/// [KodaOrbState] controls the visual mode (idle, listening, processing,
/// speaking, error). The Koda prefix is retained here to avoid collision with
/// Flutter's built-in [ConnectionState] enum.
class KodaOrb extends StatefulWidget {
  const KodaOrb({super.key, this.state = KodaOrbState.idle, this.level = 0.0});

  /// The visual mode driving the animated shader (idle, listening, etc.).
  /// Each state maps to a different animation pattern in the GLSL shader.
  final KodaOrbState state;

  /// Normalized audio level (0.0–1.0) for responsive animations.
  /// Passed as a shader uniform to drive amplitude-based visual feedback.
  final double level;

  @override
  State<KodaOrb> createState() => _KodaOrbState();
}

class _KodaOrbState extends State<KodaOrb> with TickerProviderStateMixin {
  late final Ticker _ticker;
  // Elapsed seconds, incremented each frame (0.0 → unbounded).
  double _time = 0.0;
  FragmentProgram? _program;

  // Continuously accumulated rotation phase (0.0 → unbounded). Speed is its
  // derivative, so a state change ramps the spin smoothly instead of snapping.
  double _flowTime = 0.0;
  // Low-pass-filtered audio level [0.0, 1.0] — raw input jitters frame-to-frame.
  double _smoothLevel = 0.0;
  // Eased blend toward the error palette [0.0, 1.0] — no hard color swap.
  double _errorBlend = 0.0;

  late final AnimationController _stateController;
  late Animation<double> _stateAnimation;

  @override
  void initState() {
    super.initState();
    _loadShader();
    
    // Base duration per state-axis unit. Actual transition duration is scaled
    // by the distance crossed so interrupted or multi-unit hops never feel faster
    // than single-unit hops.
    _stateController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 550),
    );
    _stateAnimation = AlwaysStoppedAnimation(_stateToDouble(widget.state));
    _smoothLevel = widget.level.clamp(0.0, 1.0);
    _errorBlend = widget.state == KodaOrbState.error ? 1.0 : 0.0;

    _ticker = createTicker((elapsed) {
      if (!mounted) return;
      final double now = elapsed.inMicroseconds / 1000000.0;
      // Clamp dt so a paused/backgrounded ticker can't snap the integrated
      // flow phase forward when the app resumes.
      final double dt = (now - _time).clamp(0.0, 0.05);
      _time = now;

      // Low-pass the audio level. Attack faster than release so the orb feels
      // responsive to speech without flickering on every frame.
      final double targetLevel = widget.level.clamp(0.0, 1.0);
      final double levelRate = targetLevel > _smoothLevel ? 16.0 : 7.0;
      _smoothLevel +=
          (targetLevel - _smoothLevel) * (1.0 - math.exp(-levelRate * dt));

      // Ease the error-color blend instead of hard-swapping the palette.
      final double targetError = widget.state == KodaOrbState.error ? 1.0 : 0.0;
      _errorBlend +=
          (targetError - _errorBlend) * (1.0 - math.exp(-6.0 * dt));

      // Integrate the rotation phase from the current (interpolated) state so
      // speed changes stay phase-continuous across a transition.
      final double speed = _speedFor(_stateAnimation.value, _smoothLevel);
      _flowTime += dt * speed;

      setState(() {});
    });
    _ticker.start();
  }

  @override
  void didUpdateWidget(KodaOrb oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.state != widget.state) {
      final double endVal = _stateToDouble(widget.state);
      final double distance = (endVal - _stateAnimation.value).abs();
      // Scale duration proportionally so every state unit takes ~550ms —
      // prevents interrupted or multi-unit hops from animating faster than
      // normal single-unit transitions. Clamped so micro-hops aren't sluggish.
      _stateController.duration = Duration(
        milliseconds: (550 * distance).clamp(350.0, 950.0).round(),
      );
      _stateAnimation = Tween<double>(
        begin: _stateAnimation.value,
        end: endVal,
      ).animate(CurvedAnimation(
        parent: _stateController,
        curve: Curves.easeInOutSine,
      ));
      _stateController.forward(from: 0.0);
    }
  }

  /// Maps a state to its position on the orb's 1-D visual axis.
  ///
  /// Ordered to match the natural conversation flow so that every common
  /// transition is between ADJACENT positions and never sweeps the orb through
  /// an unrelated look:
  ///   idle (0) -> processing (1) -> listening (2) <-> speaking (3)
  /// [error] shares idle's calm dynamics; its red palette is blended in
  /// separately via [_errorBlend].
  double _stateToDouble(KodaOrbState state) {
    switch (state) {
      case KodaOrbState.idle:
      case KodaOrbState.error:
        return 0.0;
      case KodaOrbState.processing:
        return 1.0;
      case KodaOrbState.listening:
        return 2.0;
      case KodaOrbState.speaking:
        return 3.0;
    }
  }

  /// Rotation speed for an interpolated [stateValue] and smoothed [level].
  ///
  /// Mirrors the per-state speeds along the [_stateToDouble] axis. Kept on the
  /// Dart side so the shader's flow phase can be integrated continuously (see
  /// the ticker in [initState]) rather than computed as time × speed, which
  /// snaps the rotation forward on every state change.
  double _speedFor(double stateValue, double level) {
    const double speedIdle = 0.35;
    const double speedProcessing = 1.3;
    final double speedListening = 0.6 + level * 0.4;
    final double speedSpeaking = 0.9 + level * 1.0;
    final double s1 = stateValue.clamp(0.0, 1.0);
    final double s2 = (stateValue - 1.0).clamp(0.0, 1.0);
    final double s3 = (stateValue - 2.0).clamp(0.0, 1.0);
    double lerp(double a, double b, double t) => a + (b - a) * t;
    return lerp(
      lerp(lerp(speedIdle, speedProcessing, s1), speedListening, s2),
      speedSpeaking,
      s3,
    );
  }

  Future<void> _loadShader() async {
    try {
      final program = await FragmentProgram.fromAsset('shaders/orb.frag');
      if (mounted) {
        setState(() {
          _program = program;
        });
      }
    } catch (e) {
      // Graceful degradation: shader failure renders an empty SizedBox
      // (see build method) rather than crashing the screen.
      debugPrint('Error loading orb shader: $e');
    }
  }

  @override
  void dispose() {
    _ticker.dispose();
    _stateController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_program == null) {
      return const SizedBox();
    }
    
    return LayoutBuilder(
      builder: (context, constraints) {
        final diameter = math.min(constraints.maxWidth, constraints.maxHeight);
        final size = math.max(diameter, 24.0);
        return SizedBox(
          width: size,
          height: size,
          child: OverflowBox(
            maxWidth: size * 1.5,
            maxHeight: size * 1.5,
            child: CustomPaint(
              painter: _KodaOrbShaderPainter(
                shader: _program!.fragmentShader(),
                time: _time,
                flowTime: _flowTime,
                level: _smoothLevel,
                stateValue: _stateAnimation.value,
                errorBlend: _errorBlend,
                colors: context.appColors,
              ),
              child: Center(
                child: Semantics(
                  label: 'Koda orb ${widget.state.name}',
                  child: const SizedBox.expand(),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

// Error-state color constants (red tones override theme colors)
const Color _errorSpill = Color(0xFF4A0000);
const Color _errorHaze = Color(0xFF6B0000);
const Color _errorMid = Color(0xFF8B0000);
const Color _errorCore = Color(0xFFFF4444);

class _KodaOrbShaderPainter extends CustomPainter {
  final FragmentShader shader;
  final double time;
  final double flowTime;
  final double level;
  final double stateValue;
  final double errorBlend;
  final AppColors colors;

  _KodaOrbShaderPainter({
    required this.shader,
    required this.time,
    required this.flowTime,
    required this.level,
    required this.stateValue,
    required this.errorBlend,
    required this.colors,
  });

  @override
  void paint(Canvas canvas, Size size) {
    // Uniform contract (must match the declaration order in orb.frag):
    // 0: uResolution.x
    // 1: uResolution.y
    // 2: uTime
    // 3: uFlowTime
    // 4: uLevel
    // 5: uState
    // 6-8:   uColorSpill (rgb)
    // 9-11:  uColorHaze (rgb)
    // 12-14: uColorMid (rgb)
    // 15-17: uColorCore (rgb)
    shader.setFloat(0, size.width);
    shader.setFloat(1, size.height);
    shader.setFloat(2, time);
    shader.setFloat(3, flowTime);
    shader.setFloat(4, level);
    shader.setFloat(5, stateValue);

    // Blend the theme palette toward the error (red) palette by [errorBlend]
    // so entering/leaving the error state cross-fades instead of snapping.
    final Color spill = Color.lerp(colors.orbSpill, _errorSpill, errorBlend)!;
    final Color haze = Color.lerp(colors.orbHaze, _errorHaze, errorBlend)!;
    final Color mid = Color.lerp(colors.orbMid, _errorMid, errorBlend)!;
    final Color core = Color.lerp(colors.orbCore, _errorCore, errorBlend)!;

    shader.setFloat(6, spill.r);
    shader.setFloat(7, spill.g);
    shader.setFloat(8, spill.b);

    shader.setFloat(9, haze.r);
    shader.setFloat(10, haze.g);
    shader.setFloat(11, haze.b);

    shader.setFloat(12, mid.r);
    shader.setFloat(13, mid.g);
    shader.setFloat(14, mid.b);

    shader.setFloat(15, core.r);
    shader.setFloat(16, core.g);
    shader.setFloat(17, core.b);

    final paint = Paint()..shader = shader;
    canvas.drawRect(Offset.zero & size, paint);
  }

  @override
  bool shouldRepaint(covariant _KodaOrbShaderPainter oldDelegate) {
    return oldDelegate.time != time ||
        oldDelegate.flowTime != flowTime ||
        oldDelegate.level != level ||
        oldDelegate.stateValue != stateValue ||
        oldDelegate.errorBlend != errorBlend ||
        oldDelegate.colors != colors;
  }
}
