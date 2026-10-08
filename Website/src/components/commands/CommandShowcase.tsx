"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { fadeInUp, viewportConfig } from "@/lib/animations";
import { COMMANDS } from "@/lib/constants";

type Phase = "typing" | "showing-actions" | "holding" | "clearing";

const TYPING_SPEED = 40;
const PAUSE_AFTER_TYPING = 500;
const ACTION_STAGGER = 200;
const HOLD_DURATION = 2000;
const CLEAR_DURATION = 400;

/** Interactive command showcase cycling through demo voice commands and their resulting actions.
 *
 * Simulates a terminal-like flow: types the command character by character,
 * reveals resulting system actions staggered, holds for a moment, then fades
 * out and advances to the next example. Progress dots indicate current example.
 *
 * @param props.className - Additional CSS classes for grid placement
 * @returns Interactive command showcase card
 */
export default function CommandShowcase({ className = "" }: { className?: string }) {
  const [exampleIndex, setExampleIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("typing");
  const [typedCount, setTypedCount] = useState(0);
  const [visibleActions, setVisibleActions] = useState(0);
  const [fading, setFading] = useState(false);

  const example = COMMANDS.examples[exampleIndex];
  const input = example.input;
  const actions = example.actions;

  useEffect(() => {
    if (phase !== "typing") return;

    if (typedCount < input.length) {
      const timer = setTimeout(() => {
        setTypedCount((c) => c + 1);
      }, TYPING_SPEED);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      setPhase("showing-actions");
    }, PAUSE_AFTER_TYPING);
    return () => clearTimeout(timer);
  }, [phase, typedCount, input.length]);

  useEffect(() => {
    if (phase !== "showing-actions") return;

    if (visibleActions < actions.length) {
      const timer = setTimeout(() => {
        setVisibleActions((v) => v + 1);
      }, ACTION_STAGGER);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      setPhase("holding");
    }, 0);
    return () => clearTimeout(timer);
  }, [phase, visibleActions, actions.length]);

  useEffect(() => {
    if (phase !== "holding") return;

    const timer = setTimeout(() => {
      setPhase("clearing");
      setFading(true);
    }, HOLD_DURATION);
    return () => clearTimeout(timer);
  }, [phase]);

  const advanceToNext = useCallback(() => {
    setExampleIndex((i) => (i + 1) % COMMANDS.examples.length);
    setTypedCount(0);
    setVisibleActions(0);
    setFading(false);
    setPhase("typing");
  }, []);

  useEffect(() => {
    if (phase !== "clearing") return;

    const timer = setTimeout(advanceToNext, CLEAR_DURATION);
    return () => clearTimeout(timer);
  }, [phase, advanceToNext]);

  const isTyping = phase === "typing" && typedCount < input.length;

  return (
    <motion.div
      className={`glass-card glass-card-hover flex flex-col rounded-xl p-6 sm:rounded-2xl sm:p-8 md:p-10 ${className}`}
      variants={fadeInUp}
      initial="hidden"
      whileInView="visible"
      viewport={viewportConfig}
    >
      <div className="mb-6 sm:mb-8">
        <h3 className="mb-2 font-display text-lg font-bold text-foreground sm:mb-3 sm:text-xl md:text-2xl">
          {COMMANDS.heading}
        </h3>
        <p className="text-sm leading-relaxed text-text-secondary sm:text-base">
          {COMMANDS.subheading}
        </p>
      </div>

      <div className="flex-1 rounded-lg border border-glass-border bg-bg-tertiary/50 p-4 font-mono sm:rounded-xl sm:p-5 min-h-44 sm:min-h-48">
        <div className="mb-4 flex items-center gap-2">
          <span className="block h-2 w-2 rounded-full bg-[#ff5f57]/80" />
          <span className="block h-2 w-2 rounded-full bg-[#febc2e]/80" />
          <span className="block h-2 w-2 rounded-full bg-[#28c840]/80" />
          <span className="ml-2 text-xs text-text-muted">Koda</span>
        </div>

        <div
          className="transition-opacity duration-300"
          style={{ opacity: fading ? 0 : 1 }}
        >
          <div className="text-sm text-text-secondary">
            <span className="text-accent">{"> "}</span>
            {input.slice(0, typedCount)}
            {isTyping && (
              <span className="animate-pulse text-accent">|</span>
            )}
          </div>

          {visibleActions > 0 && (
            <div className="mt-3 space-y-1.5">
              {actions.slice(0, visibleActions).map((action, i) => (
                <div key={i} className="text-xs text-text-secondary">
                  <span className="text-accent-light">{"=> "}</span>
                  {action}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Progress dots */}
      <div className="mt-4 flex justify-center gap-2">
        {COMMANDS.examples.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === exampleIndex
                ? "w-6 bg-accent"
                : "w-1.5 bg-border-light"
            }`}
          />
        ))}
      </div>
    </motion.div>
  );
}
