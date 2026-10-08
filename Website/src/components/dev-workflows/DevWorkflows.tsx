"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fadeInUp, viewportConfig } from "@/lib/animations";
import { DEV_WORKFLOWS } from "@/lib/constants";

const capabilityIcons: Record<string, React.ReactNode> = {
  terminal: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  git: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  ),
  code: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  folder: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  test: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  zap: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
};

/** Interactive terminal simulation cycling through developer voice workflows.
 *
 * Loops through DEV_WORKFLOWS items, typing the voice input and revealing
 * execution steps with checkmarks. Advances automatically through phases:
 * typing -> executing (staggered steps) -> holding -> next workflow.
 * Clickable progress dots allow manual workflow selection.
 *
 * @returns Interactive workflow terminal component
 */
function WorkflowTerminal() {
  const workflows = DEV_WORKFLOWS.workflows;
  const [activeWorkflow, setActiveWorkflow] = useState(0);
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [phase, setPhase] = useState<"typing" | "executing" | "holding">("typing");

  const advance = useCallback(() => {
    setActiveWorkflow((prev) => (prev + 1) % workflows.length);
    setVisibleSteps(0);
    setPhase("typing");
  }, [workflows.length]);

  useEffect(() => {
    const workflow = workflows[activeWorkflow];

    // Phase 1: Wait 1.2s to simulate "hearing" the voice input
    if (phase === "typing") {
      const timer = setTimeout(() => setPhase("executing"), 1200);
      return () => clearTimeout(timer);
    }

    // Phase 2: Reveal each execution step with 400ms stagger
    if (phase === "executing") {
      if (visibleSteps < workflow.steps.length) {
        const timer = setTimeout(() => setVisibleSteps((s) => s + 1), 400);
        return () => clearTimeout(timer);
      }
      const timer = setTimeout(() => setPhase("holding"), 300);
      return () => clearTimeout(timer);
    }

    // Phase 3: Hold the completed state for 2.5s, then advance
    if (phase === "holding") {
      const timer = setTimeout(advance, 2500);
      return () => clearTimeout(timer);
    }
  }, [phase, visibleSteps, activeWorkflow, workflows, advance]);

  const workflow = workflows[activeWorkflow];

  return (
    <div className="w-full overflow-hidden rounded-xl border border-glass-border bg-bg-primary/80 font-mono text-xs sm:text-sm">
      {/* Title bar */}
      <div className="flex items-center gap-1.5 border-b border-glass-border px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-text-muted/30" />
        <span className="h-2.5 w-2.5 rounded-full bg-text-muted/30" />
        <span className="h-2.5 w-2.5 rounded-full bg-text-muted/30" />
        <span className="ml-2 text-[10px] text-text-muted">Koda &mdash; developer workflow</span>
      </div>

      <div className="h-72 overflow-hidden p-4 sm:h-80 sm:p-5">
        {/* Voice input line */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeWorkflow}
            className="mb-4 flex items-start gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <span className="mt-0.5 text-accent">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            </span>
            <span className="text-text-secondary italic">
              &ldquo;{workflow.input}&rdquo;
            </span>
          </motion.div>
        </AnimatePresence>

        {/* Executing steps */}
        <div className="flex flex-col gap-1.5">
          <AnimatePresence mode="wait">
            <motion.div key={activeWorkflow} className="flex flex-col gap-1.5">
              {workflow.steps.map((step, i) => (
                <motion.div
                  key={`${activeWorkflow}-${i}`}
                  className="flex items-center gap-2"
                  initial={{ opacity: 0, x: -6 }}
                  animate={{
                    opacity: i < visibleSteps ? 1 : 0,
                    x: i < visibleSteps ? 0 : -6,
                  }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                >
                  <span className="text-accent/60">$</span>
                  <span className="text-foreground">{step}</span>
                  {i < visibleSteps - 1 && (
                    <motion.span
                      className="ml-auto text-accent/80"
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.2 }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </motion.span>
                  )}
                </motion.div>
              ))}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Blinking cursor */}
        {phase === "executing" && visibleSteps < workflow.steps.length && (
          <motion.span
            className="mt-2 inline-block h-3.5 w-1.5 bg-accent"
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </div>

      {/* Progress dots */}
      <div className="flex justify-center gap-1.5 border-t border-glass-border px-4 py-2.5">
        {workflows.map((_, i) => (
          <button
            key={i}
            onClick={() => {
              setActiveWorkflow(i);
              setVisibleSteps(0);
              setPhase("typing");
            }}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === activeWorkflow ? "w-5 bg-accent" : "w-1.5 bg-text-muted/30"
            }`}
            aria-label={`Show workflow ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}

/** Developer Workflows section with animated terminal demo and capability pills.
 *
 * Shows a simulated terminal running voice-driven dev workflows, plus a row
 * of capability badges (Terminal Control, Git Workflows, etc.).
 *
 * @returns The dev workflows section
 */
export default function DevWorkflows() {
  return (
    <section id="dev-workflows" className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 sm:py-20 md:py-28">
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
          {DEV_WORKFLOWS.heading}
        </motion.h2>
        <motion.p
          className="mx-auto max-w-2xl text-sm text-text-secondary sm:text-base"
          variants={fadeInUp}
        >
          {DEV_WORKFLOWS.subheading}
        </motion.p>
      </motion.div>

      {/* Terminal demo */}
      <motion.div
        className="mx-auto max-w-2xl"
        initial="hidden"
        whileInView="visible"
        viewport={viewportConfig}
        variants={fadeInUp}
      >
        <WorkflowTerminal />
      </motion.div>

      {/* Capability pills */}
      <motion.div
        className="mt-12 flex flex-wrap justify-center gap-2 sm:mt-16 sm:gap-3"
        initial="hidden"
        whileInView="visible"
        viewport={viewportConfig}
        variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
      >
        {DEV_WORKFLOWS.capabilities.map((cap) => (
          <motion.div
            key={cap.label}
            variants={fadeInUp}
            className="flex items-center gap-2 rounded-full border border-glass-border bg-bg-tertiary/50 px-4 py-2 font-mono text-xs text-text-secondary sm:text-sm"
          >
            <span className="text-accent">{capabilityIcons[cap.icon]}</span>
            {cap.label}
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}
