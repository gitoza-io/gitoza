/**
 * Layout: sticky content at top, scrollable content below (one scrollbar).
 * Use with bodyScroll={false} on DetailPanel so only this block scrolls.
 * Typical edit stack: sticky title/id; scroll metadata, then sticky toolbar + body.
 * overflow-x-clip (not hidden) so descendants can use position:sticky.
 * Scroll overlaps the sticky block by 1px so content cannot show through the seam.
 */
export default function StickyThenScroll({ stickyContent, scrollContent, className = "" }) {
  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${className}`}>
      <div className="relative z-20 shrink-0">{stickyContent}</div>
      <div className="relative z-0 -mt-px min-h-0 flex-1 overflow-x-clip overflow-y-auto">
        {scrollContent}
      </div>
    </div>
  );
}
