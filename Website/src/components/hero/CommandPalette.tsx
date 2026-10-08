"use client";

import { useState, useCallback } from "react";
import { HERO } from "@/lib/constants";
import TypeWriter from "@/components/ui/TypeWriter";
import MockMenuBar from "./MockMenuBar";
import ActionCards from "./ActionCards";

/** Simulated command palette demo showing a typed command and resulting actions.
 *
 * Renders a glass-morphism card with a mock menu bar, a TypeWriter that types
 * the demo command, and action cards that appear once typing completes.
 * Uses useCallback to memoize the completion handler.
 *
 * @returns Interactive command palette demo card
 */
export default function CommandPalette() {
  const [typingDone, setTypingDone] = useState(false);

  const handleTypingComplete = useCallback(() => {
    setTypingDone(true);
  }, []);

  return (
    <div className="glass-card glow-accent mx-auto w-full max-w-xl overflow-hidden rounded-xl shadow-2xl sm:rounded-2xl">
      <MockMenuBar />

      <div className="min-h-44 sm:min-h-48">
        <div className="flex items-start gap-3 px-4 py-3 sm:px-5 sm:py-4">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 shrink-0 text-accent"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <TypeWriter
            text={HERO.demo_command}
            speed={45}
            delay={1200}
            onComplete={handleTypingComplete}
            className="font-mono text-sm text-foreground"
          />
        </div>

        <ActionCards visible={typingDone} />
      </div>
    </div>
  );
}
