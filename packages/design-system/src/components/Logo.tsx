export function Logo({
  size = 32,
  className,
  animated = false,
}: {
  size?: number;
  className?: string;
  animated?: boolean | 'loop';
}) {
  const loop = animated === 'loop';
  const draw = animated
    ? {
        strokeDasharray: 300,
        strokeDashoffset: 300,
        animation: loop
          ? 'angkor-draw-loop 2.6s cubic-bezier(0.6, 0, 0.2, 1) infinite'
          : 'angkor-draw 1.6s cubic-bezier(0.6, 0, 0.2, 1) forwards',
      }
    : undefined;
  const dots = loop ? { animation: 'angkor-dots-loop 2.6s ease-in-out infinite' } : undefined;
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
        <style>{`@keyframes angkor-draw { to { stroke-dashoffset: 0; } }
@keyframes angkor-draw-loop { 0% { stroke-dashoffset: 300; opacity: 1; } 55% { stroke-dashoffset: 0; opacity: 1; } 82% { stroke-dashoffset: 0; opacity: 1; } 100% { stroke-dashoffset: 0; opacity: 0; } }
@keyframes angkor-dots-loop { 0%, 40% { opacity: 0; } 60%, 82% { opacity: 1; } 100% { opacity: 0; } }`}</style>
      )}
      <g stroke="#D97706" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" style={draw}>
        <path d="M32 6 L27 20 L27 30 L37 30 L37 20 Z" />
        <path d="M16 16 L12.5 26 L12.5 34 L19.5 34 L19.5 26 Z" />
        <path d="M48 16 L44.5 26 L44.5 34 L51.5 34 L51.5 26 Z" />
      </g>
      <g stroke="currentColor" strokeWidth={3} strokeLinecap="round" fill="none" style={draw}>
        <path d="M16 40 C16 48 24 46 32 46" />
        <path d="M48 40 C48 48 40 46 32 46" />
        <path d="M32 36 V 54" />
      </g>
      <circle cx={16} cy={38} r={3.5} fill="#D97706" style={dots} />
      <circle cx={48} cy={38} r={3.5} fill="#D97706" style={dots} />
      <circle cx={32} cy={57} r={3.5} fill="currentColor" style={dots} />
    </svg>
  );
}
