"use client";

import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/animations";
import Button from "@/components/ui/Button";

interface PricingTierProps {
  name: string;
  price: string;
  period: string;
  description: string;
  features: readonly string[];
  cta: string;
  highlighted: boolean;
  badge: string;
}

/** Single pricing tier card with name, price, feature list, and CTA button.
 *
 * Supports a `highlighted` state that applies glow effects and gradient text
 * on the price, and an optional `badge` displayed as a tag (e.g. "Save 22%").
 *
 * @param props.name - Tier name (e.g. "Free", "Pro", "Koda Elite")
 * @param props.price - Price string (e.g. "$0", "$9")
 * @param props.period - Billing period (e.g. "/month", "/year")
 * @param props.description - Short tier description
 * @param props.features - List of feature strings
 * @param props.cta - Call-to-action button label
 * @param props.highlighted - Whether this tier is visually highlighted
 * @param props.badge - Optional badge text (empty string disables)
 * @returns A pricing tier card
 */
export default function PricingTier({
  name,
  price,
  period,
  description,
  features,
  cta,
  highlighted,
  badge,
}: PricingTierProps) {
  return (
    <motion.div
      variants={fadeInUp}
      className={`relative flex flex-col rounded-xl p-6 sm:rounded-2xl sm:p-8 ${
        highlighted
          ? "glass-card glow-accent"
          : "glass-card"
      }`}
    >
      {badge && (
        <span className="absolute top-4 right-4 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-semibold tracking-wide text-accent sm:top-6 sm:right-6">
          {badge}
        </span>
      )}
      <div className="mb-6">
        <h3 className="mb-3 text-sm font-semibold tracking-wide text-text-secondary uppercase">
          {name}
        </h3>
        <div className="flex items-baseline gap-1">
          <span className={`text-4xl font-bold sm:text-5xl ${highlighted ? "gradient-text" : "text-foreground"}`}>
            {price}
          </span>
          <span className="text-text-muted">{period}</span>
        </div>
        {badge && (
          <p className="mt-1.5 text-xs text-text-muted">$7/mo billed annually</p>
        )}
        <p className="mt-3 text-sm text-text-secondary">{description}</p>
      </div>

      <ul className="mb-8 flex-1 space-y-3">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-3">
            <svg
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="mt-0.5 shrink-0 text-accent"
              aria-hidden="true"
            >
              <path
                d="M6 10L9 13L14 7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="text-sm text-text-secondary">{feature}</span>
          </li>
        ))}
      </ul>

      <Button variant={highlighted ? "primary" : "secondary"} className="mt-auto w-full">
        {cta}
      </Button>
    </motion.div>
  );
}
