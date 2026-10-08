"use client";

import { useRef, useEffect, useId } from "react";

// ── Constants ──────────────────────────────────────────────────
const CYCLE = 4.0;
const MAX_OFFSET = 66;
const MAX_ANGLE = 2.5;
const CX = 220;
const CY = 170;

// ── Mouse tracking constants ───────────────────────────────────
const EYE_TRACK_MAX = 3.5;       // Max eye translation in SVG units
const PARALLAX_MAX_DEG = 2.5;    // Max parallax tilt in degrees
const GLOW_PROXIMITY_RADIUS = 0.6; // Fraction of container width for proximity detection
const LERP_SPEED = 0.08;         // Smooth interpolation factor

// ── Easing ─────────────────────────────────────────────────────
function quinticInOut(t: number): number {
  const v = Math.max(0, Math.min(1, t));
  return v < 0.5
    ? 16 * v * v * v * v * v
    : 1 - Math.pow(-2 * v + 2, 5) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── SVG paths ──────────────────────────────────────────────────
const FACE =
  "M220 37" +
  "C274.6 37 305.8 52.6 313.6 115" +
  "C319.5 169.6 321.4 208.6 309.7 232" +
  "L251.2 302.2" +
  "L188.8 302.2" +
  "L130.3 232" +
  "C118.6 208.6 120.6 169.6 126.4 115" +
  "C134.2 52.6 165.4 37 220 37Z";

const EYE_L = "M151.8 159.5L194.7 164.9 198.6 175.8 159.6 171.9Z";
const EYE_R = "M245.4 164.9L288.3 159.5 280.5 171.9 241.5 175.8Z";

const EYE_INNER_L = "M196 168L204 172";
const EYE_INNER_R = "M244 168L236 172";

const BROW_L = "M148 149L200 155";
const BROW_R = "M240 155L292 149";

const CHEEK_L = "M155 178Q162 200 170 218Q176 230 184 242";
const CHEEK_R = "M285 178Q278 200 270 218Q264 230 256 242";

const TEMPLE_L1 = "M142 110L152 108L158 118";
const TEMPLE_L2 = "M152 108L152 96";
const TEMPLE_R1 = "M298 110L288 108L282 118";
const TEMPLE_R2 = "M288 108L288 96";

const JAW_L = "M140 226L185 290";
const JAW_R = "M300 226L255 290";

const MOUTH = "M205 256Q220 253 235 256";

const LOGO_OUTER_L = "M208.3 80L208.3 87.8L213.5 93L208.3 98.2L208.3 106";
const LOGO_OUTER_R = "M231.7 80L231.7 87.8L226.5 93L231.7 98.2L231.7 106";
const LOGO_INNER_L = "M213.5 83.9L218.7 93L213.5 102.1";
const LOGO_INNER_R = "M226.5 83.9L221.3 93L226.5 102.1";

type Tether = {
  y: number; lyOff: number; ryOff: number;
  cp1XBias: number; cp1YOff: number;
  cp2XBias: number; cp2YOff: number;
  anchorDepth: number; opacity: number; sw: number;
  freq: number; amp: number; phase: number;
  dash?: string; dashSpeed?: number;
};
const TETHERS: Tether[] = [
  { y: 70,  lyOff: 0,  ryOff: 8,  cp1XBias: -0.3, cp1YOff: 8,  cp2XBias: 0.3,  cp2YOff: -4,  anchorDepth: 0.30, opacity: 0.08, sw: 0.4, freq: 7.0, amp: 2.0, phase: 0 },
  { y: 90,  lyOff: 5,  ryOff: -3, cp1XBias: 0.2,  cp1YOff: -6, cp2XBias: -0.4, cp2YOff: 5,   anchorDepth: 0.40, opacity: 0.10, sw: 0.5, freq: 5.5, amp: 2.5, phase: 1.2 },
  { y: 110, lyOff: 0,  ryOff: 0,  cp1XBias: -0.2, cp1YOff: 10, cp2XBias: 0.2,  cp2YOff: 8,   anchorDepth: 0.50, opacity: 0.12, sw: 0.6, freq: 4.0, amp: 3.0, phase: 0.5, dash: "4 6", dashSpeed: 20 },
  { y: 125, lyOff: -6, ryOff: 10, cp1XBias: 0.5,  cp1YOff: -5, cp2XBias: -0.2, cp2YOff: 12,  anchorDepth: 0.55, opacity: 0.14, sw: 0.6, freq: 6.0, amp: 2.8, phase: 2.0 },
  { y: 145, lyOff: 8,  ryOff: -4, cp1XBias: -0.3, cp1YOff: -8, cp2XBias: 0.4,  cp2YOff: 10,  anchorDepth: 0.65, opacity: 0.18, sw: 0.7, freq: 3.5, amp: 4.0, phase: 0.8 },
  { y: 155, lyOff: 0,  ryOff: 0,  cp1XBias: 0.1,  cp1YOff: 14, cp2XBias: -0.1, cp2YOff: 10,  anchorDepth: 0.75, opacity: 0.20, sw: 0.8, freq: 2.8, amp: 4.5, phase: 1.5, dash: "6 4", dashSpeed: 25 },
  { y: 165, lyOff: -5, ryOff: 7,  cp1XBias: 0.4,  cp1YOff: -6, cp2XBias: -0.3, cp2YOff: 8,   anchorDepth: 0.80, opacity: 0.22, sw: 0.8, freq: 4.2, amp: 3.5, phase: 2.8 },
  { y: 178, lyOff: 4,  ryOff: -6, cp1XBias: -0.2, cp1YOff: 16, cp2XBias: 0.3,  cp2YOff: -8,  anchorDepth: 0.90, opacity: 0.24, sw: 0.9, freq: 2.0, amp: 5.0, phase: 0.3 },
  { y: 190, lyOff: 0,  ryOff: 0,  cp1XBias: 0.15, cp1YOff:-10, cp2XBias:-0.15, cp2YOff: 12,  anchorDepth: 0.85, opacity: 0.22, sw: 0.9, freq: 2.5, amp: 4.8, phase: 1.8, dash: "3 5", dashSpeed: 30 },
  { y: 205, lyOff: -8, ryOff: 5,  cp1XBias: 0.4,  cp1YOff: 12, cp2XBias:-0.35, cp2YOff: -6,  anchorDepth: 0.78, opacity: 0.20, sw: 0.8, freq: 3.0, amp: 4.0, phase: 2.5 },
  { y: 222, lyOff: 6,  ryOff: -3, cp1XBias:-0.35, cp1YOff: -8, cp2XBias: 0.25, cp2YOff: 10,  anchorDepth: 0.65, opacity: 0.16, sw: 0.7, freq: 3.8, amp: 3.2, phase: 0.7 },
  { y: 240, lyOff: 0,  ryOff: 8,  cp1XBias: 0.2,  cp1YOff: 10, cp2XBias: -0.3, cp2YOff: -5,  anchorDepth: 0.55, opacity: 0.14, sw: 0.6, freq: 4.5, amp: 2.8, phase: 1.0, dash: "5 5", dashSpeed: 18 },
  { y: 255, lyOff: -4, ryOff: -4, cp1XBias: -0.1, cp1YOff: 12, cp2XBias: 0.3,  cp2YOff: 8,   anchorDepth: 0.50, opacity: 0.12, sw: 0.6, freq: 5.0, amp: 2.5, phase: 2.2 },
  { y: 272, lyOff: 5,  ryOff: -6, cp1XBias: 0.3,  cp1YOff: -6, cp2XBias: -0.2, cp2YOff: 6,   anchorDepth: 0.40, opacity: 0.10, sw: 0.5, freq: 5.5, amp: 2.0, phase: 1.4 },
  { y: 290, lyOff: 0,  ryOff: 3,  cp1XBias: -0.2, cp1YOff: 6,  cp2XBias: 0.2,  cp2YOff: -4,  anchorDepth: 0.30, opacity: 0.08, sw: 0.4, freq: 6.5, amp: 1.8, phase: 0.6 },
  { y: 300, lyOff: 3,  ryOff: 0,  cp1XBias: 0.1,  cp1YOff: -4, cp2XBias:-0.15, cp2YOff: 4,   anchorDepth: 0.22, opacity: 0.06, sw: 0.4, freq: 7.5, amp: 1.5, phase: 2.0 },
];

// ── Component ──────────────────────────────────────────────────
/** Animated SVG face that splits into two halves representing human and Koda divergence.
 *
 * Uses a continuous animation cycle (4s) where the face splits and rejoins.
 * Features parallax tilt tracking the cursor position, eye tracking that follows
 * the mouse, blinking animation, and dynamic tether lines that connect the two
 * halves during separation. All animation state is managed via refs for rAF
 * performance without React re-renders.
 *
 * @returns An interactive SVG face component (aria-hidden, decorative)
 */
export default function DivergenceVisual() {
  const id = useId();
  const leftRef = useRef<SVGGElement>(null);
  const rightRef = useRef<SVGGElement>(null);
  const rootRef = useRef<SVGGElement>(null);
  const leftEyeRef = useRef<SVGPathElement>(null);
  const rightEyeRef = useRef<SVGPathElement>(null);
  const leftEyeWrapRef = useRef<SVGGElement>(null);
  const rightEyeWrapRef = useRef<SVGGElement>(null);
  const logoLRef = useRef<SVGGElement>(null);
  const logoRRef = useRef<SVGGElement>(null);
  const scanRef = useRef<SVGLineElement>(null);
  const tethersRef = useRef<(SVGPathElement | null)[]>([]);
  const faceLRef = useRef<SVGPathElement>(null);
  const faceRRef = useRef<SVGPathElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const scaleRef = useRef(1);
  const rafRef = useRef(0);
  const timeRef = useRef(0);
  const lastRef = useRef(0);

  // Mouse tracking state (mutable refs for rAF performance)
  const mouseRef = useRef({ x: 0, y: 0, active: false });
  const smoothMouseRef = useRef({ x: 0, y: 0 });
  const proximityRef = useRef(0); // 0 = far, 1 = close

  const clipL = `${id}-cl`;
  const clipR = `${id}-cr`;
  const glowId = `${id}-glow`;
  const logoGlowId = `${id}-lglow`;
  const faceGradId = `${id}-fg`;
  const chinGradId = `${id}-cg`;
  const scanGradId = `${id}-sg`;

  useEffect(() => {
    const origin = `${CX}px ${CY}px`;
    if (leftRef.current) leftRef.current.style.transformOrigin = origin;
    if (rightRef.current) rightRef.current.style.transformOrigin = origin;
    if (rootRef.current) rootRef.current.style.transformOrigin = origin;

    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      const linear = Math.min(1, w / 560);
      scaleRef.current = linear * linear * linear;
    });
    if (wrapRef.current) ro.observe(wrapRef.current);

    // ── Mouse tracking ─────────────────────────────────────────
    const handleMouseMove = (e: MouseEvent) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      // Normalize to -1..1 relative to center of the face container
      const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      mouseRef.current.x = nx;
      mouseRef.current.y = ny;
      mouseRef.current.active = true;

      // Proximity: distance from center (0,0) normalized
      const dist = Math.sqrt(nx * nx + ny * ny);
      // Closer = higher proximity, max at center, fades beyond GLOW_PROXIMITY_RADIUS

      proximityRef.current = Math.max(0, 1 - dist / GLOW_PROXIMITY_RADIUS);
    };

    const handleMouseLeave = () => {
      mouseRef.current.active = false;
      proximityRef.current = 0;
    };

    // Listen on the document so tracking works even when cursor is near but not directly over
    const wrap = wrapRef.current;
    if (wrap) {
      wrap.addEventListener("mousemove", handleMouseMove);
      wrap.addEventListener("mouseleave", handleMouseLeave);
    }

    // Also track at page level for wider parallax effect
    const handlePageMouseMove = (e: MouseEvent) => {
      const wrap2 = wrapRef.current;
      if (!wrap2) return;
      const rect = wrap2.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      // Wider tracking for parallax (uses viewport-relative position)
      const nx = (e.clientX - centerX) / (window.innerWidth / 2);
      const ny = (e.clientY - centerY) / (window.innerHeight / 2);
      // Only update if not directly over the face (face handler takes priority)
      if (!mouseRef.current.active) {
        mouseRef.current.x = Math.max(-1, Math.min(1, nx));
        mouseRef.current.y = Math.max(-1, Math.min(1, ny));
      }
    };
    document.addEventListener("mousemove", handlePageMouseMove);

    const animate = (now: number) => {
      const delta = lastRef.current ? (now - lastRef.current) / 1000 : 0.016;
      lastRef.current = now;
      timeRef.current += delta;

      // ── Smooth mouse interpolation ───────────────────────────
      const sm = smoothMouseRef.current;
      const mr = mouseRef.current;
      sm.x = lerp(sm.x, mr.x, LERP_SPEED);
      sm.y = lerp(sm.y, mr.y, LERP_SPEED);

      const t = timeRef.current % CYCLE;
      let split: number;
      if (t < 1.2) split = 0;
      else if (t < 2.0) split = quinticInOut((t - 1.2) / 0.8);
      else if (t < 2.4) split = 1;
      else if (t < 3.2) split = 1 - quinticInOut((t - 2.4) / 0.8);
      else split = 0;

      const s = scaleRef.current;
      const offset = split * MAX_OFFSET * s;
      const angle = split * MAX_ANGLE * s;

      const jx = Math.sin(timeRef.current * 43.7) * 0.5 * split;
      const jy = Math.sin(timeRef.current * 67.3) * 0.25 * split;

      if (leftRef.current)
        leftRef.current.style.transform = `translate(${-offset + jx}px,${jy}px) rotate(${angle}deg)`;
      if (rightRef.current)
        rightRef.current.style.transform = `translate(${offset - jx}px,${-jy}px) rotate(${-angle}deg)`;

      // Static border dashes during split
      const faces = [faceLRef.current, faceRRef.current];
      if (split > 0.01) {
        const dashOff = String(Math.floor(timeRef.current * 25));
        const flicker = 0.18 + Math.sin(timeRef.current * 19) * 0.04 * split;
        for (const f of faces) {
          if (!f) continue;
          f.style.strokeDasharray = "12 2 18 3 8 2";
          f.style.strokeDashoffset = dashOff;
          f.style.stroke = `rgba(255, 255, 255, ${flicker})`;
        }
      } else {
        for (const f of faces) {
          if (!f) continue;
          f.style.strokeDasharray = "";
          f.style.strokeDashoffset = "0";
          f.style.stroke = "rgba(255, 255, 255, 0.18)";
        }
      }

      // Breathing when merged + subtle drift
      const breathe =
        split < 0.01 ? 1 + Math.sin(timeRef.current * 1.5) * 0.002 : 1;
      const dx = Math.sin(timeRef.current * 0.25) * 1.4;
      const dy = Math.sin(timeRef.current * 0.18) * 0.5;

      // ── Parallax tilt — face subtly tilts toward cursor ──────
      const parallaxX = sm.x * PARALLAX_MAX_DEG * (1 - split); // Disable during split
      const parallaxY = sm.y * PARALLAX_MAX_DEG * (1 - split);

      if (rootRef.current)
        rootRef.current.style.transform =
          `translate(${dx}px,${dy}px) scale(${breathe}) rotateY(${parallaxX}deg) rotateX(${-parallaxY}deg)`;

      // ── Eye tracking — eyes follow cursor ────────────────────
      const eyeTrackX = sm.x * EYE_TRACK_MAX * (1 - split);
      const eyeTrackY = sm.y * EYE_TRACK_MAX * 0.6 * (1 - split); // Less vertical range

      if (leftEyeWrapRef.current)
        leftEyeWrapRef.current.style.transform = `translate(${eyeTrackX}px, ${eyeTrackY}px)`;
      if (rightEyeWrapRef.current)
        rightEyeWrapRef.current.style.transform = `translate(${eyeTrackX}px, ${eyeTrackY}px)`;

      // ── Eye pulse + blink + proximity glow ───────────────────
      const proximity = proximityRef.current;
      const basePulse = 0.92 + Math.sin(timeRef.current * 2) * 0.08;
      // Subtle glow lift when cursor is near
      const glowBoost = 1 + proximity * 0.15;
      const pulse = Math.min(basePulse * glowBoost, 1.0);

      const blinkInterval = 4.5;
      const bp = timeRef.current % blinkInterval;
      let blink = 1;
      if (bp > blinkInterval - 0.2) {
        const bt = (bp - (blinkInterval - 0.2)) / 0.2;
        if (bt < 0.35) blink = 1 - bt / 0.35;
        else if (bt < 0.55) blink = 0;
        else blink = (bt - 0.55) / 0.45;
      }
      const o = String(pulse * blink);
      if (leftEyeRef.current) leftEyeRef.current.style.opacity = o;
      if (rightEyeRef.current) rightEyeRef.current.style.opacity = o;

      // Logo slow heartbeat pulse
      const logoPulse = String(0.35 + Math.sin(timeRef.current * 0.4) * 0.08);
      if (logoLRef.current) logoLRef.current.style.opacity = logoPulse;
      if (logoRRef.current) logoRRef.current.style.opacity = logoPulse;

      // Scan line
      const scanCycle = 3.0;
      const scanT = (timeRef.current % scanCycle) / scanCycle;
      const scanY = 40 + scanT * 270;
      const scanOpacity = scanT < 0.1
        ? scanT / 0.1
        : scanT > 0.9
          ? (1 - scanT) / 0.1
          : 1;
      if (scanRef.current) {
        scanRef.current.setAttribute("y1", String(scanY));
        scanRef.current.setAttribute("y2", String(scanY));
        scanRef.current.style.opacity = String(scanOpacity * 0.12);
      }

      // Tethers
      const time = timeRef.current;
      tethersRef.current.forEach((el, i) => {
        if (!el) return;
        if (split < 0.01) {
          el.style.opacity = "0";
          return;
        }
        const cfg = TETHERS[i];
        const lx = CX - offset * cfg.anchorDepth;
        const ly = cfg.y + cfg.lyOff;
        const rx = CX + offset * cfg.anchorDepth;
        const ry = cfg.y + cfg.ryOff;
        const wave = Math.sin(time * cfg.freq + cfg.phase) * cfg.amp * split;
        const cp1x = lx + (rx - lx) * 0.33 + cfg.cp1XBias * offset * 0.4;
        const cp1y = ly + (ry - ly) * 0.33 + cfg.cp1YOff * (1 - split * 0.4) + wave;
        const cp2x = lx + (rx - lx) * 0.67 + cfg.cp2XBias * offset * 0.4;
        const cp2y = ly + (ry - ly) * 0.67 + cfg.cp2YOff * (1 - split * 0.4) - wave * 0.7;
        el.setAttribute("d", `M${lx} ${ly}C${cp1x} ${cp1y} ${cp2x} ${cp2y} ${rx} ${ry}`);
        const opacity = Math.min(split * 3, 1) * cfg.opacity;
        el.style.opacity = String(opacity);
        if (cfg.dash) {
          el.style.strokeDashoffset = String(-time * (cfg.dashSpeed ?? 20));
        }
      });

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      if (wrap) {
        wrap.removeEventListener("mousemove", handleMouseMove);
        wrap.removeEventListener("mouseleave", handleMouseLeave);
      }
      document.removeEventListener("mousemove", handlePageMouseMove);
    };
  }, [glowId]);

  return (
    <div
      ref={wrapRef}
      className="mx-auto"
      style={{
        width: 560,
        maxWidth: "85%",
        aspectRatio: "500 / 340",
        overflow: "hidden",
        perspective: "800px",
      }}
      aria-hidden="true"
    >
      <svg
        ref={svgRef}
        viewBox="-30 0 500 340"
        fill="none"
        style={{ width: "100%", height: "100%", transformStyle: "preserve-3d" }}
      >
        <defs>
          <clipPath id={clipL}>
            <rect x="0" y="-100" width={CX} height="540" />
          </clipPath>
          <clipPath id={clipR}>
            <rect x={CX} y="-100" width={CX} height="540" />
          </clipPath>

          <radialGradient id={faceGradId} cx="50%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.11" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.02" />
          </radialGradient>

          <linearGradient id={chinGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#050508" stopOpacity="0" />
            <stop offset="60%" stopColor="#050508" stopOpacity="0" />
            <stop offset="100%" stopColor="#050508" stopOpacity="0.2" />
          </linearGradient>

          {/* Base eye glow — used for static rendering */}
          <filter id={glowId} x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="b1" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b2" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="14" result="b3" />
            <feMerge>
              <feMergeNode in="b3" />
              <feMergeNode in="b2" />
              <feMergeNode in="b1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <linearGradient id={scanGradId} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="20%" stopColor="#ffffff" stopOpacity="0.6" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="80%" stopColor="#ffffff" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>

          <filter id={logoGlowId} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="lb1" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="lb2" />
            <feMerge>
              <feMergeNode in="lb2" />
              <feMergeNode in="lb1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g ref={rootRef} style={{ transformStyle: "preserve-3d" }}>

          {/* ── Left half ── */}
          <g ref={leftRef}>
            <g clipPath={`url(#${clipL})`}>
              <path
                ref={faceLRef}
                d={FACE}
                fill={`url(#${faceGradId})`}
                stroke="rgba(255, 255, 255, 0.18)"
                strokeWidth="1.2"
              />
              <path d={FACE} fill={`url(#${chinGradId})`} />
              <g ref={logoLRef} filter={`url(#${logoGlowId})`}>
                <path d={LOGO_OUTER_L} stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <path d={LOGO_OUTER_R} stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <path d={LOGO_INNER_L} stroke="#ffffff" strokeWidth="1.0" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.5" />
                <path d={LOGO_INNER_R} stroke="#ffffff" strokeWidth="1.0" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.5" />
                <circle cx="220" cy="93" r="2.0" fill="#ffffff" opacity="0.9" />
              </g>
              <path d={TEMPLE_L1} stroke="rgba(255, 255, 255, 0.10)" strokeWidth="0.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <path d={TEMPLE_L2} stroke="rgba(255, 255, 255, 0.07)" strokeWidth="0.7" strokeLinecap="round" fill="none" />
              <path d={BROW_L} stroke="rgba(255, 255, 255, 0.30)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              {/* Eye — wrapped in a group for tracking transform */}
              <g ref={leftEyeWrapRef}>
                <path
                  ref={leftEyeRef}
                  d={EYE_L}
                  fill="#ffffff"
                  filter={`url(#${glowId})`}
                />
              </g>
              <path d={EYE_INNER_L} stroke="rgba(255, 255, 255, 0.16)" strokeWidth="0.8" strokeLinecap="round" fill="none" />
              <path d={CHEEK_L} stroke="rgba(255, 255, 255, 0.08)" strokeWidth="0.8" strokeLinecap="round" fill="none" />
              <path d={JAW_L} stroke="rgba(255, 255, 255, 0.06)" strokeWidth="0.6" strokeLinecap="round" fill="none" />
              <path d={MOUTH} stroke="rgba(255, 255, 255, 0.14)" strokeWidth="1.0" strokeLinecap="round" fill="none" />
            </g>
          </g>

          {/* ── Right half ── */}
          <g ref={rightRef}>
            <g clipPath={`url(#${clipR})`}>
              <path
                ref={faceRRef}
                d={FACE}
                fill={`url(#${faceGradId})`}
                stroke="rgba(255, 255, 255, 0.18)"
                strokeWidth="1.2"
              />
              <path d={FACE} fill={`url(#${chinGradId})`} />
              <g ref={logoRRef} filter={`url(#${logoGlowId})`}>
                <path d={LOGO_OUTER_L} stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <path d={LOGO_OUTER_R} stroke="#ffffff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                <path d={LOGO_INNER_L} stroke="#ffffff" strokeWidth="1.0" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.5" />
                <path d={LOGO_INNER_R} stroke="#ffffff" strokeWidth="1.0" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.5" />
                <circle cx="220" cy="93" r="2.0" fill="#ffffff" opacity="0.9" />
              </g>
              <path d={TEMPLE_R1} stroke="rgba(255, 255, 255, 0.10)" strokeWidth="0.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <path d={TEMPLE_R2} stroke="rgba(255, 255, 255, 0.07)" strokeWidth="0.7" strokeLinecap="round" fill="none" />
              <path d={BROW_R} stroke="rgba(255, 255, 255, 0.30)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              {/* Eye — wrapped in a group for tracking transform */}
              <g ref={rightEyeWrapRef}>
                <path
                  ref={rightEyeRef}
                  d={EYE_R}
                  fill="#ffffff"
                  filter={`url(#${glowId})`}
                />
              </g>
              <path d={EYE_INNER_R} stroke="rgba(255, 255, 255, 0.16)" strokeWidth="0.8" strokeLinecap="round" fill="none" />
              <path d={CHEEK_R} stroke="rgba(255, 255, 255, 0.08)" strokeWidth="0.8" strokeLinecap="round" fill="none" />
              <path d={JAW_R} stroke="rgba(255, 255, 255, 0.06)" strokeWidth="0.6" strokeLinecap="round" fill="none" />
              <path d={MOUTH} stroke="rgba(255, 255, 255, 0.14)" strokeWidth="1.0" strokeLinecap="round" fill="none" />
            </g>
          </g>

          {/* ── Scan line ── */}
          <line
            ref={scanRef}
            x1="130"
            x2="310"
            y1="170"
            y2="170"
            stroke={`url(#${scanGradId})`}
            strokeWidth="1"
            opacity="0"
          />

          {/* ── Tethers ── */}
          {TETHERS.map((cfg, i) => (
            <path
              key={i}
              ref={(el) => { tethersRef.current[i] = el; }}
              d={`M${CX} ${cfg.y}C${CX} ${cfg.y} ${CX} ${cfg.y} ${CX} ${cfg.y}`}
              stroke="#ffffff"
              strokeWidth={cfg.sw}
              strokeLinecap="round"
              strokeDasharray={cfg.dash}
              fill="none"
              opacity="0"
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
