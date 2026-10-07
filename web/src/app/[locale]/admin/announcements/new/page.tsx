import type { Metadata } from "next";
import Link from "next/link";
import { AnnouncementForm, EMPTY_ANNOUNCEMENT } from "@/components/announcement-form";
import { Container } from "@/components/ui";
import { requirePageAdmin } from "@/lib/auth";
import { privateMetadata } from "@/lib/seo";
import { toLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/announcements/new">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  return privateMetadata(getDictionary(locale).admin.announcements.newTitle);
}

export default async function NewAnnouncementPage({ params }: PageProps<"/[locale]/admin/announcements/new">) {
  const locale = toLocale((await params).locale);
  await requirePageAdmin(locale, `/${locale}/admin/announcements/new`);
  const dict = getDictionary(locale);
  const t = dict.admin.announcements;

  return (
    <Container className="py-10">
      <Link href={`/${locale}/admin/announcements`} className="text-sm text-link hover:underline">
        {t.back}
      </Link>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">{t.newTitle}</h1>
      <div className="mt-6">
        <AnnouncementForm locale={locale} mode="create" initial={EMPTY_ANNOUNCEMENT} initialImage={null} t={t} errors={dict.errors} />
      </div>
    </Container>
  );
}
