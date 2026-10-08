"use client";

import { motion } from "framer-motion";
import { fadeInUp, viewportConfig } from "@/lib/animations";

type VisualType = "waveform" | "lock" | "latency" | "terminal";

interface FeatureCardProps {
  heading: string;
  description: string;
  visual: VisualType;
  className?: string;
}

/** Animated waveform bars visual for the voice feature card.
 *
 * Each bar bounces at a staggered delay to simulate audio visualization.
 * Uses randomised bar heights for natural-looking variation.
 *
 * @returns Animated waveform visual
 */
function WaveformVisual() {
  const barHeights = [28, 48, 36, 56, 32, 44, 24, 40, 52, 30, 46];

  return (
    <div className="flex h-48 items-end justify-center gap-2.5">
      {barHeights.map((height, i) => (
        <motion.div
          key={i}
          className="w-2.5 rounded-full"
          style={{
            background: "linear-gradient(to top, var(--accent), var(--accent-light))",
          }}
          initial={{ height: 12 }}
          animate={{
            height: [12, height, 16, height * 0.7, 12],
          }}
          transition={{
            duration: 2.4,
            repeat: Infinity,
            delay: i * 0.12,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

/** Animated shield/lock visual for the privacy feature card.
 *
 * Shows a pulsing shield icon with a "Zero cloud" badge. The shield
 * box-shadow pulses to draw attention to the on-device guarantee.
 *
 * @returns Animated lock visual
 */
function LockVisual() {
  return (
    <div className="flex flex-col items-center gap-5">
      <motion.div
        animate={{
          boxShadow: [
            "0 0 20px rgba(255,255,255,0.1)",
            "0 0 40px rgba(255,255,255,0.2)",
            "0 0 20px rgba(255,255,255,0.1)",
          ],
        }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        className="rounded-2xl p-4"
      >
        <svg
          width="56"
          height="64"
          viewBox="0 0 64 72"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M32 4L6 16V36C6 52 18 64 32 68C46 64 58 52 58 36V16L32 4Z"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-accent"
            fill="none"
          />
          <rect x="22" y="34" width="20" height="16" rx="3" className="fill-accent" opacity="0.8" />
          <path
            d="M26 34V28C26 24.7 28.7 22 32 22C35.3 22 38 24.7 38 28V34"
            stroke="currentColor"
            strokeWidth="2"
            className="text-accent-light"
            fill="none"
          />
          <circle cx="32" cy="41" r="2" className="fill-bg-tertiary" />
        </svg>
      </motion.div>

      <span className="font-mono text-xs font-bold tracking-[0.2em] text-accent">
        ON-DEVICE ONLY
      </span>

      <div className="flex items-center gap-2 rounded-full border border-glass-border bg-bg-tertiary/50 px-4 py-1.5">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="text-text-muted"
        >
          <path
            d="M19.35 10.04A7.49 7.49 0 0012 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 000 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"
            fill="currentColor"
          />
          <line x1="2" y1="22" x2="22" y2="2" stroke="var(--bg-secondary)" strokeWidth="2.5" />
        </svg>
        <span className="font-mono text-xs text-text-muted">Zero cloud</span>
      </div>
    </div>
  );
}

/** Animated latency comparison bar visual for the speed feature card.
 *
 * Shows two horizontal bars: Koda at 25% width (250ms) vs a typical
 * voice assistant at 100% (2000ms+), animating into view on scroll.
 *
 * @returns Animated latency comparison visual
 */
function LatencyVisual() {
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm font-medium text-foreground">Koda</span>
          <span className="font-mono text-xs text-accent">250ms</span>
        </div>
        <div className="h-8 overflow-hidden rounded-lg bg-bg-tertiary">
          <motion.div
            className="flex h-full items-center rounded-lg px-3"
            style={{
              background: "linear-gradient(90deg, var(--accent), var(--accent-light))",
            }}
            initial={{ width: "0%" }}
            whileInView={{ width: "25%" }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-mono text-sm text-text-muted">Typical Voice Assistant</span>
          <span className="font-mono text-xs text-text-muted">2000ms+</span>
        </div>
        <div className="h-8 overflow-hidden rounded-lg bg-bg-tertiary">
          <motion.div
            className="flex h-full items-center rounded-lg bg-text-muted/50 px-3"
            initial={{ width: "0%" }}
            whileInView={{ width: "100%" }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 1.4, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
      </div>

      <div className="mt-1 text-center font-mono text-xs text-accent">
        8x faster
      </div>
    </div>
  );
}

/** Terminal simulation visual for the dev-mode feature card.
 *
 * Renders a faux terminal window with animated command lines that
 * fade in sequentially, showing Koda CLI workflow examples.
 *
 * @returns Animated terminal visual
 */
function TerminalVisual() {
  const commands = [
    { prompt: "~", cmd: "koda scaffold react-app" },
    { prompt: "~/react-app", cmd: "koda git \"commit and push\"" },
    { prompt: "~/react-app", cmd: "koda test --open-failures" },
    { prompt: "~/react-app", cmd: "koda dev" },
  ];

  return (
    <div className="w-full overflow-hidden rounded-lg border border-glass-border bg-bg-primary/80 font-mono text-xs">
      <div className="flex items-center gap-1.5 border-b border-glass-border px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-text-muted/30" />
        <span className="h-2.5 w-2.5 rounded-full bg-text-muted/30" />
        <span className="h-2.5 w-2.5 rounded-full bg-text-muted/30" />
        <span className="ml-2 text-[10px] text-text-muted">terminal</span>
      </div>
      <div className="flex flex-col gap-1 p-3">
        {commands.map((line, i) => (
          <motion.div
            key={i}
            className="flex items-center gap-1.5"
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 0.4, delay: i * 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="text-text-muted">{line.prompt} $</span>
            <span className="text-accent">{line.cmd}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

const visualComponents: Record<VisualType, React.FC> = {
  waveform: WaveformVisual,
  lock: LockVisual,
  latency: LatencyVisual,
  terminal: TerminalVisual,
};

/** Feature card component with animated visual and content.
 *
 * Renders a glass-morphism card containing a heading, description, and
 * one of four visual types (waveform, lock, latency, terminal).
 * Animates into view on scroll via framer-motion.
 *
 * @param props.heading - Card heading text
 * @param props.description - Card description text
 * @param props.visual - Which visual component to render ("waveform" | "lock" | "latency" | "terminal")
 * @param props.className - Additional CSS classes for grid placement
 * @returns Animated feature card
 */
export default function FeatureCard({
  heading,
  description,
  visual,
  className = "",
}: FeatureCardProps) {
  const VisualComponent = visualComponents[visual];

  return (
    <motion.div
      className={`glass-card glass-card-hover flex flex-col justify-between rounded-xl p-6 sm:rounded-2xl sm:p-8 md:p-10 ${className}`}
      variants={fadeInUp}
      initial="hidden"
      whileInView="visible"
      viewport={viewportConfig}
    >
      <div className="mb-6 sm:mb-8">
        <h3 className="mb-2 font-display text-lg font-bold text-foreground sm:mb-3 sm:text-xl md:text-2xl">
          {heading}
        </h3>
        <p className="text-sm leading-relaxed text-text-secondary sm:text-base">{description}</p>
      </div>

      <div className="flex items-center justify-center">
        <VisualComponent />
      </div>
    </motion.div>
  );
}
