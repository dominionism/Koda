"use client";

import { motion } from "framer-motion";
import { HERO } from "@/lib/constants";

const charVariants = {
  hidden: {
    opacity: 0,
    y: 20,
    filter: "blur(8px)",
  },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
  },
};

const accentCharVariants = {
  hidden: {
    opacity: 0,
    y: 24,
    filter: "blur(12px)",
    scale: 0.95,
  },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    scale: 1,
  },
};

/** Animated two-line hero headline with per-character staggered reveal.
 *
 * The first line fades in with blur from below; the second line uses a
 * stronger entrance (glow bloom + scale) with a gradient text effect.
 * Non-breaking spaces replace regular spaces for layout stability.
 *
 * @returns Animated h1 element
 */
export default function AnimatedHeadline() {
  const topChars = HERO.headline.split("");
  const accentChars = HERO.headline_accent.split("");

  return (
    <h1 className="text-center font-display text-3xl font-bold leading-[1.05] tracking-tight sm:text-5xl md:text-7xl">
      {/* "Your" — subtle fade-blur per character */}
      <motion.span
        className="inline-block text-foreground"
        initial="hidden"
        animate="visible"
        variants={{
          visible: {
            transition: { staggerChildren: 0.06, delayChildren: 0.3 },
          },
        }}
      >
        {topChars.map((char, i) => (
          <motion.span
            key={i}
            className="inline-block"
            variants={charVariants}
            transition={{
              duration: 0.5,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            {char === " " ? "\u00A0" : char}
          </motion.span>
        ))}
      </motion.span>

      <br />

      {/* "Second Half" — bolder entrance with glow bloom */}
      <motion.span
        className="inline-block"
        initial="hidden"
        animate="visible"
        variants={{
          visible: {
            transition: { staggerChildren: 0.05, delayChildren: 0.7 },
          },
        }}
      >
        {accentChars.map((char, i) => (
          <motion.span
            key={i}
            className="inline-block gradient-text"
            variants={accentCharVariants}
            transition={{
              duration: 0.6,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            {char === " " ? "\u00A0" : char}
          </motion.span>
        ))}
      </motion.span>
    </h1>
  );
}
