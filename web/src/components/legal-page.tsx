import { Breadcrumbs } from "./breadcrumbs";
import { Alert, Container } from "./ui";
import type { LegalSection } from "@/i18n/dictionaries/vi";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";

export function LegalPage({
  locale,
  dict,
  path,
  content,
}: {
  locale: Locale;
  dict: Dictionary;
  path: string;
  content: { title: string; intro: string; sections: LegalSection[] };
}) {
  return (
    <Container className="max-w-3xl py-10">
      <Breadcrumbs
        label={dict.common.breadcrumb}
        items={[
          { name: dict.common.breadcrumbHome, path: `/${locale}` },
          { name: content.title, path: `/${locale}${path}` },
        ]}
      />
      <article className="mt-6">
        <h1 className="text-4xl font-extrabold tracking-tight">{content.title}</h1>
        <p className="mt-3 text-sm text-muted">
          {dict.legal.updated}: <time dateTime="2026-10-06">{dict.legal.updatedDate}</time>
        </p>
        <Alert tone="warn" className="mt-6">
          <strong className="font-semibold">{dict.legal.reviewTitle}:</strong> {dict.legal.reviewNote}
        </Alert>
        <div className="prose-legal mt-8">
          <p>{content.intro}</p>
          {content.sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              {section.paragraphs.map((p) => (
                <p key={p}>{p}</p>
              ))}
              {section.list ? (
                <ul>
                  {section.list.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              {section.after ? <p>{section.after}</p> : null}
            </section>
          ))}
        </div>
      </article>
    </Container>
  );
}
