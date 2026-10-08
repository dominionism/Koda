"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { fadeInUp, viewportConfig } from "@/lib/animations";
import { STATS } from "@/lib/constants";

/** Animated counter that increments from 0 to `value` on scroll into view.
 *
 * Uses IntersectionObserver to trigger counting once. Supports an optional
 * `prefix` for special values (e.g. "Zero" instead of "0").
 *
 * @param props.value - Target number to count to
 * @param props.suffix - Text appended after the number (e.g. "ms", "%")
 * @param props.prefix - Optional text to display when value is 0
 * @returns Animated counter span
 */
function AnimatedCounter({
  value,
  suffix,
  prefix,
}: {
  value: number;
  suffix: string;
  prefix?: string;
}) {
  const [count, setCount] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasStarted) {
          setHasStarted(true);
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasStarted]);

  useEffect(() => {
    if (!hasStarted) return;
    if (value === 0) return;

    const duration = 1500;
    const steps = 60;
    const increment = value / steps;
    let current = 0;
    const stepDuration = duration / steps;

    const timer = setInterval(() => {
      current += increment;
      if (current >= value) {
        setCount(value);
        clearInterval(timer);
      } else {
        setCount(Math.floor(current));
      }
    }, stepDuration);

    return () => clearInterval(timer);
  }, [hasStarted, value]);

  const displayValue = prefix && value === 0 ? prefix : `${count}${suffix}`;

  return (
    <span ref={ref} className="font-mono text-3xl font-bold text-foreground sm:text-4xl md:text-5xl">
      {displayValue}
    </span>
  );
}

/** Statistics section with animated counter cards showing key metrics.
 *
 * Renders a 3-column grid of stat cards (latency, on-device, cloud required)
 * with count-up animations that trigger on scroll into view.
 *
 * @returns The stats section
 */
export default function Stats() {
  return (
    <motion.section
      className="mx-auto max-w-5xl px-5 py-12 sm:px-6 sm:py-16 md:py-20"
      initial="hidden"
      whileInView="visible"
      viewport={viewportConfig}
      variants={{ visible: { transition: { staggerChildren: 0.15 } } }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6 md:gap-8">
        {STATS.map((stat) => (
          <motion.div
            key={stat.label}
            variants={fadeInUp}
            className="glass-card glass-card-hover flex flex-col items-center gap-2 rounded-xl px-5 py-6 text-center sm:gap-3 sm:rounded-2xl sm:px-8 sm:py-10"
          >
            <AnimatedCounter
              value={stat.value}
              suffix={stat.suffix}
              prefix={"prefix" in stat ? stat.prefix : undefined}
            />
            <span className="text-sm font-medium tracking-wide text-text-secondary">
              {stat.label}
            </span>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}
