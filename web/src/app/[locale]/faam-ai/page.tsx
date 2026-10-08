import type { Metadata } from "next";
import Link from "next/link";
import { AdsenseScript, AdSlot } from "@/components/ads";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { CodeBlock } from "@/components/code-block";
import { Alert, buttonClass, Card, Container } from "@/components/ui";
import { adsForPage } from "@/lib/ads";
import { pageMetadata } from "@/lib/seo";
import { getSiteSettings } from "@/lib/site-settings";
import { AI_PROVIDERS } from "@/lib/site";
import { toLocale } from "@/i18n/config";
import { format, getDictionary } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[locale]/faam-ai">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const d = getDictionary(locale).faamAi;
  return pageMetadata({ locale, path: "/faam-ai", title: d.metaTitle, description: d.metaDescription });
}

export default async function FaamAiPage({ params }: PageProps<"/[locale]/faam-ai">) {
  const locale = toLocale((await params).locale);
  const dict = getDictionary(locale);
  const d = dict.faamAi;
  const copy = { copyLabel: dict.common.copy, copiedLabel: dict.common.copied };
  const ads = adsForPage((await getSiteSettings()).ads, "faamAi");

  const localSetups = [
    {
      id: "ollama",
      name: d.local.ollama.name,
      intro: d.local.ollama.intro,
      code: "ollama pull qwen3",
      provider: "Ollama (local)",
      url: "http://localhost:11434/v1",
    },
    {
      id: "lmstudio",
      name: d.local.lmstudio.name,
      intro: d.local.lmstudio.intro,
      code: "lms get qwen3\nlms server start",
      provider: "LM Studio (local)",
      url: "http://localhost:1234/v1",
    },
    {
      id: "llamacpp",
      name: d.local.llamacpp.name,
      intro: d.local.llamacpp.intro,
      code: "llama-server -hf ggml-org/Qwen3-8B-GGUF --jinja --port 8080",
      provider: "llama.cpp (local)",
      url: "http://localhost:8080/v1",
    },
  ];

  return (
    <>
      <AdsenseScript ads={ads} />
      <section className="hero-glow pb-10 pt-10">
        <Container>
          <Breadcrumbs
            label={dict.common.breadcrumb}
            items={[
              { name: dict.common.breadcrumbHome, path: `/${locale}` },
              { name: "Faam AI", path: `/${locale}/faam-ai` },
            ]}
          />
          <h1 className="mt-6 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">{d.title}</h1>
          <p className="mt-5 max-w-3xl text-lg leading-relaxed text-muted">{d.intro}</p>
          <nav aria-label={d.compare.title} className="mt-6 flex flex-wrap gap-2 text-sm">
            <a href="#cloud" className="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-bg-muted">
              Faam AI Cloud
            </a>
            <a href="#byok" className="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-bg-muted">
              {d.byok.title}
            </a>
            <a href="#local" className="rounded-md border border-border bg-card px-3 py-1.5 hover:bg-bg-muted">
              {d.local.title}
            </a>
          </nav>
        </Container>
      </section>

      <section className="py-10" aria-labelledby="compare-title">
        <Container>
          <h2 id="compare-title" className="text-2xl font-bold tracking-tight">
            {d.compare.title}
          </h2>
          <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-bg-soft">
                <tr>
                  {d.compare.headers.map((h, i) => (
                    <th key={i} scope="col" className="px-4 py-3 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.compare.rows.map((row) => (
                  <tr key={row[0]} className="border-t border-border">
                    <th scope="row" className="px-4 py-3 font-medium">
                      {row[0]}
                    </th>
                    {row.slice(1).map((cell, i) => (
                      <td key={i} className="px-4 py-3 text-muted">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </section>

      {/* Ad unit between the comparison table and the sections with buttons (admin Settings → Google ads) */}
      {ads?.slot ? (
        <div className="py-10">
          <Container>
            <AdSlot ads={ads} label={dict.common.advertisement} />
          </Container>
        </div>
      ) : null}

      <section id="cloud" className="scroll-mt-20 py-10" aria-labelledby="cloud-title">
        <Container className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          <div>
            <h2 id="cloud-title" className="text-2xl font-bold tracking-tight">
              {d.cloud.title}
            </h2>
            <p className="mt-3 leading-relaxed text-muted">{d.cloud.text}</p>
            <Link href={`/${locale}/register`} className={`${buttonClass.ai} mt-6`} prefetch={false}>
              {d.cloud.cta}
            </Link>
          </div>
          <Card>
            <ol className="space-y-4">
              {d.cloud.steps.map((step, i) => (
                <li key={step} className="flex gap-3">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ai text-sm font-bold text-ai-fg">
                    {i + 1}
                  </span>
                  <span className="pt-0.5 text-sm leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </Card>
        </Container>
      </section>

      <section id="byok" className="scroll-mt-20 py-10" aria-labelledby="byok-title">
        <Container>
          <h2 id="byok-title" className="text-2xl font-bold tracking-tight">
            {d.byok.title}
          </h2>
          <p className="mt-3 max-w-3xl leading-relaxed text-muted">{d.byok.text}</p>
          <ul className="mt-5 flex flex-wrap gap-2">
            {AI_PROVIDERS.map((p) => (
              <li key={p} className="rounded-full border border-border bg-card px-3 py-1 text-sm">
                {p}
              </li>
            ))}
          </ul>
          <Alert className="mt-6 max-w-3xl">{d.byok.customNote}</Alert>
        </Container>
      </section>

      <section id="local" className="scroll-mt-20 py-10" aria-labelledby="local-title">
        <Container>
          <h2 id="local-title" className="text-2xl font-bold tracking-tight">
            {d.local.title}
          </h2>
          <p className="mt-3 max-w-3xl leading-relaxed text-muted">{d.local.text}</p>
          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            {localSetups.map((s) => (
              <Card key={s.id} className="flex h-full min-w-0 flex-col">
                <h3 className="text-lg font-semibold">{s.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.intro}</p>
                <div className="mt-4">
                  <CodeBlock code={s.code} {...copy} />
                </div>
                <p className="mt-4 text-sm leading-relaxed text-muted">
                  {format(d.local.appStep, { provider: s.provider, url: s.url })}
                </p>
              </Card>
            ))}
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <Alert>{d.local.lanTip}</Alert>
            <Alert>{d.local.hardwareTip}</Alert>
          </div>
        </Container>
      </section>
    </>
  );
}
