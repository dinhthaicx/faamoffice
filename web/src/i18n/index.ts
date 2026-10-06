// Dictionary access for server components. Dictionaries are plain modules, so
// they are never shipped to the browser unless a client component receives a slice.

import { en } from "./dictionaries/en";
import { vi, type Dictionary } from "./dictionaries/vi";
import type { Locale } from "./config";

const dictionaries: Record<Locale, Dictionary> = { vi, en };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

/** Replace {name} placeholders. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

export type { Dictionary };
