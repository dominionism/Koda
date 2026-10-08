#version 460 core

#include <flutter/runtime_effect.glsl>

uniform vec2 uResolution;
uniform float uTime;     // real elapsed seconds — drives ambient/breathing pulses
uniform float uFlowTime; // integrated rotation phase (see note in main())
uniform float uLevel;
uniform float uState; // axis: 0=idle, 1=processing, 2=listening, 3=speaking
uniform vec3 uColorSpill;
uniform vec3 uColorHaze;
uniform vec3 uColorMid;
uniform vec3 uColorCore;

out vec4 fragColor;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

float saturate(float v) {
    return clamp(v, 0.0, 1.0);
}

float softBand(float d, float width, float feather) {
    return smoothstep(width + feather, width, abs(d));
}

float wrappedPulse(float phase, float center, float width) {
    float d = abs(fract(phase) - center);
    d = min(d, 1.0 - d);
    return pow(saturate(1.0 - d / width), 2.8);
}

// Rotation matrix around Y axis
mat3 rotY(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat3(
        c, 0.0, s,
        0.0, 1.0, 0.0,
        -s, 0.0, c
    );
}

// Rotation matrix around X axis
mat3 rotX(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat3(
        1.0, 0.0, 0.0,
        0.0, c, -s,
        0.0, s, c
    );
}

// Rotation matrix around Z axis
mat3 rotZ(float a) {
    float s = sin(a);
    float c = cos(a);
    return mat3(
        c, -s, 0.0,
        s, c, 0.0,
        0.0, 0.0, 1.0
    );
}

