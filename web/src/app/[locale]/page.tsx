import type { Metadata } from "next";
import Link from "next/link";
import { AppIcon } from "@/components/app-icons";
import { CodeBlock } from "@/components/code-block";
import { JsonLd } from "@/components/json-ld";
import { LogoMark } from "@/components/logo";
import { ArrowRightIcon, buttonClass, Card, CheckIcon, Container, DownloadIcon, Eyebrow, SectionHeading } from "@/components/ui";
import { faqLd, organizationLd, pageMetadata, softwareApplicationLd, websiteLd } from "@/lib/seo";
import { AI_PROVIDERS, GITHUB_URL, LOCAL_AI } from "@/lib/site";
import { toLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  const dict = getDictionary(locale);
  return pageMetadata({
    locale,
    path: "",
    title: dict.home.metaTitle,
    description: dict.home.metaDescription,
    absoluteTitle: true,
  });
}

const AGENT_COMMANDS = [
  "faamoffice install-cli",
  "faamoffice mcp install all",
  "claude mcp add --transport stdio faamoffice -- faamoffice mcp",
  "faamoffice create --type docx --from report.md --out report.docx",
  "faamoffice convert scan.pdf --to docx",
].join("\n");

const modeAccent: Record<string, string> = {
  cloud: "from-[#3aac71] to-[#2b95c2]",
  byok: "from-[#2b95c2] to-[#1d74fa]",
  local: "from-[#5fac39] to-[#1dfacd]",
};

