"use client";

// Renders a timestamp in the viewer's time zone. The server snapshot (UTC) is
// used for SSR and hydration, then React switches to the browser's zone.

import { useSyncExternalStore } from "react";

function formatDate(iso: string, locale: string, dateOnly: boolean, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit" }),
    timeZone,
  }).format(new Date(iso));
}

const subscribe = () => () => {};

export function LocalTime({ iso, locale, dateOnly = false }: { iso: string; locale: string; dateOnly?: boolean }) {
  const text = useSyncExternalStore(
    subscribe,
    () => formatDate(iso, locale, dateOnly),
    () => formatDate(iso, locale, dateOnly, "UTC") + (dateOnly ? "" : " UTC"),
  );
  return <time dateTime={iso}>{text}</time>;
}
