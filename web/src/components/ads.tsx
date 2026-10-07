// Google AdSense on the ad pages (home and Faam AI only; see src/lib/ads.ts).
// Server components: nothing is rendered unless adsForPage() returned the
// page's ads, i.e. ads are on in the admin Settings.

import { AdUnit } from "./ads-client";
import { adsenseScriptSrc, type PageAds } from "@/lib/ads";

/**
 * The AdSense script (React hoists an async <script src> into <head>, so it is
 * in the prerendered HTML).
 */
export function AdsenseScript({ ads }: { ads: PageAds | null }) {
  if (!ads) return null;
  return <script async src={adsenseScriptSrc(ads.client)} crossOrigin="anonymous" />;
}

/** The page's manual ad unit, when one is configured. */
export function AdSlot({ ads, label, className }: { ads: PageAds | null; label: string; className?: string }) {
  if (!ads?.slot) return null;
  return <AdUnit client={ads.client} slot={ads.slot} label={label} className={className} />;
}
