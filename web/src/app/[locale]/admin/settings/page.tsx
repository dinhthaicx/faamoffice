import type { Metadata } from "next";
import { AdminNav } from "@/components/admin-nav";
import { CreditsSettings, SocialLinksSettings } from "@/components/site-settings-form";
import { Container } from "@/components/ui";
import { requirePageAdmin } from "@/lib/auth";
import { privateMetadata } from "@/lib/seo";
import { clearSiteSettingsCache, getSiteSettings } from "@/lib/site-settings";
import { toLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n";

// Typed by hand (not PageProps<…>) so type-checking does not depend on regenerated route types.
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = toLocale((await params).locale);
  return privateMetadata(getDictionary(locale).admin.settings.metaTitle);
}

export default async function AdminSettingsPage({ params }: Props) {
  const locale = toLocale((await params).locale);
  await requirePageAdmin(locale, `/${locale}/admin/settings`);
  const dict = getDictionary(locale);
  const t = dict.admin.settings;
  // The editor must start from what is stored, not from a cached copy.
  clearSiteSettingsCache();
  const settings = await getSiteSettings();

  return (
    <Container className="py-10">
      <h1 className="text-3xl font-bold tracking-tight">{dict.admin.title}</h1>
      <AdminNav locale={locale} dict={dict} current="settings" />
      <p className="mt-6 max-w-3xl text-sm leading-relaxed text-muted">{t.subtitle}</p>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <CreditsSettings
          initial={{ creditsEnabled: settings.creditsEnabled, aiDailyRequestLimit: settings.aiDailyRequestLimit }}
          t={t}
          errors={dict.errors}
        />
        <SocialLinksSettings initial={settings.socialLinks} t={t} errors={dict.errors} websiteName={dict.footer.website} />
      </div>
    </Container>
  );
}
