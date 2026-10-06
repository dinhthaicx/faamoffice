// FaamOffice ring + dot mark (inline SVG, brand gradients).

export function LogoMark({ className, idPrefix = "logo" }: { className?: string; idPrefix?: string }) {
  const ring = `${idPrefix}-ring`;
  const dot = `${idPrefix}-dot`;
  return (
    <svg viewBox="180 160 700 700" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={ring} gradientUnits="userSpaceOnUse" x1="205" y1="0" x2="818" y2="0">
          <stop offset="0" stopColor="#3AAC71" />
          <stop offset="0.24" stopColor="#349C8B" />
          <stop offset="0.318" stopColor="#32A6A5" />
          <stop offset="0.514" stopColor="#2B95C2" />
          <stop offset="0.71" stopColor="#2485DF" />
          <stop offset="1" stopColor="#1D74FA" />
        </linearGradient>
        <linearGradient id={dot} gradientUnits="userSpaceOnUse" x1="746" y1="0" x2="856" y2="0">
          <stop offset="0" stopColor="#5FAC39" />
          <stop offset="0.236" stopColor="#349A34" />
          <stop offset="0.6" stopColor="#28CE87" />
          <stop offset="1" stopColor="#1DFACD" />
        </linearGradient>
      </defs>
      <circle cx="511.5" cy="511.5" r="284.25" fill="none" stroke={`url(#${ring})`} strokeWidth="45.5" />
      <circle cx="800.5" cy="243.5" r="55" fill={`url(#${dot})`} />
    </svg>
  );
}

export function Logo({ idPrefix, className }: { idPrefix?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className ?? ""}`}>
      <LogoMark className="h-7 w-7" idPrefix={idPrefix} />
      <span className="text-lg">FaamOffice</span>
    </span>
  );
}
