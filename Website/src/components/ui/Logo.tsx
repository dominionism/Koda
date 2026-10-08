interface LogoProps {
  size?: number;
  className?: string;
}

/** Koda brand logo SVG — two mirrored bracket forms converging at a center node.
 *
 * Represents the duality of "self" and "alter" (left/right forms) converging
 * into one intent at the center circle.
 *
 * @param props.size - Logo dimension in pixels (width/height equal, default 28)
 * @param props.className - Additional CSS classes
 * @returns Inline SVG logo component
 */
export default function Logo({ size = 28, className = "" }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {/* Left form — the self */}
      <path
        d="M5 4L5 10L9 14L5 18L5 24"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Right form — the alter koda */}
      <path
        d="M23 4L23 10L19 14L23 18L23 24"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Left inner echo */}
      <path
        d="M9 7L13 14L9 21"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.4"
      />
      {/* Right inner echo */}
      <path
        d="M19 7L15 14L19 21"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.4"
      />
      {/* Convergence node — where intent meets action */}
      <circle cx="14" cy="14" r="1.5" fill="currentColor" opacity="0.9" />
    </svg>
  );
}
