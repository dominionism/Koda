"use client";

import { motion } from "framer-motion";
import { fillBar, viewportConfig } from "@/lib/animations";

interface LatencyBarProps {
  label: string;
  ms: number;
  percentage: number;
  delay: number;
}

/** Animated latency bar showing a single pipeline stage's timing.
 *
 * Displays the stage label, millisecond duration, and a gradient fill bar
 * that animates to its `percentage` width on scroll.
 *
 * @param props.label - Stage name
 * @param props.ms - Duration in milliseconds
 * @param props.percentage - Width percentage for the fill bar
 * @param props.delay - Animation delay in seconds (for staggered entrance)
 * @returns Animated latency bar row
 */
export default function LatencyBar({
  label,
  ms,
  percentage,
  delay,
}: LatencyBarProps) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex items-center justify-between sm:contents">
        <span className="shrink-0 text-xs text-text-secondary sm:w-40 sm:text-sm">
          {label}
        </span>
        <span className="shrink-0 font-mono text-xs text-text-muted sm:order-last sm:w-14 sm:text-right sm:text-sm">
          {ms}ms
        </span>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-border/50 sm:flex-1">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            background: "linear-gradient(90deg, var(--accent), var(--accent-light))",
          }}
          initial="hidden"
          whileInView="visible"
          viewport={viewportConfig}
          variants={fillBar(percentage, delay)}
        />
      </div>
    </div>
  );
}
