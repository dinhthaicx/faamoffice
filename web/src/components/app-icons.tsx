// Simple glyphs for the six FaamOffice apps (decorative).

const styles: Record<string, { bg: string; fg: string }> = {
  docs: { bg: "bg-[#e7f0ff] dark:bg-[#132544]", fg: "text-[#1765d8] dark:text-[#7fb0ff]" },
  sheets: { bg: "bg-[#e5f6ec] dark:bg-[#10291c]", fg: "text-[#1f7a4a] dark:text-[#6fd59d]" },
  slides: { bg: "bg-[#fff0e3] dark:bg-[#2e1d0d]", fg: "text-[#b4540a] dark:text-[#f5a25f]" },
  pdf: { bg: "bg-[#fdeaea] dark:bg-[#2e1213]", fg: "text-[#b42318] dark:text-[#ff8f88]" },
  markdown: { bg: "bg-[#eef1f5] dark:bg-[#1a2230]", fg: "text-[#344054] dark:text-[#c3ccd8]" },
  html: { bg: "bg-[#e6f7f8] dark:bg-[#0e2a2c]", fg: "text-[#0e7c86] dark:text-[#5fd3db]" },
};

function Glyph({ name }: { name: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "docs":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true" {...common}>
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v4h4M10 12h5M10 15.5h5M10 9h2" />
        </svg>
      );
    case "sheets":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true" {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M4 9.5h16M4 14.5h16M10 4v16" />
        </svg>
      );
    case "slides":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true" {...common}>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M12 16v4M8.5 20h7M8 12l3-3 2 2 3-3" />
        </svg>
      );
    case "pdf":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true" {...common}>
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v4h4M9.5 17l2-6 2 6M10.2 15h2.6" />
        </svg>
      );
    case "markdown":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true" {...common}>
          <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
          <path d="M6 15V9l2.5 3L11 9v6M16 9v6m-2-2 2 2 2-2" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true" {...common}>
          <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12" />
        </svg>
      );
  }
}

export function AppIcon({ name }: { name: string }) {
  const s = styles[name] ?? styles.markdown;
  return (
    <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${s.bg} ${s.fg}`}>
      <Glyph name={name} />
    </span>
  );
}
