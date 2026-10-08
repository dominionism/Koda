"use client";

import { motion } from "framer-motion";
import { fadeInUp, viewportConfig } from "@/lib/animations";
import FeatureCard from "./FeatureRow";
import CommandShowcase from "@/components/commands/CommandShowcase";
import { FEATURES } from "@/lib/constants";

/** Features section with heading, subheading, and a 5-column grid of feature cards.
 *
 * Destructures four feature items (voice, privacy, speed, devMode) from constants
 * and renders them as FeatureCard components with a CommandShowcase at the bottom.
 * Grid layout uses responsive column spans for visual hierarchy.
 *
 * @returns The features section
 */
export default function Features() {
  const [voice, privacy, speed, devMode] = FEATURES.items;

  return (
    <section id="features" className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 sm:py-20 md:py-28">
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
          {FEATURES.heading}
        </motion.h2>
        <motion.p
          className="mx-auto max-w-2xl text-sm text-text-secondary sm:text-base"
          variants={fadeInUp}
        >
          {FEATURES.subheading}
        </motion.p>
      </motion.div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        <FeatureCard
          heading={voice.heading}
          description={voice.description}
          visual={voice.visual}
          className="md:col-span-2 lg:col-span-3"
        />
        <FeatureCard
          heading={privacy.heading}
          description={privacy.description}
          visual={privacy.visual}
          className="lg:col-span-2"
        />
        <FeatureCard
          heading={speed.heading}
          description={speed.description}
          visual={speed.visual}
          className="lg:col-span-2"
        />
        <FeatureCard
          heading={devMode.heading}
          description={devMode.description}
          visual={devMode.visual}
          className="md:col-span-2 lg:col-span-3"
        />
        <CommandShowcase className="md:col-span-2 lg:col-span-5" />
      </div>
    </section>
  );
}
