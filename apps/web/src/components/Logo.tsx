/** Знак «Летописи» — двадцатигранник. При наведении на шапку он «катится». */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={`d20${className ? ` ${className}` : ''}`}>
      <path className="d20-face" d="M16 9 23.5 21h-15z" />
      <path d="M16 2 28 9v14L16 30 4 23V9z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path
        d="M16 2v7M28 9 16 9M28 9l-4.5 12M28 23l-4.5-2M16 30l7.5-9M16 30l-7.5-9M4 23l4.5-2M4 9l4.5 12M4 9h12M16 9l7.5 12h-15z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
        opacity=".65"
      />
    </svg>
  );
}
