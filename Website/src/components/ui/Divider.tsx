/** Horizontal section divider with a subtle gradient line.
 *
 * Renders a full-width fading line accent to separate content sections.
 * Uses the `.section-line` CSS class from globals.css.
 *
 * @returns A styled divider element
 */
export default function Divider() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-2 sm:px-6">
      <div className="section-line" />
    </div>
  );
}
