"use client";

import { motion } from "framer-motion";
import { fadeInUp, viewportConfig } from "@/lib/animations";
import { CTA } from "@/lib/constants";
import SignupForm from "./SignupForm";

/** Call-to-action section with headline, signup form, and background glow.
 *
 * Renders a centered CTA card with the mailing list signup form, a subtitle,
 * and a small note below. Includes a decorative background radial glow.
 *
 * @returns The CTA section component
 */
export default function CTASection() {
  return (
    <section id="join" className="relative overflow-hidden py-20 sm:py-28 md:py-32">
      {/* Background glow */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        aria-hidden="true"
        style={{
          width: 800,
          height: 400,
          background:
            "radial-gradient(ellipse, rgba(255, 255, 255, 0.08) 0%, transparent 70%)",
          filter: "blur(60px)",
        }}
      />

      <motion.div
        className="relative mx-auto flex max-w-3xl flex-col items-center gap-6 px-5 text-center sm:gap-8 sm:px-6"
        initial="hidden"
        whileInView="visible"
        viewport={viewportConfig}
        variants={{ visible: { transition: { staggerChildren: 0.15 } } }}
      >
        <motion.h2
          variants={fadeInUp}
          className="font-display text-3xl font-bold leading-tight text-foreground sm:text-4xl md:text-6xl"
        >
          {CTA.headline}
        </motion.h2>

        <motion.p
          variants={fadeInUp}
          className="max-w-xl text-base text-text-secondary sm:text-lg"
        >
          {CTA.subheadline}
        </motion.p>

        <motion.div variants={fadeInUp} className="w-full max-w-md">
          <SignupForm />
        </motion.div>

        <motion.p
          variants={fadeInUp}
          className="font-mono text-xs text-text-muted"
        >
          {CTA.note}
        </motion.p>
      </motion.div>
    </section>
  );
}
