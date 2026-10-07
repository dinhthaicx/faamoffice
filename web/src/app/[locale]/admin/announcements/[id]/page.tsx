import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AnnouncementForm } from "@/components/announcement-form";
import { LocalTime } from "@/components/local-time";
import { Container } from "@/components/ui";
import { toAnnouncementFormValues } from "@/lib/announcement-shared";
import { ADMIN_IMAGE_SELECT } from "@/lib/announcements";
import { requirePageAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { privateMetadata } from "@/lib/seo";
import { toLocale } from "@/i18n/config";
import { format, getDictionary } from "@/i18n";

// The locale layout restricts params to known locales; announcement ids are dynamic.
export const dynamicParams = true;

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/announcements/[id]">): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  return privateMetadata(getDictionary(locale).admin.announcements.editTitle);
}

export default async function EditAnnouncementPage({ params, searchParams }: PageProps<"/[locale]/admin/announcements/[id]">) {
  const { locale: rawLocale, id } = await params;
  const locale = toLocale(rawLocale);
  const sp = await searchParams;
  await requirePageAdmin(locale, `/${locale}/admin/announcements/${id}`);
  const dict = getDictionary(locale);
  const t = dict.admin.announcements;

  const announcement = await prisma.announcement.findUnique({
    where: { id },
    include: {
      image: { select: ADMIN_IMAGE_SELECT },
      updatedBy: { select: { email: true } },
    },
  });
  if (!announcement) notFound();

  return (
    <Container className="py-10">
      <Link href={`/${locale}/admin/announcements`} className="text-sm text-link hover:underline">
        {t.back}
      </Link>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">{t.editTitle}</h1>
      <p className="mt-1 text-sm text-muted">
        {t.lastUpdated}: <LocalTime iso={announcement.updatedAt.toISOString()} locale={locale} />
        {announcement.updatedBy ? ` ${format(t.by, { email: announcement.updatedBy.email })}` : ""}
      </p>
      <div className="mt-6">
        <AnnouncementForm
          key={announcement.id}
          locale={locale}
          mode="edit"
          announcementId={announcement.id}
          initial={toAnnouncementFormValues(announcement)}
          initialImage={announcement.image}
          justCreated={sp.saved === "1"}
          t={t}
          errors={dict.errors}
        />
      </div>
    </Container>
  );
}
