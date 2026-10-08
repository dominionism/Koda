"use client";

import { useState, useRef } from "react";
import Button from "@/components/ui/Button";

type Status = "idle" | "loading" | "success" | "error";

/** Email signup form with client-side validation and API submission.
 *
 * Handles the full lifecycle: idle, loading (during fetch), success (thank-you
 * message), and error (inline error display). Includes a hidden honeypot field
 * for bot detection. Uses aria-invalid and aria-describedby for accessibility.
 *
 * @returns Signup form or success message
 */
export default function SignupForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const emailRef = useRef<HTMLInputElement | null>(null);

  function validateEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage("");

    if (!validateEmail(email)) {
      setErrorMessage("Please enter a valid email address.");
      setStatus("error");
      emailRef.current?.focus();
      return;
    }

    setStatus("loading");

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 200 || res.status === 201) {
        setStatus("success");
        setEmail("");
        setErrorMessage("");
      } else if (res.status === 422) {
        setErrorMessage(data?.message || "Please provide a valid email.");
        setStatus("error");
        emailRef.current?.focus();
      } else {
        setErrorMessage(data?.message || "Something went wrong. Please try again later.");
        setStatus("error");
        emailRef.current?.focus();
      }
    } catch (_err) {
      setErrorMessage("Network error. Please try again.");
      setStatus("error");
      emailRef.current?.focus();
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-lg bg-surface/60 p-6 text-center">
        <p className="text-lg font-medium text-foreground">Thanks! You're on the list.</p>
        <p className="mt-2 text-sm text-text-secondary">We'll send occasional updates — no spam.</p>
      </div>
    );
  }

  return (
    <form className="w-full" onSubmit={handleSubmit} aria-live="polite">
      {/* Honeypot field — hidden from users, traps automated bots that fill invisible fields */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        className="absolute -left-[9999px] opacity-0"
        aria-hidden="true"
      />

      <div className="flex w-full items-center gap-3">
        <label htmlFor="signup-email" className="sr-only">
          Email address
        </label>
        <input
          ref={emailRef}
          id="signup-email"
          name="email"
          type="email"
          placeholder="Enter your email"
          className="w-full rounded-full border border-muted/60 bg-transparent px-4 py-3 text-sm placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={status === "error"}
          aria-describedby={errorMessage ? "signup-error" : undefined}
          required
        />

        <Button type="submit" disabled={status === "loading"} className="px-6 py-2">
          {status === "loading" ? "Joining..." : "Join"}
        </Button>
      </div>

      <div className="mt-2 min-h-[1.25rem]">
        {status === "error" && (
          <p id="signup-error" role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        )}
      </div>
    </form>
  );
}
