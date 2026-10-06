import { assertSameOrigin, safeNextPath } from "@/lib/auth";
import { json, readJson, route } from "@/lib/http";
import { destroySession } from "@/lib/session";
import { toLocale } from "@/i18n/config";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const body = (await readJson(req, 16 * 1024).catch(() => ({}))) as { locale?: unknown; next?: unknown };
  await destroySession();
  const fallback = `/${toLocale(body?.locale)}`;
  return json({ ok: true, redirect: safeNextPath(typeof body?.next === "string" ? body.next : null, fallback) });
});
