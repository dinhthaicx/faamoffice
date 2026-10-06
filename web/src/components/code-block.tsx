import { CopyButton } from "./copy-button";

/** Terminal-style command block with a copy button in its title bar. */
export function CodeBlock({ code, label, copyLabel, copiedLabel }: { code: string; label?: string; copyLabel: string; copiedLabel: string }) {
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-xl bg-code-bg text-code-fg">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <span aria-hidden="true" className="flex gap-1">
            <span className="h-2 w-2 rounded-full bg-white/20" />
            <span className="h-2 w-2 rounded-full bg-white/20" />
            <span className="h-2 w-2 rounded-full bg-white/20" />
          </span>
          {label ? <span className="ml-1">{label}</span> : null}
        </span>
        <CopyButton text={code} label={copyLabel} copiedLabel={copiedLabel} />
      </div>
      <pre className="overflow-x-auto px-4 py-3 text-sm leading-relaxed">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}
