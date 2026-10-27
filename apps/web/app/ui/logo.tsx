// LP Commons mark: one continuous line spells "LP", starting at a yellow dot (you) and ending at a
// mint dot (the LP you reach). Keep in sync with app/icon.svg and the PNG app icons in public/.

export const LOGO = { tile: "#6d5dfc", line: "#ffffff", start: "#ffd23f", end: "#5ee6b0" } as const;

/** `simple` drops the dots and thickens the line so the mark stays legible at favicon sizes. */
export function Logo({ size = 32, simple = size < 28, title }: { size?: number; simple?: boolean; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role={title ? "img" : undefined} aria-hidden={title ? undefined : true}
         aria-label={title} style={{ flex: "none", display: "block" }}>
      <rect width="120" height="120" rx="30" fill={LOGO.tile} />
      <path d="M36 30 V88 H58 V32 H72 A16 16 0 0 1 72 64 H58" stroke={LOGO.line} strokeWidth={simple ? 13 : 9} fill="none"
            strokeLinecap="round" strokeLinejoin="round" />
      {!simple && (
        <>
          <path d="M58 88 H80" stroke={LOGO.line} strokeOpacity="0.5" strokeWidth="4" strokeDasharray="2 6" strokeLinecap="round" />
          <circle cx="36" cy="28" r="9" fill={LOGO.start} />
          <circle cx="88" cy="88" r="9" fill={LOGO.end} />
        </>
      )}
    </svg>
  );
}
