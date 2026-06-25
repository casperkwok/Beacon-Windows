// Beacon brand mark — a lighthouse beacon: concentric golden arcs radiating
// from a glowing dot, on a navy rounded square. Recreated as crisp inline SVG.

export default function BeaconLogo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bcn-dot" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FBD774" />
          <stop offset="1" stopColor="#F0A93C" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="45" height="45" rx="11.5" fill="#141d33" />
      <path d="M8 33 A16 16 0 0 1 40 33" stroke="#7c6a40" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M12.5 33 A11.5 11.5 0 0 1 35.5 33" stroke="#c79a47" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M17 33 A7 7 0 0 1 31 33" stroke="#f0bd5a" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="24" cy="33" r="3.4" fill="url(#bcn-dot)" />
    </svg>
  );
}
