export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <path d="M16 3 27 9.5v13L16 29 5 22.5v-13z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 3v26M5 9.5l22 13M27 9.5l-22 13" stroke="currentColor" strokeWidth="1" opacity=".5" />
      <path d="M16 11.5 20.5 19h-9z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
