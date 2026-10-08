"use client";

import { motion } from "framer-motion";
import { HERO } from "@/lib/constants";

const iconSvg = (children: React.ReactNode) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

const icons: Record<string, React.ReactNode> = {
  app: iconSvg(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /></>),
  globe: iconSvg(<><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></>),
  expand: iconSvg(<><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>),
  folder: iconSvg(<><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></>),
  terminal: iconSvg(<><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></>),
  code: iconSvg(<><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></>),
};

interface ActionCardsProps {
  visible: boolean;
}

/** Animated action-card chips displayed after the demo command finishes typing.
 *
 * Each card represents a system action inferred from the demo command, shown
 * with a relevant icon. Cards stagger in with a scale+fade entrance animation.
 *
 * @param props.visible - Whether the actions should animate into view
 * @returns A row of action chips
 */
export default function ActionCards({ visible }: ActionCardsProps) {
  return (
    <motion.div
      className="flex flex-wrap gap-1.5 px-4 pb-4 sm:gap-2 sm:px-5 sm:pb-5"
      initial="hidden"
      animate={visible ? "visible" : "hidden"}
      variants={{ visible: { transition: { staggerChildren: 0.15 } } }}
    >
      {HERO.demo_actions.map((action) => (
        <motion.div
          key={action.label}
          variants={{
            hidden: { opacity: 0, y: 8, scale: 0.95 },
            visible: {
              opacity: 1,
              y: 0,
              scale: 1,
              transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] },
            },
          }}
          className="flex items-center gap-1.5 rounded-lg border border-glass-border bg-bg-tertiary px-2.5 py-1.5 font-mono text-xs text-text-secondary sm:gap-2 sm:px-3 sm:py-2 sm:text-sm"
        >
          <span className="text-accent">{icons[action.icon]}</span>
          {action.label}
        </motion.div>
      ))}
    </motion.div>
  );
}
