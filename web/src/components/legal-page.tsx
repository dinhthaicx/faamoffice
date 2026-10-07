import type { ReactNode } from "react";
import { Breadcrumbs } from "./breadcrumbs";
import { Alert, Container } from "./ui";
import type { LegalSection } from "@/i18n/dictionaries/vi";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n";

type LegalContent = {
  title: string;
  intro: string;
  sections: LegalSection[];
  updatedDate?: string;
  updatedDateTime?: string;
};

const URL_RE = /(https:\/\/[^\s,;()]*[^\s,;().])/g;

/** Text with its https URLs as links (plain text, unchanged, when there are none). */
function Linked({ text }: { text: string }): ReactNode {
  const parts = text.split(URL_RE);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} rel="noopener noreferrer" className="break-words text-link underline underline-offset-2">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

/** "N. Heading" for every section, in order (the source numbers are dropped). */
function numberHeadings(sections: LegalSection[]): LegalSection[] {
  return sections.map((section, i) => ({ ...section, heading: `${i + 1}. ${section.heading.replace(/^\d+\.\s*/, "")}` }));
}

/**
 * The privacy policy while Google ads are on: the cookie section no longer says
 * that no advertising cookies are used and points to a new "Advertising"
 * section (Google's required disclosure) inserted right after it; the headings
 * are renumbered. With ads off the policy is rendered exactly as written.
 */
export function privacyWithAds(privacy: Dictionary["privacy"]): LegalContent {
  const { ads } = privacy;
  const sections: LegalSection[] = [];
  let inserted = false;
  for (const section of privacy.sections) {
    if (section.id === "cookies") {
      sections.push({ ...section, paragraphs: [ads.cookiesIntro], after: ads.cookiesAfter }, ads.section);
      inserted = true;
    } else {
      sections.push(section);
    }
  }
  if (!inserted) sections.splice(Math.max(0, sections.length - 1), 0, ads.section);
  return { title: privacy.title, intro: privacy.intro, sections: numberHeadings(sections), updatedDate: privacy.updatedDate, updatedDateTime: privacy.updatedDateTime };
}

export function LegalPage({
  locale,
  dict,
  path,
  content,
  reviewPending = false,
}: {
  locale: Locale;
  dict: Dictionary;
  path: string;
  content: LegalContent;
  reviewPending?: boolean;
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
          {dict.legal.updated}: <time dateTime={content.updatedDateTime ?? dict.legal.updatedDateTime}>{content.updatedDate ?? dict.legal.updatedDate}</time>
        </p>
        {reviewPending ? (
          <Alert tone="warn" className="mt-6">
            <strong className="font-semibold">{dict.legal.reviewTitle}:</strong> {dict.legal.reviewNote}
          </Alert>
        ) : null}
        <div className="prose-legal mt-8">
          <p><Linked text={content.intro} /></p>
          {content.sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              {section.paragraphs.map((p) => (
                <p key={p}>
                  <Linked text={p} />
                </p>
              ))}
              {section.list ? (
                <ul>
                  {section.list.map((item) => (
                    <li key={item}>
                      <Linked text={item} />
                    </li>
                  ))}
                </ul>
              ) : null}
              {section.after ? (
                <p>
                  <Linked text={section.after} />
                </p>
              ) : null}
            </section>
          ))}
        </div>
      </article>
    </Container>
  );
}
