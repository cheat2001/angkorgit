/**
 * AngKorGit mark: an Angkor Wat-inspired silhouette (three lotus towers)
 * whose base flows into git branch lines with commit nodes.
 * Original artwork — pure SVG, themeable via currentColor + brand gold.
 */
export function Logo({
  size = 32,
  className,
  animated = false,
}: {
  size?: number;
  className?: string;
  animated?: boolean;
}) {
  const draw = animated
    ? {
        strokeDasharray: 300,
        strokeDashoffset: 300,
        animation: 'angkor-draw 1.6s cubic-bezier(0.6, 0, 0.2, 1) forwards',
      }
    : undefined;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role="img"
      aria-label="AngKorGit"
    >
      {animated && (
        <style>{`@keyframes angkor-draw { to { stroke-dashoffset: 0; } }`}</style>
      )}
      {/* Towers */}
      <g stroke="#D97706" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" style={draw}>
        {/* center tower */}
        <path d="M32 6 L27 20 L27 30 L37 30 L37 20 Z" />
        {/* left tower */}
        <path d="M16 16 L12.5 26 L12.5 34 L19.5 34 L19.5 26 Z" />
        {/* right tower */}
        <path d="M48 16 L44.5 26 L44.5 34 L51.5 34 L51.5 26 Z" />
      </g>
      {/* Branch lines flowing from the temple base */}
      <g stroke="currentColor" strokeWidth={3} strokeLinecap="round" fill="none" style={draw}>
        <path d="M16 40 C16 48 24 46 32 46" />
        <path d="M48 40 C48 48 40 46 32 46" />
        <path d="M32 36 V 54" />
      </g>
      {/* Commit nodes */}
      <circle cx={16} cy={38} r={3.5} fill="#D97706" />
      <circle cx={48} cy={38} r={3.5} fill="#D97706" />
      <circle cx={32} cy={57} r={3.5} fill="currentColor" />
    </svg>
  );
}
