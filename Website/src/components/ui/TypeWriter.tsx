"use client";

import { useState, useEffect } from "react";

interface TypeWriterProps {
  text: string;
  speed?: number;
  delay?: number;
  onComplete?: () => void;
  className?: string;
}

/** Typewriter animation component that reveals text character by character.
 *
 * Supports an optional delay before typing starts and an onComplete callback.
 * Uses a hidden span for layout stability and a positioned span for the
 * animated text to prevent layout shift during typing.
 *
 * @param props.text - The full text to type out
 * @param props.speed - Milliseconds between each character (default 50)
 * @param props.delay - Delay in ms before typing begins (default 0)
 * @param props.onComplete - Callback fired when all characters are displayed
 * @param props.className - Additional CSS classes
 * @returns A span element with typewriter animation
 */
export default function TypeWriter({
  text,
  speed = 50,
  delay = 0,
  onComplete,
  className = "",
}: TypeWriterProps) {
  const [displayed, setDisplayed] = useState("");
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const delayTimer = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(delayTimer);
  }, [delay]);

  useEffect(() => {
    if (!started) return;

    if (displayed.length < text.length) {
      const timer = setTimeout(() => {
        setDisplayed(text.slice(0, displayed.length + 1));
      }, speed);
      return () => clearTimeout(timer);
    } else {
      onComplete?.();
    }
  }, [displayed, started, text, speed, onComplete]);

  return (
    <span className={`${className} relative`}>
      <span className="invisible" aria-hidden="true">{text}</span>
      <span className="absolute top-0 left-0 right-0">
        {displayed || "\u200B"} {/* Zero-width space prevents empty span collapse */}
        {displayed.length < text.length && started && (
          <span className="animate-pulse">|</span>
        )}
      </span>
    </span>
  );
}
