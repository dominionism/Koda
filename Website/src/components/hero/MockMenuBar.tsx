/** Mock macOS-style window menu bar for demo cards.
 *
 * Renders traffic-light dots (red/yellow/green) and a centered "Koda" title.
 * Purely decorative — simulates a native app window chrome.
 *
 * @returns A mock menu bar element
 */
export default function MockMenuBar() {
  return (
    <div className="flex items-center rounded-t-xl border-b border-glass-border bg-bg-tertiary/50 px-4 py-2.5 sm:rounded-t-2xl sm:px-5 sm:py-3">
      <div className="flex gap-2">
        <span className="block h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
        <span className="block h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
        <span className="block h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      </div>
      <span className="flex-1 text-center font-mono text-xs text-text-muted">
        Koda
      </span>
      <div className="w-11" />
    </div>
  );
}
