"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { NAV } from "@/lib/constants";
import Button from "@/components/ui/Button";
import Logo from "@/components/ui/Logo";

/** Smooth-scroll handler for anchor links.
 *
 * Intercepts clicks on `#`-prefixed hrefs and scrolls the target element
 * into view smoothly instead of triggering a page navigation.
 *
 * @param e - Mouse event from anchor click
 */
function smoothScroll(e: React.MouseEvent<HTMLAnchorElement>) {
  const href = e.currentTarget.getAttribute("href");
  if (href?.startsWith("#")) {
    e.preventDefault();
    document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth" });
  }
}

/** Fixed-position navigation bar with scroll-aware glass effect and mobile menu.
 *
 * Tracks scroll position to toggle between transparent and glass-background
 * styles. Includes a responsive hamburger menu (animated to X on open) for
 * mobile viewports. Desktop nav uses inline links with hover underline animation.
 *
 * @returns The navbar component
 */
export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > 20);
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 1280) setMenuOpen(false);
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <nav
      className={`fixed top-0 z-50 w-full transition-all duration-500 ${
        scrolled || menuOpen
          ? "border-gradient-b bg-glass backdrop-blur-xl"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-6">
        <a
          href="#"
          className="flex items-center gap-2 transition-all duration-300 hover:opacity-80"
        >
          <Logo size={28} className="text-accent" />
          <span className="hidden font-display text-xl font-bold tracking-tight text-foreground sm:block">
            {NAV.brand}
          </span>
        </a>

        <div className="flex items-center gap-4 sm:gap-8">
          <ul className="hidden items-center gap-8 xl:flex">
            {NAV.links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={smoothScroll}
                  className="relative text-sm tracking-wide text-text-secondary transition-colors duration-200 after:absolute after:-bottom-1 after:left-0 after:h-px after:w-0 after:bg-accent after:transition-all after:duration-300 hover:text-foreground hover:after:w-full"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="hidden xl:block">
            <Button href="#early-access">
              {NAV.cta}
            </Button>
          </div>

          {/* Mobile hamburger */}
          <button
            className="relative flex h-10 w-10 items-center justify-center rounded-lg text-text-secondary transition-colors hover:text-foreground xl:hidden"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <motion.line
                x1="3"
                x2="17"
                initial={false}
                animate={
                  menuOpen
                    ? { y1: 10, y2: 10, rotate: 45 }
                    : { y1: 5, y2: 5, rotate: 0 }
                }
                transition={{ duration: 0.25 }}
                style={{ transformOrigin: "center" }}
              />
              {/* Top bar rotates 45° when menu opens */}
              <motion.line
                x1="3"
                x2="17"
                y1="10"
                y2="10"
                initial={false}
                animate={menuOpen ? { opacity: 0 } : { opacity: 1 }}
                transition={{ duration: 0.15 }}
              />
              {/* Middle bar fades out when menu opens */}
              <motion.line
                x1="3"
                x2="17"
                initial={false}
                animate={
                  menuOpen
                    ? { y1: 10, y2: 10, rotate: -45 }
                    : { y1: 15, y2: 15, rotate: 0 }
                }
                transition={{ duration: 0.25 }}
                style={{ transformOrigin: "center" }}
              />
              {/* Bottom bar rotates -45° when menu opens */}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu panel */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden xl:hidden"
          >
            <div className="flex flex-col gap-1 px-5 py-4 sm:px-6">
              {NAV.links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={(e) => {
                    smoothScroll(e);
                    setMenuOpen(false);
                  }}
                  className="rounded-lg px-3 py-3 text-sm tracking-wide text-text-secondary transition-colors duration-200 hover:bg-glass-highlight hover:text-foreground"
                >
                  {link.label}
                </a>
              ))}
              <div className="mt-2 border-t border-glass-border pt-2 xl:hidden">
                <Button href="#early-access" className="w-full">
                  {NAV.cta}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
