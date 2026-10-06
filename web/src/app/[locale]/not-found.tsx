import Link from "next/link";
import { locale as rootLocale } from "next/root-params";
import { buttonClass, Container } from "@/components/ui";
import { toLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n";

export default async function NotFound() {
  const locale = toLocale(await rootLocale());
  const dict = getDictionary(locale);
  return (
    <Container className="flex flex-col items-center py-24 text-center">
      <p className="text-gradient text-7xl font-extrabold">404</p>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">{dict.notFound.title}</h1>
      <p className="mt-3 max-w-md text-muted">{dict.notFound.text}</p>
      <Link href={`/${locale}`} className={`${buttonClass.primary} mt-8`}>
        {dict.common.backHome}
      </Link>
    </Container>
  );
}
