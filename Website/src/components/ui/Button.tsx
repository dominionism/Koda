"use client";

import { type ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  href?: string;
}

/** Polymorphic button component rendering either a <button> or <a> tag.
 *
 * Supports "primary" and "secondary" visual variants. When an `href` is
 * provided, renders as an anchor element for navigation.
 *
 * @param props.variant - Visual style variant ("primary" | "secondary")
 * @param props.href - Optional URL; when set, renders as <a> instead of <button>
 * @param props.children - Button content
 * @param props.className - Additional CSS classes
 * @param props.props - Additional HTML button attributes
 * @returns A styled button or anchor element
 */
export default function Button({
  variant = "primary",
  href,
  children,
  className = "",
  ...props
}: ButtonProps) {
  const base =
    "relative inline-flex items-center justify-center overflow-hidden rounded-full px-7 py-3 text-sm font-medium tracking-wide transition-all duration-300 cursor-pointer";

  const variants: Record<ButtonVariant, string> = {
    primary: [
      "btn-primary text-foreground",
      "hover:scale-[1.03]",
      "active:scale-[0.97]",
    ].join(" "),
    secondary: [
      "btn-secondary text-text-secondary",
      "hover:text-foreground",
      "hover:scale-[1.03]",
      "active:scale-[0.97]",
    ].join(" "),
  };

  const classes = `${base} ${variants[variant]} ${className}`;

  if (href) {
    return (
      <a href={href} className={classes}>
        <span className="relative z-10">{children}</span>
      </a>
    );
  }

  return (
    <button className={classes} {...props}>
      <span className="relative z-10">{children}</span>
    </button>
  );
}
