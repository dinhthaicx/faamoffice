"use client";

import { useId, useState, type FormEvent } from "react";
import { aiBackendSchema, type AiBackendSettings, type AiBackendCheck } from "@/lib/ai-backend-shared";
import type { Dictionary } from "@/i18n";
import { buttonClass } from "./ui";
import { saveSettings, Status } from "./site-settings-form";

export function AiBackendSettingsForm({ initial, override, t, errors }: {
  initial: AiBackendSettings; override: boolean;
  t: Dictionary["admin"]["settings"]["aiBackend"]; errors: Record<string, string>;
}) {
  const id = useId();
  const [enabled, setEnabled] = useState(override);
  const [config, setConfig] = useState(initial);
  const [pending, setPending] = useState<"test" | "save" | null>(null);
  const [verified, setVerified] = useState<string | null>(null);
  const [check, setCheck] = useState<AiBackendCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const parsed = aiBackendSchema.safeParse(config);
  const fingerprint = parsed.success ? JSON.stringify(parsed.data) : "";
  const ready = parsed.success && fingerprint === verified;

  function change(next: AiBackendSettings) { setConfig(next); setSuccess(null); setCheck(null); }
  async function test() {
    setError(null); setSuccess(null); setCheck(null); setVerified(null);
    if (!parsed.success) { setError(t.invalid); return; }
    setPending("test");
    try {
      const res = await fetch("/api/admin/settings/ai/test", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json();
      if (!res.ok) setError(errors[data.error] ?? errors.generic);
      else { setCheck({ models: data.models }); setVerified(fingerprint); setSuccess(t.tested); }
    } catch { setError(errors.network); }
    finally { setPending(null); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (enabled && !ready) { setError(t.testFirst); return; }
    setPending("save"); setError(null); setSuccess(null);
    const result = await saveSettings({ aiBackend: enabled && parsed.success ? parsed.data : null }, errors);
    if (result.ok) setSuccess(enabled ? t.saved : t.restored);
    else { setError(result.message); setVerified(null); }
    setPending(null);
  }

  const inputClass = "mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm";
  return (
    <section className="rounded-2xl border border-border bg-card p-5 lg:col-span-2" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-lg font-semibold">{t.title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{t.subtitle}</p>
      <form onSubmit={save} className="mt-4">
        <fieldset disabled={pending !== null}>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setSuccess(null); }} />
            {t.override}
          </label>
          <p className="mt-1 text-sm text-muted">{enabled ? t.overrideHint : t.environmentHint}</p>
          <label htmlFor={`${id}-url`} className="mt-4 block text-sm font-medium">{t.address}</label>
          <input id={`${id}-url`} type="url" value={config.baseUrl} disabled={!enabled} className={inputClass}
            placeholder="http://192.168.1.50:11434/v1" autoComplete="off" spellCheck={false}
            onChange={(e) => change({ ...config, baseUrl: e.target.value })} />
          <p className="mt-1 text-sm text-muted">{t.addressHint}</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {config.models.map((model, index) => (
              <div key={model.id} className="rounded-xl border border-border p-3">
                <label htmlFor={`${id}-model-${index}`} className="block text-sm font-medium">{t.model} — {model.id}</label>
                <input id={`${id}-model-${index}`} value={model.upstream} disabled={!enabled} className={inputClass}
                  autoComplete="off" spellCheck={false}
                  onChange={(e) => change({ ...config, models: config.models.map((m, i) => i === index ? { ...m, upstream: e.target.value } : m) })} />
                <label htmlFor={`${id}-effort-${index}`} className="mt-3 block text-sm">{t.thinking}</label>
                <select id={`${id}-effort-${index}`} value={model.reasoningEffort ?? ""} disabled={!enabled} className={inputClass}
                  onChange={(e) => change({ ...config, models: config.models.map((m, i) => i === index ? { ...m, reasoningEffort: (e.target.value || undefined) as AiBackendSettings["models"][number]["reasoningEffort"] } : m) })}>
                  <option value="">{t.thinkingDefault}</option><option value="none">{t.thinkingNone}</option>
                  <option value="low">{t.thinkingLow}</option><option value="medium">{t.thinkingMedium}</option><option value="high">{t.thinkingHigh}</option>
                </select>
              </div>
            ))}
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{t.contextHint}</p>
          <div className="mt-2 overflow-x-auto rounded-lg bg-bg-muted p-3">
            <code className="whitespace-pre text-xs">FROM qwen3.5:9b{"\n"}PARAMETER num_ctx 65536{"\n\n"}ollama create faamoffice-fast:ctx65536 -f Modelfile</code>
          </div>
          <p className="mt-2 text-sm text-muted">{t.modelHint}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={test} disabled={!enabled} className={buttonClass.secondary}>{pending === "test" ? t.testing : t.test}</button>
            <button type="submit" disabled={enabled && !ready} className={buttonClass.primary}>{pending === "save" ? t.saving : enabled ? t.save : t.restore}</button>
          </div>
        </fieldset>
        {check && ready ? <ul className="mt-3 space-y-1 text-sm text-muted">
          {check.models.map((m) => <li key={m.id}>{m.id}: {m.upstream} · {m.contextTokens.toLocaleString()} tokens</li>)}
        </ul> : null}
        <Status error={error} success={success} />
      </form>
    </section>
  );
}
