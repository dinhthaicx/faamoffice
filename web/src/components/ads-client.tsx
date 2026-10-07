"use client";

// Client side of the Google AdSense integration (see src/lib/ads.ts): a manual
// responsive ad unit, and the guard that makes links leave an ad page by a full
// page load.

import { useEffect, useRef } from "react";
import { cx } from "./ui";
import { needsFullPageLoad } from "@/lib/ads";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * A labelled, responsive AdSense unit. Space is reserved up front (min-height)
 * to limit layout shift; the box disappears when Google has no ad to show.
 */
export function AdUnit({ client, slot, label, className }: { client: string; slot: string; label: string; className?: string }) {
  const ref = useRef<HTMLModElement>(null);

  useEffect(() => {
    const ins = ref.current;
    // One request per <ins> (effects run twice in development's Strict Mode).
    if (!ins || ins.dataset.adsbygoogleStatus || ins.dataset.faamRequested) return;
    ins.dataset.faamRequested = "1";
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // Blocked by an ad blocker or the script failed to load: leave the box empty.
    }
  }, []);

  return (
    <aside aria-label={label} className={cx("mx-auto w-full max-w-4xl has-[[data-ad-status=unfilled]]:hidden", className)}>
      <p className="text-center text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <div className="mt-2 min-h-[250px] overflow-hidden rounded-2xl border border-border bg-bg-soft">
        <ins
          ref={ref}
          className="adsbygoogle"
          style={{ display: "block" }}
          data-ad-client={client}
          data-ad-slot={slot}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      </div>
    </aside>
  );
}

/**
 * Rendered in the locale layout while ads are enabled: links crossing an ad page are
 * followed by the browser (full page load) instead of next/link's client-side
 * navigation, so the script, Auto ads (anchor ads, side rails…) and the ad
 * pages' Content-Security-Policy never carry over to pages that must not show
 * ads, such as the download page. Entering an ad page also loads its CSP, which
 * cannot be updated by client-side navigation from a page with the strict policy.
 */
export function FullPageNavigation() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const info = {
        href: link.href,
        target: link.target,
        download: link.hasAttribute("download"),
        hreflang: link.getAttribute("hreflang"),
      };
      if (needsFullPageLoad(info, window.location, event)) {
        // next/link respects defaultPrevented. Let other click handlers run so
        // the language switcher can still remember the chosen locale.
        event.preventDefault();
        window.location.assign(link.href);
      }
    }
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
