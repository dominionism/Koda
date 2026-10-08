"use client";

import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { fadeInUp, glowIn } from "@/lib/animations";
import { HERO } from "@/lib/constants";
import Button from "@/components/ui/Button";
import CommandPalette from "./CommandPalette";
import AnimatedHeadline from "./AnimatedHeadline";

const DivergenceVisual = dynamic(() => import("./DivergenceVisual"), {
  ssr: false,
  loading: () => (
    <div style={{ width: 560, height: 430, maxWidth: "100%" }} aria-hidden="true" />
  ),
});

/** Hero section — top-of-page brand introduction with animated face, headline, and CTAs.
 *
 * Dynamically imports the DivergenceVisual (Three.js face animation) with SSR disabled.
 * Composes the animated headline, subheadline, command palette demo, and primary/secondary
 * call-to-action buttons.
 *
 * @returns The hero section component
 */
export default function Hero() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center px-5 pt-20 sm:px-6 sm:pt-24">
      {/* Hero background glow */}
      <div
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2"
        aria-hidden="true"
        style={{
          width: 1000,
          height: 600,
          background:
            "radial-gradient(ellipse at center, rgba(255, 255, 255, 0.06) 0%, transparent 60%)",
          filter: "blur(60px)",
        }}
      />

      <motion.div
        className="relative flex w-full max-w-4xl flex-col items-center gap-8 sm:gap-10 md:gap-12"
        initial="hidden"
        animate="visible"
        variants={{
          visible: { transition: { staggerChildren: 0.18 } },
        }}
      >
        {/* Divergence — human splits into Koda */}
        <motion.div variants={glowIn}>
          <DivergenceVisual />
        </motion.div>

        {/* Headline */}
        <AnimatedHeadline />

        {/* Subheadline */}
        <motion.p
          variants={fadeInUp}
          className="max-w-2xl text-center text-base leading-relaxed text-text-secondary sm:text-lg md:text-xl"
        >
          {HERO.subheadline}
        </motion.p>

        {/* Command Palette Demo */}
        <motion.div variants={fadeInUp} className="w-full max-w-xl">
          <CommandPalette />
        </motion.div>

        {/* CTAs */}
        <motion.div
          variants={fadeInUp}
          className="flex flex-col items-center gap-4 sm:flex-row"
        >
          <Button
            href="#join"
            className="px-8 py-3.5"
          >
            {HERO.cta_primary}
          </Button>
          <a
            href="#how-it-works"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" });
            }}
            className="group flex items-center gap-2 text-sm text-text-secondary transition-colors duration-200 hover:text-foreground"
          >
            {HERO.cta_secondary}
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              className="transition-transform duration-200 group-hover:translate-y-0.5"
              aria-hidden="true"
            >
              <path
                d="M8 3v10M4 9l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </a>
        </motion.div>
      </motion.div>
    </section>
  );
}
