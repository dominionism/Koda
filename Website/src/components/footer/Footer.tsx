"use client";

import { motion } from "framer-motion";
import { fadeInUp, viewportConfig } from "@/lib/animations";
import { FOOTER } from "@/lib/constants";
import Logo from "@/components/ui/Logo";

/** Icon resolver for social media platforms.
 *
 * Returns the appropriate SVG icon for a given platform name.
 * Currently supports "linkedin"; returns null for unknown platforms.
 *
 * @param props.platform - Social platform identifier
 * @returns SVG icon element or null
 */
function SocialIcon({ platform }: { platform: string }) {
  switch (platform) {
    case "linkedin":
      return (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
          <rect x="2" y="9" width="4" height="12" />
          <circle cx="4" cy="4" r="2" />
        </svg>
      );
    default:
      return null;
  }
}

/** Footer with brand, tagline, social links, and system requirements.
 *
 * Includes a top gradient border, brand logo, tagline, LinkedIn icon,
 * divider line, and bottom bar with system requirements text and copyright.
 *
 * @returns The footer component
 */
export default function Footer() {
  return (
    <footer className="relative w-full border-gradient-t">
      <motion.div
        className="mx-auto max-w-6xl px-5 py-12 sm:px-6 sm:py-16 md:py-20"
        initial="hidden"
        whileInView="visible"
        viewport={viewportConfig}
        variants={{
          visible: { transition: { staggerChildren: 0.1 } },
        }}
      >
        {/* Top section — brand + socials */}
        <motion.div
          variants={fadeInUp}
          className="flex flex-col items-center gap-8 text-center md:flex-row md:items-start md:justify-between md:text-left"
        >
          {/* Brand block */}
          <div className="flex flex-col items-center gap-4 md:items-start">
            <a
              href="#"
              className="flex items-center gap-2.5 transition-opacity duration-300 hover:opacity-80"
            >
              <Logo size={24} className="text-accent" />
              <span className="font-display text-lg font-bold tracking-tight text-foreground">
                {FOOTER.brand}
              </span>
            </a>
            <p className="max-w-xs text-sm leading-relaxed text-text-secondary">
              {FOOTER.tagline}
            </p>
          </div>

          {/* Social icons */}
          <div className="flex items-center gap-3">
            {FOOTER.socials.map((social) => (
              <a
                key={social.platform}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={social.label}
                className="group flex h-10 w-10 items-center justify-center rounded-xl border border-glass-border bg-transparent text-text-secondary transition-all duration-300 hover:border-accent/30 hover:bg-accent/5 hover:text-accent"
              >
                <SocialIcon platform={social.platform} />
              </a>
            ))}
          </div>
        </motion.div>

        {/* Divider */}
        <motion.div variants={fadeInUp} className="section-line mt-10 sm:mt-14" />

        {/* Bottom bar */}
        <motion.div
          variants={fadeInUp}
          className="flex flex-col items-center gap-3 pt-6 sm:pt-8 md:flex-row md:justify-between"
        >
          <p className="font-mono text-xs text-text-muted">
            {FOOTER.systemReqs}
          </p>
          <p className="font-mono text-xs text-text-muted">
            &copy; {new Date().getFullYear()} {FOOTER.copyright}
          </p>
        </motion.div>
      </motion.div>
    </footer>
  );
}
