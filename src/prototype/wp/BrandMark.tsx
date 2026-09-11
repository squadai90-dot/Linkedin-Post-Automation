export function BrandMark({ size = 39 }: { size?: number }) {
  return (
    <svg className="brand-mark-svg" width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="wpmark" x1="6" y1="4" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b86ff" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <path
        d="M10 6.5A2.5 2.5 0 0 1 12.5 4h15L38 14.5v27a2.5 2.5 0 0 1-2.5 2.5h-23A2.5 2.5 0 0 1 10 41.5Z"
        fill="url(#wpmark)"
      />
      <path d="M27.5 4 38 14.5h-8a2.5 2.5 0 0 1-2.5-2.5Z" fill="#13233f" fillOpacity=".34" />
      <g stroke="#F2F1FF" strokeWidth="2.2" strokeLinecap="round" className="mark-lines">
        <path d="M16 22h9" />
        <path d="M16 28.5h6" />
        <path d="M16 35h11" />
      </g>
      <path d="M30.5 22 27.5 28.5 32.5 35" stroke="#3dd7b5" strokeWidth="1.1" strokeOpacity=".6" fill="none" />
      <circle className="mark-node" cx="30.5" cy="22" r="2.3" fill="#3dd7b5" />
      <circle className="mark-node" cx="27.5" cy="28.5" r="2.3" fill="#3dd7b5" />
      <circle className="mark-node" cx="32.5" cy="35" r="2.3" fill="#3dd7b5" />
    </svg>
  );
}
