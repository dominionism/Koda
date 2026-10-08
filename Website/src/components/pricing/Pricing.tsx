"use client";

import { motion } from "framer-motion";
import { fadeInUp, viewportConfig } from "@/lib/animations";
import PricingTier from "./PricingTier";
import { PRICING } from "@/lib/constants";

/** Pricing section with a responsive grid of pricing tiers.
 *
 * Maps PRICING.tiers from constants to PricingTier components with
 * staggered entrance animation on scroll.
 *
 * @returns The pricing section
 */
export default function Pricing() {
  return (
    <section id="pricing" className="relative mx-auto max-w-6xl px-5 py-16 sm:px-6 sm:py-20 md:py-28">
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
          {PRICING.heading}
        </motion.h2>
        <motion.p
          className="text-sm text-text-secondary sm:text-base"
          variants={fadeInUp}
        >
          {PRICING.subheading}
        </motion.p>
      </motion.div>

      <motion.div
        className="mx-auto grid max-w-5xl grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3"
        initial="hidden"
        whileInView="visible"
        viewport={viewportConfig}
        variants={{ visible: { transition: { staggerChildren: 0.15 } } }}
      >
        {PRICING.tiers.map((tier) => (
          <PricingTier
            key={tier.name}
            name={tier.name}
            price={tier.price}
            period={tier.period}
            description={tier.description}
            features={tier.features}
            cta={tier.cta}
            highlighted={tier.highlighted}
            badge={tier.badge}
          />
        ))}
      </motion.div>
    </section>
  );
}