void main() {
    vec2 fragCoord = FlutterFragCoord().xy;
    vec2 uv = (fragCoord.xy - 0.5 * uResolution.xy) / min(uResolution.x, uResolution.y);
    uv *= 3.0; 

    float r2 = dot(uv, uv);
    vec4 finalColor = vec4(0.0);
    float dist = length(uv);

    // Per-state dynamics. The state axis is ordered to match the natural
    // conversation flow so every common transition is between ADJACENT states
    // (idle -> processing -> listening <-> speaking) and never sweeps through
    // an unrelated look:
    //   0 = idle, 1 = processing, 2 = listening, 3 = speaking
    // s1/s2/s3 are the three adjacent transition weights along that axis.
    float s1 = saturate(uState);          // idle      -> processing
    float s2 = saturate(uState - 1.0);    // processing -> listening
    float s3 = saturate(uState - 2.0);    // listening  -> speaking

    // Wave amplitude (path turbulence of the plasma rings).
    float waveAmpIdle       = 0.015;
    float waveAmpProcessing = 0.055;
    float waveAmpListening  = 0.03 + uLevel * 0.02;
    float waveAmpSpeaking   = 0.035 + uLevel * 0.07;
    float waveAmp = mix(mix(mix(waveAmpIdle, waveAmpProcessing, s1), waveAmpListening, s2), waveAmpSpeaking, s3);

    // Overall energy (brightness / glow strength).
    float energyIdle       = 0.6 + 0.15 * sin(uTime * 1.2);
    float energyProcessing = 1.0;
    float energyListening  = 0.8 + uLevel * 0.2;
    float energySpeaking   = 0.9 + uLevel * 0.5;
    float energy = mix(mix(mix(energyIdle, energyProcessing, s1), energyListening, s2), energySpeaking, s3);

    // Band thickness multiplier.
    float thickIdle       = 1.0;
    float thickProcessing = 1.15;
    float thickListening  = 1.2 + uLevel * 0.25;
    float thickSpeaking   = 1.2 + uLevel * 1.4;
    float thicknessMult = mix(mix(mix(thickIdle, thickProcessing, s1), thickListening, s2), thickSpeaking, s3);

    // The rotation phase is INTEGRATED on the Dart side (uFlowTime) rather than
    // computed here as uTime * speed. Rotation speed differs per state, and
    // multiplying a large monotonic uTime by a changing speed snaps the phase
    // forward by many radians the instant the state changes — the orb appears
    // to spin wildly during a transition. By making speed the derivative of an
    // accumulated phase, a smooth speed ramp yields a smooth, continuous spin.
    float t = uFlowTime;
    vec3 lineGlow = vec3(0.0);

    if (dist <= 1.0) {
        // --- INSIDE THE SPHERE ---
        float z = sqrt(max(0.0, 1.0 - r2));
        vec3 p = vec3(uv.x, uv.y, z); // surface point

        // Volumetric glass core: dark hollow center
        vec3 deepInk = vec3(0.00, 0.00, 0.00); // deep navy / black
        vec3 cobalt = vec3(0.00, 0.01, 0.03);
        float lowerDepth = smoothstep(-0.2, -0.9, uv.y) * smoothstep(0.2, 0.9, dist);
        vec3 color = mix(deepInk, cobalt, lowerDepth * 0.5);

        // Rim lighting to emphasize sphere edge where plasma hits
        float rim = pow(1.0 - max(z, 0.0), 4.5);
        float rightRim = smoothstep(-0.7, 0.8, uv.x);
        float topRim = smoothstep(-0.2, 0.9, uv.y);
        color += vec3(0.01, 0.1, 0.3) * rim * (0.2 + rightRim * 0.3 + topRim * 0.1) * energy;

        // Plasma orbital strips
        for (int i = 0; i < 5; i++) {
            float fi = float(i);
            
            vec3 n = vec3(0.0, 1.0, 0.0);
            
            // Orient rings dynamically
            float tilt1 = 0.4 + fi * 1.8 + sin(t * 0.12 + fi * 1.3) * 0.35; 
            float tilt2 = 0.6 + fi * 1.2 + cos(t * 0.09 + fi * 2.2) * 0.35;
            n = rotX(tilt1) * rotY(tilt2) * n;
            n = rotZ(t * (0.09 + fi * 0.02)) * rotX(t * (0.04 + fi * 0.01)) * n;
            
            vec3 a = normalize(cross(n, vec3(0.0, 0.0, 1.0)) + vec3(0.0001, 0.0, 0.0));
            vec3 b = normalize(cross(n, a));
            float phase = atan(dot(p, b), dot(p, a));
            
            // Offset from origin to make non-great circles
            float offset = sin(fi * 2.7 + t * 0.22) * 0.4;
            float d = dot(p, n) - offset;

            // Path Turbulence. Every `phase` multiplier here must be an
            // integer: `phase` comes from atan() (wraps ±PI), so any
            // non-integer harmonic is discontinuous across that wrap and
            // renders as a hard seam slicing across the ring.
            float pathWave = sin(phase * 2.0 + t * (1.1 + fi * 0.2)) * (waveAmp * 3.0);
            pathWave += sin(phase * 5.0 - t * 0.8 + fi * 1.5) * (waveAmp * 1.5);

            float procWeight = saturate(1.0 - abs(uState - 1.0));
            pathWave += sin(phase * 7.0 + t * 2.0) * (waveAmp * 1.2) * procWeight;
            d += pathWave;

            float phase01 = phase / TAU + 0.5;
            
            // Fade out back-facing segments (depth mask)
            float frontMask = smoothstep(-0.6, 0.15, p.z);
            
            // Plasma flow along the path. Integer phase multiplier (see
            // pathWave note) keeps the flow continuous across the atan wrap;
            // the downstream `flowPhase * 2.5` then resolves to phase * 5.0.
            float flowPhase = phase * 2.0 + t * (0.8 + fi * 0.3);
            float flow = 0.6 + 0.4 * sin(flowPhase);
            flow += 0.2 * sin(flowPhase * 2.5);

            float listWeight = saturate(1.0 - abs(uState - 2.0));
            frontMask = mix(frontMask, smoothstep(-0.4, 0.4, p.z), listWeight);
            flow += (0.3 * smoothstep(0.4, 1.0, p.z)) * listWeight;

            float edgeGlow = 0.3 + 1.2 * rim;
            float visibility = max(0.0, frontMask * flow * edgeGlow);
            
            // Vary thickness
            float thicknessVar = 0.7 + 0.5 * sin(phase * 2.0 - t * 0.6 + fi);
            
            // MUCH THICKER BANDS
            float baseThick = (0.08 + mod(fi, 3.0) * 0.04) * thicknessMult * thicknessVar;

            // Marbling (inner turbulence)
            // Scale d to band space roughly [-1, 1] for noise mapping
            float dNorm = d / baseThick; 
            
            // Create fluid streaks inside the band (clean plasma flow)
            float marbleNoise = sin(phase * 6.0 + dNorm * 4.0 - t * 2.5) * 0.5;
            marbleNoise += sin(phase * 14.0 - dNorm * 7.0 + t * 1.8) * 0.25;
            
            // More active marbling in processing
            marbleNoise += sin(phase * 20.0 + dNorm * 10.0 + t * 4.0) * 0.2 * procWeight;
            
            // Perturb d for inner layers (keep the flow smooth)
            float dInner = d + marbleNoise * baseThick * 0.6;
            
            // Crisp, clean falloffs to eliminate the blurry glow look
            float spill = softBand(d, baseThick * 2.0, 0.15);        // Clean, reduced spill
            float haze = softBand(dInner, baseThick * 1.0, 0.05);   // Crisp outer edge
            float midGlow = softBand(dInner, baseThick * 0.5, 0.02); // Solid, clean body
            
            // Hot core also ripples but tighter
            float coreNoise = sin(phase * 15.0 - t * 3.0) * baseThick * 0.15;
            float core = softBand(d + coreNoise, baseThick * 0.1, 0.01); // Razor-sharp core
            
            // Moving hot streaks (Electrical surges)
            float streakSpeed = 0.3 + fi * 0.1;
            float streakPhase = fract(phase01 + t * streakSpeed + fi * 0.7);
            float streak = wrappedPulse(streakPhase, 0.5, 0.25); // smoother surge
            
            // Color Palette (Plasma Shades from Dart Theme)
            vec3 spillCol = uColorSpill;
            vec3 hazeCol = uColorHaze;
            vec3 midCol = uColorMid;
            vec3 coreCol = uColorCore;
            
            float activeStreak = streak;
            // Streak intensity per state (axis-ordered: idle, processing,
            // listening, speaking). Calm at rest and while listening, agitated
            // arcs while processing, audio-driven surges while speaking.
            float streakCalm       = 1.0;              // idle + listening
            float streakProcessing = 2.0;              // processing
            float streakSpeaking   = 1.5 + uLevel * 2.5; // speaking
            float streakMult = mix(mix(mix(streakCalm, streakProcessing, s1), streakCalm, s2), streakSpeaking, s3);
            activeStreak *= streakMult;

            // Combine layers with marbled depth
            lineGlow += spillCol * spill * visibility * 0.8 * energy;
            lineGlow += hazeCol * haze * visibility * 1.8 * energy;
            lineGlow += midCol * midGlow * visibility * (1.8 + marbleNoise * 0.8) * energy;
            lineGlow += coreCol * core * visibility * (2.0 + activeStreak * 3.0) * energy;
            
            // Searing hot core at streak centers (Plasma arcing)
            lineGlow += vec3(1.0) * core * activeStreak * visibility * 5.0 * energy;
        }

        color += lineGlow;
        
        // Enhance dark hollow center and glass shell
        color *= 0.8 + smoothstep(1.0, 0.8, dist) * 0.2;

        // Tone mapping so hot areas glow without becoming flat blobs
        color = 1.0 - exp(-color * 1.6);

        float alpha = smoothstep(1.0, 0.985, dist);
        finalColor = vec4(color * alpha, alpha);
    } 
    
    // --- CONTROLLED HALO ---
    float outDist = max(0.0, dist - 1.0);
    
    float thinRing = exp(-pow(outDist / 0.03, 2.0));
    float nearHalo = exp(-pow(outDist / 0.1, 1.6));
    float outerMist = exp(-pow(outDist / 0.25, 2.0)); // Tighter outer mist
    
    float haloGate = smoothstep(1.3, 1.05, dist);
    
    float angular = atan(uv.y, uv.x);
    // Angular frequencies must be integers: atan wraps at ±PI, and any
    // non-integer harmonic is discontinuous across that branch cut, which
    // renders as a hard radial seam on the left side of the orb.
    float livingUnevenness = 0.75 + 0.25 * sin(angular * 3.0 - t * 0.3) * cos(angular * 2.0 + t * 0.4);
    
    float haloIntensity = (thinRing * 0.6 + nearHalo * 0.35 + outerMist * 0.05) * haloGate * livingUnevenness * energy;

    // Halo colors based on Dart theme
    vec3 baseBlue = mix(vec3(0.01, 0.02, 0.05), uColorSpill, 0.7);
    vec3 brightBlue = uColorHaze;
    vec3 haloBaseColor = mix(baseBlue, brightBlue, nearHalo);
    haloBaseColor = mix(haloBaseColor, uColorMid, thinRing);

    // The halo is emitted as additive light (alpha 0) and the inner bleed
    // reuses the same intensity curve, so brightness is continuous across
    // the limb — alpha-compositing the halo while additively bleeding the
    // inside leaves a visible ring exactly at dist = 1.0.
    vec3 haloLight = 1.0 - exp(-haloBaseColor * haloIntensity * 1.6);

    if (dist <= 1.0) {
        float innerBleed = smoothstep(0.75, 1.0, dist);
        finalColor.rgb += haloLight * innerBleed;
    } else {
        finalColor = vec4(haloLight, 0.0);
    }

    fragColor = finalColor;
}