function ProductMock({ mock }: { mock: ReturnType<typeof getDictionary>["home"]["mock"] }) {
  return (
    <div aria-hidden="true" className="relative mx-auto mt-14 max-w-5xl">
      <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-r from-[#3aac71]/20 via-[#2b95c2]/20 to-[#1d74fa]/20 blur-2xl" />
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/10">
        <div className="flex items-center gap-2 border-b border-border bg-bg-soft px-4 py-3">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          <span className="ml-3 truncate text-xs font-medium text-muted">{mock.fileName}</span>
        </div>
        <div className="grid sm:grid-cols-[1fr_280px]">
          <div className="space-y-4 p-6 sm:p-8">
            <p className="text-xl font-bold">{mock.heading}</p>
            <div className="space-y-2">
              <div className="h-2.5 w-full rounded bg-bg-muted" />
              <div className="h-2.5 w-11/12 rounded bg-bg-muted" />
              <div className="h-2.5 w-4/5 rounded bg-bg-muted" />
            </div>
            <div className="overflow-hidden rounded-lg border border-border text-xs">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className={`grid grid-cols-3 ${row === 0 ? "bg-bg-soft font-semibold" : "border-t border-border"}`}>
                  {[0, 1, 2].map((col) => (
                    <div key={col} className="px-3 py-2">
                      <div className={`h-2 rounded ${row === 0 ? "w-2/3 bg-border-strong" : "w-1/2 bg-bg-muted"}`} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <div className="h-2.5 w-full rounded bg-bg-muted" />
              <div className="h-2.5 w-3/4 rounded bg-bg-muted" />
            </div>
          </div>
          <div className="hidden border-l border-border bg-bg-soft p-4 sm:flex sm:flex-col sm:gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <LogoMark className="h-5 w-5" idPrefix="mock" />
              {mock.aiTitle}
            </div>
            <div className="ml-6 rounded-xl rounded-tr-sm bg-accent px-3 py-2 text-xs leading-relaxed text-accent-fg">
              {mock.userPrompt}
            </div>
            <div className="mr-6 rounded-xl rounded-tl-sm border border-border bg-card px-3 py-2 text-xs leading-relaxed">
              {mock.aiReply}
            </div>
            <div className="mr-6 inline-flex items-center gap-1.5 self-start rounded-full bg-success-bg px-2.5 py-1 text-[11px] font-medium text-success-fg">
              <CheckIcon className="h-3.5 w-3.5" />
              {mock.aiAction}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const locale = toLocale((await params).locale);
  const dict = getDictionary(locale);
  const h = dict.home;

  return (
    <>
      <JsonLd data={[organizationLd(), websiteLd(locale, dict), softwareApplicationLd(locale, dict), faqLd(h.faq.items)]} />

      {/* Hero */}
      <section className="hero-glow overflow-hidden pb-20 pt-16 sm:pt-24" aria-labelledby="hero-title">
        <Container className="text-center">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted">
            <span className="brand-gradient h-2 w-2 rounded-full" />
            {h.hero.eyebrow}
          </p>
          <h1 id="hero-title" className="mx-auto mt-6 max-w-4xl text-4xl font-extrabold tracking-tight sm:text-6xl">
            <span className="text-gradient">{h.hero.title}</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted">{h.hero.subtitle}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href={`/${locale}/download`} className={`${buttonClass.primary} ${buttonClass.large}`}>
              <DownloadIcon />
              {h.hero.ctaDownload}
            </Link>
            <Link href={`/${locale}/faam-ai`} className={`${buttonClass.secondary} ${buttonClass.large}`}>
              {h.hero.ctaAi}
              <ArrowRightIcon />
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted">{h.hero.platforms}</p>
          <ProductMock mock={h.mock} />
        </Container>
      </section>

      {/* Six apps */}
      <section id="features" className="scroll-mt-20 py-20" aria-labelledby="apps-title">
        <Container>
          <SectionHeading id="apps-title" title={h.apps.title} subtitle={h.apps.subtitle} center />
          <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {h.apps.items.map((app) => (
              <li key={app.key}>
                <Card className="h-full transition-shadow hover:shadow-md">
                  <AppIcon name={app.key} />
                  <h3 className="mt-4 text-lg font-semibold">{app.name}</h3>
                  <p className="mt-1 font-mono text-xs text-muted">{app.formats}</p>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{app.description}</p>
                </Card>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* Faam AI */}
      <section className="border-y border-border bg-bg-soft py-20" aria-labelledby="ai-title">
        <Container>
          <SectionHeading id="ai-title" eyebrow={h.ai.eyebrow} title={h.ai.title} subtitle={h.ai.subtitle} />
          <ul className="mt-12 grid gap-5 lg:grid-cols-3">
            {h.ai.modes.map((mode) => (
              <li key={mode.key}>
                <Card className="relative h-full overflow-hidden">
                  <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${modeAccent[mode.key]}`} />
                  <h3 className="text-lg font-semibold">{mode.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{mode.description}</p>
                  <ul className="mt-4 space-y-2">
                    {mode.points.map((point) => (
                      <li key={point} className="flex gap-2 text-sm">
                        <CheckIcon className="text-[#2e9a63] dark:text-[#5fd39a]" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            ))}
          </ul>
          <div className="mt-10 grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div>
              <h3 className="text-sm font-semibold">{h.ai.providersTitle}</h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {AI_PROVIDERS.map((p) => (
                  <li key={p} className="rounded-full border border-border bg-card px-3 py-1 text-sm">
                    {p}
                  </li>
                ))}
                <li className="rounded-full px-3 py-1 text-sm text-muted">{h.ai.providersOther}</li>
              </ul>
            </div>
            <div>
              <h3 className="text-sm font-semibold">{h.ai.localTitle}</h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {LOCAL_AI.map((p) => (
                  <li key={p} className="rounded-full border border-border bg-card px-3 py-1 text-sm">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <Link href={`/${locale}/faam-ai`} className="mt-10 inline-flex items-center gap-2 font-semibold text-link hover:underline">
            {h.ai.cta}
            <ArrowRightIcon />
          </Link>
        </Container>
      </section>

      {/* Privacy */}
      <section className="py-20" aria-labelledby="privacy-title">
        <Container>
          <SectionHeading id="privacy-title" eyebrow={h.privacy.eyebrow} title={h.privacy.title} />
          <ul className="mt-12 grid gap-8 sm:grid-cols-2">
            {h.privacy.points.map((point) => (
              <li key={point.title} className="flex gap-4">
                <span className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success-bg text-success-fg">
                  <CheckIcon className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="font-semibold">{point.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{point.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* CLI / MCP */}
      <section className="py-20" aria-labelledby="agents-title">
        <Container className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <SectionHeading id="agents-title" eyebrow={h.agents.eyebrow} title={h.agents.title} subtitle={h.agents.subtitle} />
            <ul className="mt-6 space-y-3">
              {h.agents.points.map((point) => (
                <li key={point} className="flex gap-2 text-sm leading-relaxed">
                  <CheckIcon className="text-[#2e9a63] dark:text-[#5fd39a]" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <CodeBlock code={AGENT_COMMANDS} label={h.agents.codeLabel} copyLabel={dict.common.copy} copiedLabel={dict.common.copied} />
        </Container>
      </section>

      {/* Open source */}
      <section className="py-12" aria-labelledby="oss-title">
        <Container>
          <div className="relative overflow-hidden rounded-3xl border border-border bg-bg-soft p-8 sm:p-12">
            <div className="brand-gradient absolute inset-x-0 top-0 h-1" />
            <Eyebrow>{h.openSource.eyebrow}</Eyebrow>
            <h2 id="oss-title" className="max-w-2xl text-3xl font-bold tracking-tight">
              {h.openSource.title}
            </h2>
            <p className="mt-4 max-w-3xl text-lg leading-relaxed text-muted">{h.openSource.description}</p>
            <a href={GITHUB_URL} className={`${buttonClass.secondary} mt-6`} rel="noopener">
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
              {h.openSource.cta}
            </a>
          </div>
        </Container>
      </section>

      {/* FAQ */}
      <section className="py-20" aria-labelledby="faq-title">
        <Container className="max-w-3xl">
          <h2 id="faq-title" className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
            {h.faq.title}
          </h2>
          <div className="mt-10 divide-y divide-border rounded-2xl border border-border bg-card">
            {h.faq.items.map((item) => (
              <details key={item.q} className="group px-5 py-4 sm:px-6">
                <summary className="flex cursor-pointer items-start justify-between gap-4 rounded-lg">
                  <h3 className="font-semibold">{item.q}</h3>
                  <svg
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className="mt-0.5 h-5 w-5 shrink-0 text-muted transition-transform group-open:rotate-45"
                    aria-hidden="true"
                  >
                    <path d="M10 4v12M4 10h12" strokeLinecap="round" />
                  </svg>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted">{item.a}</p>
              </details>
            ))}
          </div>
        </Container>
      </section>

      {/* Final CTA */}
      <section className="pb-8" aria-labelledby="cta-title">
        <Container>
          <div className="brand-gradient rounded-3xl p-[1px]">
            <div className="rounded-[calc(1.5rem-1px)] bg-card px-8 py-12 text-center sm:px-12">
              <h2 id="cta-title" className="text-3xl font-bold tracking-tight">
                {h.cta.title}
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-muted">{h.cta.subtitle}</p>
              <Link href={`/${locale}/download`} className={`${buttonClass.primary} ${buttonClass.large} mt-6`}>
                <DownloadIcon />
                {h.cta.button}
              </Link>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
