"use client";

import { motion } from "framer-motion";
import { fadeInUp, viewportConfig } from "@/lib/animations";
import { HOW_IT_WORKS } from "@/lib/constants";
import Pipeline from "./Pipeline";
import LatencyBar from "./LatencyBar";

const STAGGER_BASE = 0.15;

/** How It Works section — pipeline steps and latency breakdown.
 *
 * Renders an animated Pipeline component showing the Speak/Interpret/Execute
 * flow, followed by a glass card with latency breakdown bars and totals.
 *
 * @returns The how-it-works section
 */
export default function HowItWorks() {
  return (
    <section id="how-it-works" className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 sm:py-20 md:py-28">
      <motion.div
        className="mb-16 text-center"
        initial="hidden"
        whileInView="visible"
        viewport={viewportConfig}
        variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
      >
        <motion.h2
          className="mb-4 font-display text-2xl font-bold text-foreground sm:text-3xl md:text-5xl"
          variants={fadeInUp}
        >
          {HOW_IT_WORKS.heading}
        </motion.h2>
        <motion.p
          className="text-sm text-text-secondary sm:text-base"
          variants={fadeInUp}
        >
          {HOW_IT_WORKS.subheading}
        </motion.p>
      </motion.div>

      <Pipeline />

      <motion.div
        className="glass-card mx-auto mt-12 max-w-2xl rounded-xl p-5 font-mono sm:mt-16 sm:rounded-2xl sm:p-8"
        initial="hidden"
        whileInView="visible"
        viewport={viewportConfig}
        variants={fadeInUp}
      >
        <div className="mb-6 flex items-center gap-2 text-xs text-text-muted">
          <motion.span
            className="inline-block h-2 w-2 rounded-full bg-accent"
            animate={{
              boxShadow: [
                "0 0 4px rgba(255,255,255,0.3)",
                "0 0 8px rgba(255,255,255,0.6)",
                "0 0 4px rgba(255,255,255,0.3)",
              ],
            }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
          latency breakdown
        </div>

        <div className="flex flex-col gap-3 sm:gap-4">
          {HOW_IT_WORKS.latency.map((item, i) => (
            <LatencyBar
              key={item.label}
              label={item.label}
              ms={item.ms}
              percentage={item.percentage}
              delay={i * STAGGER_BASE}
            />
          ))}
        </div>

        <div className="mt-6 border-t border-glass-border pt-4 text-right">
          <span className="font-bold text-accent glow-text">
            Total: {HOW_IT_WORKS.totalMs}ms
          </span>
        </div>
      </motion.div>
    </section>
  );
}
