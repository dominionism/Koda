"use client";

import { motion } from "framer-motion";
import { viewportConfig } from "@/lib/animations";
import { HOW_IT_WORKS } from "@/lib/constants";

const icons: Record<string, React.ReactNode> = {
  mic: (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  ),
  cpu: (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M15 2v2" />
      <path d="M15 20v2" />
      <path d="M2 15h2" />
      <path d="M2 9h2" />
      <path d="M20 15h2" />
      <path d="M20 9h2" />
      <path d="M9 2v2" />
      <path d="M9 20v2" />
    </svg>
  ),
  check: (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
};

const stepVariants = {
  hidden: { opacity: 0, scale: 0.8 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, delay: i * 0.3, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

const labelVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, delay: i * 0.3 + 0.2, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

const detailVariants = {
  hidden: { opacity: 0 },
  visible: (i: number) => ({
    opacity: 1,
    transition: { duration: 0.3, delay: i * 0.3 + 0.3, ease: "easeOut" as const },
  }),
};

const lineVariants = {
  hidden: { scaleX: 0 },
  visible: (i: number) => ({
    scaleX: 1,
    transition: { duration: 0.6, delay: i * 0.3 + 0.15, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

const verticalLineVariants = {
  hidden: { scaleY: 0 },
  visible: (i: number) => ({
    scaleY: 1,
    transition: { duration: 0.6, delay: i * 0.3 + 0.15, ease: [0.16, 1, 0.3, 1] as const },
  }),
};

/** Animated pipeline showing Speak/Interpret/Execute steps with connecting lines.
 *
 * Renders a horizontal (desktop) or vertical (mobile) flow with icon circles
 * that animate into view on scroll. Each step updates its border/shadow color
 * as it appears. Steps are connected by gradient lines.
 *
 * @returns Animated pipeline component
 */
export default function Pipeline() {
  const steps = HOW_IT_WORKS.steps;

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={viewportConfig}
    >
      {/* Desktop: horizontal layout */}
      <div className="hidden items-center justify-center md:flex">
        {steps.map((step, i) => (
          <div key={step.label} className="flex items-center">
            <div className="flex flex-col items-center gap-3">
              <motion.div
                custom={i}
                variants={stepVariants}
                className="glass-card flex h-18 w-18 items-center justify-center rounded-full text-text-muted"
                whileInView={{
                  borderColor: "var(--accent)",
                  color: "var(--text-primary)",
                  boxShadow: "0 0 20px rgba(255,255,255,0.1)",
                  transition: { delay: i * 0.3 + 0.1, duration: 0.5 },
                }}
                viewport={viewportConfig}
              >
                {icons[step.icon]}
              </motion.div>
              <motion.span
                custom={i}
                variants={labelVariants}
                className="text-sm font-semibold text-foreground"
              >
                {step.label}
              </motion.span>
              <motion.span
                custom={i}
                variants={detailVariants}
                className="text-xs text-text-muted"
              >
                {step.detail}
              </motion.span>
            </div>
            {i < steps.length - 1 && (
              <motion.div
                custom={i}
                variants={lineVariants}
                className="mx-8 h-px w-24 origin-left"
                style={{
                  marginBottom: "3rem",
                  background: "linear-gradient(90deg, var(--accent), transparent)",
                }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Mobile: vertical layout */}
      <div className="flex flex-col items-center md:hidden">
        {steps.map((step, i) => (
          <div key={step.label} className="flex flex-col items-center">
            <div className="flex flex-col items-center gap-2">
              <motion.div
                custom={i}
                variants={stepVariants}
                className="glass-card flex h-18 w-18 items-center justify-center rounded-full text-text-muted"
                whileInView={{
                  borderColor: "var(--accent)",
                  color: "var(--text-primary)",
                  boxShadow: "0 0 20px rgba(255,255,255,0.1)",
                  transition: { delay: i * 0.3 + 0.1, duration: 0.5 },
                }}
                viewport={viewportConfig}
              >
                {icons[step.icon]}
              </motion.div>
              <motion.span
                custom={i}
                variants={labelVariants}
                className="text-sm font-semibold text-foreground"
              >
                {step.label}
              </motion.span>
              <motion.span
                custom={i}
                variants={detailVariants}
                className="text-xs text-text-muted"
              >
                {step.detail}
              </motion.span>
            </div>
            {i < steps.length - 1 && (
              <motion.div
                custom={i}
                variants={verticalLineVariants}
                className="my-3 h-10 w-px origin-top"
                style={{
                  background: "linear-gradient(180deg, var(--accent), transparent)",
                }}
              />
            )}
          </div>
        ))}
      </div>
    </motion.div>
  );
}
