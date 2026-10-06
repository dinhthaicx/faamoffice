import { notFound } from "next/navigation";

// Any unknown path under /vi or /en renders the localized 404 page.
export default function CatchAll() {
  notFound();
}
