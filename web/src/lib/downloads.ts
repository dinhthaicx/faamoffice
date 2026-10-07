import { prisma } from "./db";
import { DOWNLOAD_ASSETS, DOWNLOAD_TIME_ZONE, downloadDay, shiftDownloadDay, type DownloadClick } from "./downloads-shared";

export async function recordDownload(click: DownloadClick, now = new Date()): Promise<void> {
  const key = { day: downloadDay(now), ...click };
  await prisma.downloadDailyStat.upsert({
    where: { day_asset_version_locale_source: key },
    create: { ...key, count: 1 },
    update: { count: { increment: 1 } },
  });
}

export async function downloadReport(days: 7 | 30 | 90 = 30, now = new Date()) {
  const today = downloadDay(now);
  const since7 = shiftDownloadDay(today, -6);
  const since30 = shiftDownloadDay(today, -29);
  const since = shiftDownloadDay(today, 1 - days);
  const sum = async (day?: string) => {
    const result = await prisma.downloadDailyStat.aggregate({
      _sum: { count: true },
      where: { day: { ...(day ? { gte: day } : {}), lte: today } },
    });
    return result._sum.count ?? 0;
  };
  const [total, todayCount, last7, last30, first, rows] = await Promise.all([
    sum(), sum(today), sum(since7), sum(since30),
    prisma.downloadDailyStat.aggregate({ _min: { day: true } }),
    prisma.downloadDailyStat.findMany({ where: { day: { gte: since, lte: today } }, orderBy: { day: "asc" } }),
  ]);
  const byDay = new Map<string, number>();
  const byAsset = new Map<string, number>();
  const byVersion = new Map<string, number>();
  const byLocale = new Map<string, number>();
  const bySource = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, count: number) => map.set(key, (map.get(key) ?? 0) + count);
  for (const row of rows) {
    add(byDay, row.day, row.count);
    add(byAsset, row.asset, row.count);
    add(byVersion, row.version, row.count);
    add(byLocale, row.locale, row.count);
    add(bySource, row.source, row.count);
  }
  return {
    total, today: todayCount, last7, last30, days, firstDay: first._min.day,
    timeZone: DOWNLOAD_TIME_ZONE, generatedAt: now.toISOString(),
    series: Array.from({ length: days }, (_, index) => {
      const day = shiftDownloadDay(since, index);
      return { day, count: byDay.get(day) ?? 0 };
    }),
    assets: DOWNLOAD_ASSETS.map((asset) => ({ asset, count: byAsset.get(asset) ?? 0 })),
    versions: [...byVersion].map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count || b.version.localeCompare(a.version)),
    locales: ["vi", "en"].map((locale) => ({ locale, count: byLocale.get(locale) ?? 0 })),
    sources: ["recommended", "platform"].map((source) => ({ source, count: bySource.get(source) ?? 0 })),
  };
}
