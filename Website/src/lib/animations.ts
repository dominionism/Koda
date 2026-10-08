import type { Variants } from "framer-motion";

/** Fade-in-up animation variant — element fades in while moving up 24px.
 * Uses cubic-bezier easing for a smooth, natural entrance.
 */
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  },
};

/** Fade-in animation variant — element fades in place without translation.
 * Longer duration (0.8s) with easeOut for a gentle appearance.
 */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.8, ease: "easeOut" },
  },
};

/** Slide-in-from-left animation variant — fades in while moving right 40px.
 */
export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -40 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  },
};

/** Slide-in-from-right animation variant — fades in while moving left 40px.
 */
export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 40 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  },
};

/** Stagger container variant — distributes children with 120ms intervals.
 */
export const stagger: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.12,
    },
  },
};

/** Fast stagger container variant — distributes children with 60ms intervals.
 */
export const staggerFast: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.06,
    },
  },
};

/** Scale-in animation variant — fades in while scaling up from 0.92.
 */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
  },
};

/** Glow-in animation variant — fades in with blur reduction and subtle scale.
 * Creates a bloom-like entrance effect.
 */
export const glowIn: Variants = {
  hidden: { opacity: 0, scale: 0.95, filter: "blur(8px)" },
  visible: {
    opacity: 1,
    scale: 1,
    filter: "blur(0px)",
    transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] },
  },
};

/** Dynamic fill-bar variant factory — creates a Variants object for animated progress bars.
 *
 * @param targetWidth - Target width percentage (0-100)
 * @param delay - Stagger delay in seconds before animation starts
 * @returns framer-motion Variants object
 */
export const fillBar = (targetWidth: number, delay: number = 0): Variants => ({
  hidden: { width: "0%" },
  visible: {
    width: `${targetWidth}%`,
    transition: { duration: 1, delay, ease: [0.16, 1, 0.3, 1] },
  },
});

/** SVG path draw animation variant — animates stroke-dashoffset for line drawing.
 */
export const drawLine: Variants = {
  hidden: { pathLength: 0 },
  visible: {
    pathLength: 1,
    transition: { duration: 1.2, ease: "easeInOut" },
  },
};

/** Reusable viewport configuration for scroll-triggered animations.
 * once: true — animation only plays once, amount: 0.3 — triggered when 30% visible.
 */
export const viewportConfig = { once: true, amount: 0.3 } as const;

/** Spring transition configuration for physics-based animations.
 * stiffness: 200, damping: 20 — moderate bounce without overshoot.
 */
export const springTransition = {
  type: "spring" as const,
  stiffness: 200,
  damping: 20,
};
